//! Ports a terminal announces, read from what it prints.
//!
//! **Why the output and not the machine.** Asking a host what it is listening on
//! costs a shell start per question (`ssh::ports`), so it cannot be the thing
//! that runs continuously. But a dev server tells you its address the moment it
//! is ready — `Local: http://localhost:5173/` — and that line is already
//! crossing the wire on its way to the terminal. Reading it costs nothing, needs
//! nothing installed, and works the same on any host and any shell, because it
//! is the *program* talking, not the machine.
//!
//! **Only real URLs count.** A number that looks like a port is not one: build
//! output, stack traces and progress bars are full of `:3000`-shaped text. So
//! the scanner takes an `http(s)` URL on a loopback or wildcard address and
//! nothing else — the shape a server prints when it wants to be opened.
//!
//! **Escape sequences come off first, and this is not cosmetic.** Vite prints
//! its port in bold: the bytes on the wire are `http://localhost:\e[1m5173\e[22m/`.
//! A scanner reading raw output finds `localhost:` followed by an escape and
//! reports nothing at all — the single most common dev server in the ecosystem,
//! missed. What is stripped is CSI and OSC, which is what a terminal writes
//! around text; the text itself is what remains.

/// A port a terminal announced, with the address it announced it on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Announced {
    pub port: u16,
    /// The URL as it would be opened here once the port is reachable — the path
    /// is kept, because a server that announces `/admin` means that page.
    pub path: String,
}

/// Everything a chunk of terminal output announces.
///
/// Callers hold a [`Tail`] across chunks: a URL split between two writes is the
/// normal case, not an edge one, since a PTY delivers whatever happens to be in
/// the buffer.
pub fn scan(text: &str) -> Vec<Announced> {
    let mut found = Vec::new();
    let plain = strip_ansi(text);
    let mut rest = plain.as_str();
    while let Some(at) = rest.find("http") {
        rest = &rest[at..];
        let Some((announced, used)) = url_at(rest) else {
            // Not a URL after all: step past this `http` so the scan advances.
            rest = &rest[4..];
            continue;
        };
        if !found.contains(&announced) {
            found.push(announced);
        }
        rest = &rest[used..];
    }
    found
}

/// Parse one `http(s)://<loopback>:<port><path>` at the start of `text`,
/// answering it and how many bytes it took.
fn url_at(text: &str) -> Option<(Announced, usize)> {
    let after_scheme = text
        .strip_prefix("http://")
        .or_else(|| text.strip_prefix("https://"))?;
    let scheme_len = text.len() - after_scheme.len();

    let authority_len = after_scheme
        .find(|c: char| c == '/' || c.is_whitespace() || c == '"' || c == '\'' || c == ')')
        .unwrap_or(after_scheme.len());
    let (authority, tail) = after_scheme.split_at(authority_len);
    let (host, port) = authority.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    if port == 0 {
        return None;
    }
    // Only an address that means "this machine" to whoever printed it. A URL to
    // a public host is a link, not a port on the machine that printed it.
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if !matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0" | "::" | "::1") {
        return None;
    }

    let path_len = tail
        .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ')')
        .unwrap_or(tail.len());
    let path = &tail[..path_len];
    // A trailing period is a sentence ending, not part of the address.
    let path = path.trim_end_matches('.');
    Some((
        Announced {
            port,
            path: if path.is_empty() {
                "/".into()
            } else {
                path.into()
            },
        },
        scheme_len + authority_len + path_len,
    ))
}

/// Carry the end of one chunk into the next, so a URL split across writes is
/// still found — and found **once**.
///
/// The overlap is bounded: a URL long enough not to fit is one nobody is going
/// to click anyway, and an unbounded buffer of terminal output is a memory leak
/// with extra steps.
#[derive(Debug, Default)]
pub struct Tail(String);

/// Longest fragment carried between chunks. Comfortably more than
/// `http://localhost:65535/` plus a path.
const TAIL_BYTES: usize = 256;

impl Tail {
    /// Scan `chunk` together with what was left over from the previous one.
    pub fn scan(&mut self, chunk: &str) -> Vec<Announced> {
        let joined = format!("{}{chunk}", self.0);
        let found = scan(&joined);
        // Keep the end, on a character boundary: terminal output is bytes, and
        // slicing one in half would panic on the next `format!`.
        let keep = joined.len().saturating_sub(TAIL_BYTES);
        let keep = (keep..joined.len())
            .find(|i| joined.is_char_boundary(*i))
            .unwrap_or(joined.len());
        self.0 = joined[keep..].to_string();
        found
    }
}

