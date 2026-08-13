//! Host-key verification against the user's `known_hosts`.
//!
//! This is the one decision in the SSH layer that has no safe default. A wrong
//! answer here is not a broken feature, it is a man-in-the-middle, so the module
//! is deliberately small, pure, and exhaustively tested: it takes the file's
//! text and the key a server presented, and returns one of three verdicts —
//! never a boolean, because "not known" and "does not match" must never collapse
//! into the same branch.
//!
//! What it deliberately does **not** do:
//!
//! * There is no "ignore host key" mode, not even behind a setting. A changed
//!   key is [`Verdict::Changed`] and the connection stops.
//! * It never writes to `known_hosts` on its own. Trusting a new host is a user
//!   action ([`Verdict::Unknown`] → an explicit confirmation → [`trust_line`]).
//!
//! Hashed entries (`|1|salt|hash`, what `HashKnownHosts yes` produces) are
//! recognized and matched with HMAC-SHA1 as OpenSSH specifies, so a user with a
//! hashed file is not silently told every host is new.

// FOR-DEV: this module has no caller yet — its caller is the SSH client's
// host-key callback, which lands with the connection manager (`ssh/conn.rs`).
// It is written and tested first on purpose: it is the one decision here that
// must not be improvised while wiring a connection, and keeping it free of the
// SSH library's types is what lets it be tested without one. Remove this
// allow, and the matching entry in `FOR-DEV.md`, in the change that connects.
#![allow(dead_code)]

use base64::Engine;
use sha2::{Digest, Sha256};

use crate::error::AppError;

/// What `known_hosts` says about a key a server just presented.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// This exact key is already trusted for this host. Connect.
    Trusted,
    /// Nothing on file for this host. The user decides — trust on first use —
    /// and nothing is written until they say so.
    Unknown,
    /// A key is on file for this host and it is **not** this one. Refuse. The
    /// stored fingerprint travels with it so the UI can show both.
    Changed { stored_fingerprint: String },
    /// The host is on file with `@revoked`. Refuse, and never offer to trust.
    Revoked,
}

/// One host key as presented by a server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresentedKey {
    /// Algorithm name on the wire, e.g. `ssh-ed25519`.
    pub algorithm: String,
    /// The raw public key blob (what `known_hosts` stores base64-encoded).
    pub blob: Vec<u8>,
}

impl PresentedKey {
    /// Adapt the key the SSH client hands to its host-key callback.
    ///
    /// This is the only place the verification logic touches the SSH library's
    /// types; everything below works on the wire blob, so the decision code can
    /// be tested without a connection — and cannot be quietly changed by a
    /// library upgrade.
    pub fn from_ssh_key(key: &russh::keys::ssh_key::PublicKey) -> Result<Self, AppError> {
        let blob = key
            .to_bytes()
            .map_err(|e| AppError::Invalid(format!("unreadable server key: {e}")))?;
        Ok(Self {
            algorithm: key.algorithm().to_string(),
            blob,
        })
    }

    /// The `SHA256:…` fingerprint OpenSSH shows, for the confirmation dialog.
    /// Base64 without padding, exactly as `ssh-keygen -lf` prints it.
    pub fn fingerprint(&self) -> String {
        let digest = Sha256::digest(&self.blob);
        format!(
            "SHA256:{}",
            base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
        )
    }

    fn encoded_blob(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(&self.blob)
    }
}

/// The host pattern as it is written in `known_hosts`: bare `hostname` on port
/// 22, `[hostname]:port` otherwise. Getting this wrong would trust a key across
/// ports, which is precisely what the bracket form exists to prevent.
pub fn host_pattern(hostname: &str, port: u16) -> String {
    if port == 22 {
        hostname.to_string()
    } else {
        format!("[{hostname}]:{port}")
    }
}

