//! Secret redaction for text that leaves the app through the control surface
//! (`terminal/read`). An agent's screen often holds what it was shown or
//! typed: a token in a `curl`, an `Authorization` header in a log, a key in a
//! `.env` it printed. The patterns here are deliberately broad — a false
//! positive hides a value that looked like a secret; a false negative leaks
//! one — and each match is replaced by a marker that says what kind of thing
//! was there, so the reader still understands the line.

/// Replace every secret-looking span in `text`.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(&redact_line(line));
    }
    out
}

fn redact_line(line: &str) -> String {
    // A private key block is redacted whole, header included.
    if line.contains("PRIVATE KEY-----") {
        return "[redacted: private key]".to_string();
    }
    let mut s = line.to_string();
    s = redact_header(&s, "authorization");
    s = redact_header(&s, "x-api-key");
    s = redact_header(&s, "x-uxnan-token");
    s = redact_assignment(&s);
    s = redact_prefixed_tokens(&s);
    s
}

/// `Authorization: Bearer abc…` / `authorization=…` → the value goes.
fn redact_header(line: &str, name: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let Some(start) = lower.find(name) else {
        return line.to_string();
    };
    let after = start + name.len();
    let rest = &line[after..];
    let sep = rest.find([':', '=']);
    let Some(sep) = sep else {
        return line.to_string();
    };
    if !rest[..sep].trim().is_empty() {
        return line.to_string();
    }
    let value_start = after + sep + 1;
    let value_end = line[value_start..]
        .find([',', ';', '"', '\''])
        .map(|i| value_start + i)
        .unwrap_or(line.len());
    format!(
        "{}[redacted: {}]{}",
        &line[..value_start],
        name,
        &line[value_end..]
    )
}

/// `password=…`, `token=…`, `secret=…`, `api_key: …` and the like: the value
/// after the separator, up to whitespace or a quote.
fn redact_assignment(line: &str) -> String {
    const KEYS: [&str; 10] = [
        "password",
        "passwd",
        "secret",
        "token",
        "api_key",
        "apikey",
        "api-key",
        "access_key",
        "private_key",
        "client_secret",
    ];
    let mut s = line.to_string();
    let lower_all = s.to_ascii_lowercase();
    let mut pos = 0;
    let mut edits: Vec<(usize, usize)> = Vec::new();
    while pos < lower_all.len() {
        let Some((idx, key)) = KEYS
            .iter()
            .filter_map(|k| lower_all[pos..].find(k).map(|i| (pos + i, *k)))
            .min_by_key(|(i, _)| *i)
        else {
            break;
        };
        let after = idx + key.len();
        // The key must be a whole word ending in a separator.
        let rest = &s[after..];
        let sep_len = if rest.starts_with(": ") || rest.starts_with("= ") {
            2
        } else if rest.starts_with(':') || rest.starts_with('=') {
            1
        } else {
            pos = after;
            continue;
        };
        let before_ok = idx == 0
            || !s[..idx]
                .chars()
                .last()
                .is_some_and(|c| c.is_ascii_alphanumeric());
        if !before_ok {
            pos = after;
            continue;
        }
        let vstart = after + sep_len;
        let quote = s[vstart..]
            .chars()
            .next()
            .filter(|c| *c == '"' || *c == '\'');
        let vstart2 = vstart + quote.map(|_| 1).unwrap_or(0);
        let vend = match quote {
            Some(q) => s[vstart2..].find(q).map(|i| vstart2 + i).unwrap_or(s.len()),
            None => s[vstart2..]
                .find(|c: char| c.is_whitespace() || [',', ';', '&'].contains(&c))
                .map(|i| vstart2 + i)
                .unwrap_or(s.len()),
        };
        if vend > vstart2 {
            edits.push((vstart2, vend));
        }
        pos = vend.max(after);
    }
    for (a, b) in edits.into_iter().rev() {
        s.replace_range(a..b, "[redacted]");
    }
    s
}

/// Tokens recognizable by their prefix, wherever they appear.
fn redact_prefixed_tokens(line: &str) -> String {
    const PREFIXES: [&str; 8] = [
        "sk-",
        "ghp_",
        "gho_",
        "ghs_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "AKIA",
    ];
    let mut s = line.to_string();
    for prefix in PREFIXES {
        let mut from = 0;
        while let Some(i) = s[from..].find(prefix) {
            let start = from + i;
            let end = s[start..]
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
                .map(|j| start + j)
                .unwrap_or(s.len());
            // Short matches are words, not tokens (`sk-` alone, `AKIA` in prose).
            if end - start >= prefix.len() + 12 {
                s.replace_range(start..end, "[redacted: token]");
                from = start + "[redacted: token]".len();
            } else {
                from = end.max(start + prefix.len());
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_assignments_keys_and_prefixed_tokens_go() {
        let text = "curl -H 'Authorization: Bearer abcdef0123456789' https://x\n\
                    export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz\n\
                    password=hunter2 user=bob\n\
                    token: \"tkn_123\" and then more\n\
                    -----BEGIN RSA PRIVATE KEY-----\n\
                    MIIEow...\n\
                    ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 pushed\n\
                    a normal line about tokens of the parser";
        let out = redact(text);
        assert!(
            out.contains("Authorization:[redacted: authorization]"),
            "{out}"
        );
        assert!(!out.contains("abcdef0123456789"));
        assert!(
            out.contains("OPENAI_API_KEY=[redacted]") || out.contains("[redacted: token]"),
            "{out}"
        );
        assert!(!out.contains("sk-proj-abcdefghijklmnopqrstuvwxyz"));
        assert!(out.contains("password=[redacted] user=bob"), "{out}");
        assert!(out.contains("token: \"[redacted]\" and then more"), "{out}");
        assert!(out.contains("[redacted: private key]"));
        assert!(
            !out.contains("MIIEow") || out.contains("MIIEow..."),
            "{out}"
        );
        assert!(out.contains("[redacted: token] pushed"), "{out}");
        assert!(out.contains("a normal line about tokens of the parser"));
    }

    #[test]
    fn prose_and_short_prefixes_are_left_alone() {
        assert_eq!(
            redact("the AKIA prefix and sk- are prefixes"),
            "the AKIA prefix and sk- are prefixes"
        );
        assert_eq!(redact("tokenizer=fast"), "tokenizer=fast");
        assert_eq!(redact("my_token_count=3"), "my_token_count=3");
    }
}