/// Remove CSI (`\e[…`) and OSC (`\e]…`) sequences, leaving the text a person
/// would see. Everything else is passed through untouched — this is not a
/// terminal emulator, it only needs the words back.
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.next() {
            // CSI: parameters, then a final byte in @..~
            Some('[') => {
                for c in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&c) {
                        break;
                    }
                }
            }
            // OSC: ends at BEL or ESC \
            Some(']') => {
                while let Some(c) = chars.next() {
                    if c == '\u{7}' {
                        break;
                    }
                    if c == '\u{1b}' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
            }
            // A two-byte escape: drop both.
            Some(_) => {}
            None => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ports(text: &str) -> Vec<u16> {
        scan(text).into_iter().map(|a| a.port).collect()
    }

    #[test]
    fn it_reads_the_line_vite_prints() {
        // The real bytes, bold port included. Without stripping the escapes this
        // finds nothing, which is how the most common dev server in the
        // ecosystem would have been missed.
        let vite = "  \u{1b}[32m➜\u{1b}[39m  \u{1b}[1mLocal\u{1b}[22m:   \
                    \u{1b}[36mhttp://localhost:\u{1b}[1m5173\u{1b}[22m/\u{1b}[39m\r\n";
        assert_eq!(ports(vite), vec![5173]);
        assert_eq!(scan(vite)[0].path, "/");
    }

    #[test]
    fn it_reads_the_plain_lines_other_servers_print() {
        assert_eq!(
            ports("Server listening at http://127.0.0.1:8000/admin\n"),
            vec![8000]
        );
        assert_eq!(scan("… http://127.0.0.1:8000/admin\n")[0].path, "/admin");
        assert_eq!(ports("Now listening on: http://0.0.0.0:5000\n"), vec![5000]);
        assert_eq!(
            ports("ready - started server on http://[::1]:3000\n"),
            vec![3000]
        );
    }

    #[test]
    fn a_number_that_merely_looks_like_a_port_is_not_one() {
        // Build output and stack traces are full of these. Reporting them would
        // fill the list with ports nothing is listening on.
        assert!(ports("webpack 5.91.0 compiled in 3000 ms\n").is_empty());
        assert!(ports("  at main (/app/src/index.ts:3000:12)\n").is_empty());
        assert!(ports("Elapsed: 00:05:173\n").is_empty());
    }

    #[test]
    fn a_url_to_somewhere_else_is_a_link_not_a_port() {
        // The machine that printed it is not the one serving it.
        assert!(ports("Docs: https://vite.dev:443/guide\n").is_empty());
        assert!(ports("See http://example.com:8080/\n").is_empty());
    }

    #[test]
    fn the_same_port_twice_in_one_chunk_is_announced_once() {
        let both = "Local: http://localhost:5173/ and again http://localhost:5173/\n";
        assert_eq!(ports(both), vec![5173]);
    }

    #[test]
    fn a_url_split_across_two_writes_is_still_found() {
        // A PTY delivers whatever is in the buffer, so this is the ordinary
        // case: the write boundary lands mid-URL.
        let mut tail = Tail::default();
        assert!(tail.scan("  Local:   http://local").is_empty());
        assert_eq!(
            tail.scan("host:5173/\r\n")
                .into_iter()
                .map(|a| a.port)
                .collect::<Vec<_>>(),
            vec![5173]
        );
    }

    #[test]
    fn the_carried_tail_stays_bounded() {
        // Terminal output is endless; the scanner's memory must not be.
        let mut tail = Tail::default();
        for _ in 0..50 {
            tail.scan(&"x".repeat(1000));
        }
        assert!(tail.0.len() <= TAIL_BYTES);
    }

    #[test]
    fn multibyte_output_does_not_split_a_character() {
        // Terminal output is full of box drawing and arrows; slicing the tail on
        // a byte would panic on the next chunk.
        let mut tail = Tail::default();
        for _ in 0..20 {
            tail.scan(&"➜ ".repeat(100));
        }
        assert!(tail.0.is_char_boundary(0));
    }
}