/// Decide what to do with `key`, given the contents of a `known_hosts` file.
///
/// Matching follows OpenSSH: an entry applies when one of its comma-separated
/// patterns equals the host pattern (plain entries) or its HMAC matches (hashed
/// entries), **and** the algorithm matches. A `@revoked` marker wins over
/// everything; otherwise a mismatching key for a matching host is
/// [`Verdict::Changed`], and only a byte-identical key is [`Verdict::Trusted`].
pub fn verify(known_hosts: &str, hostname: &str, port: u16, key: &PresentedKey) -> Verdict {
    let pattern = host_pattern(hostname, port);
    let encoded = key.encoded_blob();
    let mut changed: Option<String> = None;

    for line in known_hosts.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (marker, rest) = match line.strip_prefix('@') {
            Some(tail) => match tail.split_once(char::is_whitespace) {
                Some((m, r)) => (Some(m), r.trim_start()),
                None => continue,
            },
            None => (None, line),
        };
        // `hosts keytype base64 [comment]`
        let mut fields = rest.split_whitespace();
        let (Some(hosts), Some(keytype), Some(blob)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        if !hosts_match(hosts, &pattern) {
            continue;
        }
        // `@cert-authority` lines delegate trust to a CA, which this build does
        // not implement; skipping them is what keeps us from misreading a CA key
        // as the host's own and reporting a bogus "changed key".
        if marker == Some("cert-authority") {
            continue;
        }
        if marker == Some("revoked") {
            return Verdict::Revoked;
        }
        if !keytype.eq_ignore_ascii_case(&key.algorithm) {
            // A different algorithm for the same host is normal (a server offers
            // several); it is neither a match nor a mismatch.
            continue;
        }
        if blob == encoded {
            return Verdict::Trusted;
        }
        // Remember, but keep scanning: a later line may hold the right key, and
        // reporting "changed" while a matching entry exists would be a false
        // alarm the user cannot act on.
        if changed.is_none() {
            changed = Some(fingerprint_of_encoded(blob));
        }
    }

    match changed {
        Some(stored_fingerprint) => Verdict::Changed { stored_fingerprint },
        None => Verdict::Unknown,
    }
}

/// Whether a `known_hosts` host field (comma-separated patterns, possibly
/// hashed) covers `pattern`.
fn hosts_match(field: &str, pattern: &str) -> bool {
    if let Some(rest) = field.strip_prefix("|1|") {
        return hashed_match(rest, pattern);
    }
    // Negations (`!host`) exist in OpenSSH patterns; an entry that negates our
    // host must not be treated as covering it.
    let mut matched = false;
    for candidate in field.split(',') {
        if let Some(negated) = candidate.strip_prefix('!') {
            if negated.eq_ignore_ascii_case(pattern) {
                return false;
            }
            continue;
        }
        if candidate.eq_ignore_ascii_case(pattern) {
            matched = true;
        }
    }
    matched
}

/// `|1|<base64 salt>|<base64 hmac>` — HMAC-SHA1 of the host pattern, keyed by
/// the salt, as `HashKnownHosts yes` writes it.
fn hashed_match(rest: &str, pattern: &str) -> bool {
    let Some((salt_b64, hash_b64)) = rest.split_once('|') else {
        return false;
    };
    let engine = base64::engine::general_purpose::STANDARD;
    let (Ok(salt), Ok(expected)) = (engine.decode(salt_b64), engine.decode(hash_b64)) else {
        return false;
    };
    hmac_sha1(&salt, pattern.as_bytes()) == expected
}

/// HMAC-SHA1 (RFC 2104). Written out rather than pulled in as a dependency:
/// it is fifteen lines, and it is used for exactly one thing — reading a file
/// format OpenSSH froze years ago. SHA-1 here is OpenSSH's choice of *lookup*
/// key, not a security check: the key comparison itself is byte-exact.
fn hmac_sha1(key: &[u8], message: &[u8]) -> Vec<u8> {
    use sha1::Sha1;
    const BLOCK: usize = 64;
    let mut k = if key.len() > BLOCK {
        Sha1::digest(key).to_vec()
    } else {
        key.to_vec()
    };
    k.resize(BLOCK, 0);
    let mut ipad = vec![0x36u8; BLOCK];
    let mut opad = vec![0x5cu8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let inner = Sha1::digest([ipad.as_slice(), message].concat());
    Sha1::digest([opad.as_slice(), inner.as_slice()].concat()).to_vec()
}

/// Fingerprint of a base64 blob already stored in `known_hosts`, for the
/// "the key changed" message. Unparsable base64 yields a marker rather than an
/// error: the verdict does not depend on it, only the wording does.
fn fingerprint_of_encoded(blob: &str) -> String {
    match base64::engine::general_purpose::STANDARD.decode(blob) {
        Ok(bytes) => {
            let digest = Sha256::digest(&bytes);
            format!(
                "SHA256:{}",
                base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
            )
        }
        Err(_) => "SHA256:<unreadable entry>".to_string(),
    }
}

/// The line to append to `known_hosts` once the user has confirmed a new host.
/// Callers write it only after an explicit confirmation — this function exists
/// so the *format* lives next to the parser that has to read it back.
pub fn trust_line(hostname: &str, port: u16, key: &PresentedKey) -> String {
    format!(
        "{} {} {}",
        host_pattern(hostname, port),
        key.algorithm,
        key.encoded_blob()
    )
}

/// Read the user's `known_hosts`, returning an empty string when there is none
/// (a first-ever connection is [`Verdict::Unknown`], not an error).
pub fn read_known_hosts(path: &std::path::Path) -> Result<String, AppError> {
    match std::fs::read_to_string(path) {
        Ok(body) => Ok(body),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(AppError::Io(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(algorithm: &str, seed: u8) -> PresentedKey {
        PresentedKey {
            algorithm: algorithm.to_string(),
            blob: vec![seed; 32],
        }
    }

    fn line_for(host: &str, k: &PresentedKey) -> String {
        format!("{} {} {}", host, k.algorithm, k.encoded_blob())
    }

    #[test]
    fn an_exact_match_is_trusted() {
        let k = key("ssh-ed25519", 1);
        let file = line_for("build-box", &k);
        assert_eq!(verify(&file, "build-box", 22, &k), Verdict::Trusted);
    }

    #[test]
    fn an_empty_or_missing_file_is_unknown_not_trusted() {
        let k = key("ssh-ed25519", 1);
        assert_eq!(verify("", "build-box", 22, &k), Verdict::Unknown);
        assert_eq!(
            verify("# only a comment\n\n", "build-box", 22, &k),
            Verdict::Unknown
        );
    }

    #[test]
    fn a_different_key_for_a_known_host_is_changed_not_unknown() {
        // The distinction this whole module exists for: "I have never seen this
        // host" and "this host's key is not the one I have" must not collapse.
        let stored = key("ssh-ed25519", 1);
        let presented = key("ssh-ed25519", 2);
        let file = line_for("build-box", &stored);
        match verify(&file, "build-box", 22, &presented) {
            Verdict::Changed { stored_fingerprint } => {
                assert_eq!(stored_fingerprint, stored.fingerprint());
            }
            other => panic!("expected Changed, got {other:?}"),
        }
    }

    #[test]
    fn a_second_line_holding_the_right_key_wins_over_an_earlier_mismatch() {
        // Servers rotate keys and users append; a stale line above the current
        // one must not raise a man-in-the-middle alarm.
        let old = key("ssh-ed25519", 1);
        let current = key("ssh-ed25519", 2);
        let file = format!(
            "{}\n{}\n",
            line_for("build-box", &old),
            line_for("build-box", &current)
        );
        assert_eq!(verify(&file, "build-box", 22, &current), Verdict::Trusted);
    }

    #[test]
    fn another_algorithm_for_the_same_host_is_not_a_mismatch() {
        let rsa = key("ssh-rsa", 9);
        let ed = key("ssh-ed25519", 1);
        let file = line_for("build-box", &rsa);
        assert_eq!(verify(&file, "build-box", 22, &ed), Verdict::Unknown);
    }

    #[test]
    fn a_non_default_port_uses_the_bracket_form_and_does_not_leak_across_ports() {
        let k = key("ssh-ed25519", 1);
        assert_eq!(host_pattern("h", 22), "h");
        assert_eq!(host_pattern("h", 2222), "[h]:2222");

        let file = line_for("[build-box]:2222", &k);
        assert_eq!(verify(&file, "build-box", 2222, &k), Verdict::Trusted);
        // The same key on the default port is a different entry entirely.
        assert_eq!(verify(&file, "build-box", 22, &k), Verdict::Unknown);
    }

    #[test]
    fn comma_separated_aliases_all_match() {
        let k = key("ssh-ed25519", 1);
        let file = line_for("build-box,10.0.0.5,[build-box]:2222", &k);
        assert_eq!(verify(&file, "10.0.0.5", 22, &k), Verdict::Trusted);
        assert_eq!(verify(&file, "build-box", 2222, &k), Verdict::Trusted);
    }

    #[test]
    fn a_negated_pattern_does_not_cover_the_host() {
        let k = key("ssh-ed25519", 1);
        let file = line_for("!build-box,other", &k);
        assert_eq!(verify(&file, "build-box", 22, &k), Verdict::Unknown);
    }

    #[test]
    fn a_revoked_host_is_refused_and_never_offered_for_trust() {
        let k = key("ssh-ed25519", 1);
        let file = format!("@revoked {}", line_for("build-box", &k));
        assert_eq!(verify(&file, "build-box", 22, &k), Verdict::Revoked);
    }

    #[test]
    fn a_cert_authority_line_is_skipped_rather_than_read_as_the_host_key() {
        let ca = key("ssh-ed25519", 7);
        let presented = key("ssh-ed25519", 1);
        let file = format!("@cert-authority {}", line_for("build-box", &ca));
        // Not "changed": the CA key is not the host's key, and claiming a
        // mismatch here would be a false alarm the user cannot resolve.
        assert_eq!(verify(&file, "build-box", 22, &presented), Verdict::Unknown);
    }

    #[test]
    fn hashed_entries_are_matched_so_a_hashed_file_is_not_all_unknown() {
        // `HashKnownHosts yes` is the default on several distros; without this,
        // every host would look new and the user would be asked to trust each
        // one forever.
        let k = key("ssh-ed25519", 1);
        let salt = [0x11u8; 20];
        let engine = base64::engine::general_purpose::STANDARD;
        let hash = hmac_sha1(&salt, b"build-box");
        let hashed = format!("|1|{}|{}", engine.encode(salt), engine.encode(&hash));
        let file = line_for(&hashed, &k);

        assert_eq!(verify(&file, "build-box", 22, &k), Verdict::Trusted);
        assert_eq!(verify(&file, "other-box", 22, &k), Verdict::Unknown);
    }

    #[test]
    fn a_hashed_entry_with_a_different_key_still_reports_changed() {
        let stored = key("ssh-ed25519", 1);
        let presented = key("ssh-ed25519", 2);
        let salt = [0x22u8; 20];
        let engine = base64::engine::general_purpose::STANDARD;
        let hashed = format!(
            "|1|{}|{}",
            engine.encode(salt),
            engine.encode(hmac_sha1(&salt, b"build-box"))
        );
        let file = line_for(&hashed, &stored);
        assert!(matches!(
            verify(&file, "build-box", 22, &presented),
            Verdict::Changed { .. }
        ));
    }

    #[test]
    fn malformed_lines_are_skipped_not_fatal() {
        let k = key("ssh-ed25519", 1);
        let file = format!(
            "garbage\n@\nhost-only\nhost type\n{}\n",
            line_for("build-box", &k)
        );
        assert_eq!(verify(&file, "build-box", 22, &k), Verdict::Trusted);
    }

    #[test]
    fn the_fingerprint_matches_the_openssh_format() {
        // Base64 of the SHA-256 digest, unpadded — what `ssh-keygen -lf` prints
        // and what the confirmation dialog must show for the user to compare.
        let k = key("ssh-ed25519", 1);
        let fp = k.fingerprint();
        assert!(fp.starts_with("SHA256:"), "{fp}");
        assert!(!fp.ends_with('='), "must be unpadded: {fp}");
        assert_eq!(fp.len(), "SHA256:".len() + 43);
    }

    #[test]
    fn a_trust_line_round_trips_through_the_parser() {
        // Whatever we would append must read back as Trusted — otherwise a user
        // could confirm a host and be asked again on the next connection.
        let k = key("ssh-ed25519", 5);
        for port in [22u16, 2222] {
            let line = trust_line("build-box", port, &k);
            assert_eq!(verify(&line, "build-box", port, &k), Verdict::Trusted);
        }
    }

    /// A real `ssh-ed25519` public key in OpenSSH format (generated for tests;
    /// it guards nothing).
    const SAMPLE_OPENSSH_KEY: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB6VNvJmkxWXvGqZjkQXmH1kdCLZVGkVAoPUKGCwHwOr test@uxnan";

    #[test]
    fn a_real_key_from_the_ssh_library_agrees_with_our_own_fingerprint() {
        // Cross-check against the library's implementation: if our SHA-256 /
        // base64 handling ever drifted, the dialog would show the user a
        // fingerprint that does not match what `ssh-keygen` shows them, and the
        // comparison they are being asked to make would be worthless.
        use russh::keys::ssh_key::{HashAlg, PublicKey};

        let parsed = PublicKey::from_openssh(SAMPLE_OPENSSH_KEY).expect("valid openssh key");
        let ours = PresentedKey::from_ssh_key(&parsed).expect("key converts");

        assert_eq!(ours.algorithm, "ssh-ed25519");
        assert_eq!(
            ours.fingerprint(),
            parsed.fingerprint(HashAlg::Sha256).to_string()
        );

        // And the blob is the one `known_hosts` stores, so a line written from a
        // live connection reads back as trusted.
        let line = trust_line("build-box", 22, &ours);
        assert!(
            line.contains("AAAAC3NzaC1lZDI1NTE5AAAAIB6VNvJmkxWXvGqZjkQXmH1kdCLZVGkVAoPUKGCwHwOr")
        );
        assert_eq!(verify(&line, "build-box", 22, &ours), Verdict::Trusted);
    }

    #[test]
    fn a_missing_known_hosts_file_reads_as_empty() {
        let path = std::path::Path::new("C:/definitely/not/here/known_hosts");
        assert_eq!(read_known_hosts(path).unwrap(), "");
    }
}
