//! Prompt templating — the blackboard that carries one agent's output into the
//! next agent's prompt.
//!
//! A step's prompt may reference values produced earlier with `{{…}}`:
//!
//! | Token | Value |
//! |---|---|
//! | `{{steps.s1.output}}` | step `s1`'s captured stdout **in this run** |
//! | `{{steps.s1.title}}`  | step `s1`'s title |
//! | `{{prev.s1.output}}`  | step `s1`'s output in the **previous** run of this automation |
//! | `{{workingDir}}`      | the directory the run executes in |
//!
//! `prev.*` is what makes a recurring automation able to continue yesterday's
//! work instead of starting from zero every time.
//!
//! Resolution is intentionally forgiving: an unknown or not-yet-produced
//! reference resolves to an empty string and is reported in
//! [`Resolution::missing`], so a run records the thin hand-off instead of dying
//! on it. Kept dependency-free (a hand-rolled scanner, no regex crate).

use std::collections::HashMap;

/// The outcome of resolving one prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolution {
    /// The prompt with every reference substituted.
    pub text: String,
    /// References that had no value (substituted with ""), in first-seen order,
    /// deduplicated — so a run record can explain a thin hand-off.
    pub missing: Vec<String>,
}

/// Substitute every `{{token}}` in `prompt` from `vars`.
///
/// An unterminated `{{` is left verbatim (it is far more likely to be literal
/// text the user wants the agent to see than a typo worth destroying).
pub fn resolve(prompt: &str, vars: &HashMap<String, String>) -> Resolution {
    let mut text = String::with_capacity(prompt.len());
    let mut missing: Vec<String> = Vec::new();
    let bytes = prompt.as_bytes();
    let mut i = 0usize;

    while i < prompt.len() {
        if bytes[i] == b'{' && i + 1 < prompt.len() && bytes[i + 1] == b'{' {
            if let Some(end) = find_close(prompt, i + 2) {
                let token = prompt[i + 2..end].trim();
                match vars.get(token) {
                    Some(value) if !value.is_empty() => text.push_str(value),
                    _ => {
                        let owned = token.to_string();
                        if !missing.contains(&owned) {
                            missing.push(owned);
                        }
                    }
                }
                i = end + 2;
                continue;
            }
        }
        // Not a token start (or unterminated): copy this char through verbatim.
        let ch_len = char_len(bytes[i]);
        text.push_str(&prompt[i..i + ch_len]);
        i += ch_len;
    }

    Resolution { text, missing }
}

/// Byte index of the `}}` that closes a token opened at `from`, or `None`.
fn find_close(s: &str, from: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = from;
    while i + 1 < s.len() {
        if bytes[i] == b'}' && bytes[i + 1] == b'}' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Length in bytes of the UTF-8 char starting with `first`.
const fn char_len(first: u8) -> usize {
    if first < 0x80 {
        1
    } else if first >> 5 == 0b110 {
        2
    } else if first >> 4 == 0b1110 {
        3
    } else {
        4
    }
}

/// Every token a prompt references, deduplicated in first-seen order. The
/// editor uses this to derive a step's dependencies from its own prompt, so
/// referencing `{{steps.s1.output}}` is enough to make the step wait for `s1`.
pub fn referenced_tokens(prompt: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let bytes = prompt.as_bytes();
    let mut i = 0usize;
    while i < prompt.len() {
        if bytes[i] == b'{' && i + 1 < prompt.len() && bytes[i + 1] == b'{' {
            if let Some(end) = find_close(prompt, i + 2) {
                let token = prompt[i + 2..end].trim().to_string();
                if !token.is_empty() && !out.contains(&token) {
                    out.push(token);
                }
                i = end + 2;
                continue;
            }
        }
        i += char_len(bytes[i]);
    }
    out
}

/// The step ids a prompt depends on — the `steps.<id>.*` references only.
/// `prev.*` reads the *previous* run, so it never creates a dependency inside
/// this one.
pub fn referenced_step_ids(prompt: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for token in referenced_tokens(prompt) {
        let Some(rest) = token.strip_prefix("steps.") else {
            continue;
        };
        let id = rest.split('.').next().unwrap_or("");
        if !id.is_empty() && !out.iter().any(|x| x == id) {
            out.push(id.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn substitutes_and_reports_missing() {
        let v = vars(&[("steps.s1.output", "FINDINGS")]);
        let r = resolve("Review: {{steps.s1.output}} / {{steps.s2.output}}", &v);
        assert_eq!(r.text, "Review: FINDINGS / ");
        assert_eq!(r.missing, vec!["steps.s2.output"]);
    }

    #[test]
    fn an_empty_value_counts_as_missing() {
        // A step that completed with no stdout is a thin hand-off worth recording.
        let v = vars(&[("steps.s1.output", "")]);
        let r = resolve("{{steps.s1.output}}", &v);
        assert_eq!(r.text, "");
        assert_eq!(r.missing, vec!["steps.s1.output"]);
    }

    #[test]
    fn tolerates_inner_spaces_and_dedupes_missing() {
        let r = resolve(
            "{{ steps.s9.output }} and {{steps.s9.output}}",
            &HashMap::new(),
        );
        assert_eq!(r.text, " and ");
        assert_eq!(r.missing, vec!["steps.s9.output"]);
    }

    #[test]
    fn unterminated_braces_are_left_verbatim() {
        let r = resolve("use {{ this literally", &HashMap::new());
        assert_eq!(r.text, "use {{ this literally");
        assert!(r.missing.is_empty());
    }

    #[test]
    fn multibyte_text_survives_substitution() {
        // The scanner walks bytes; it must never split a UTF-8 char.
        let v = vars(&[("workingDir", "C:/proyectos/café")]);
        let r = resolve("Análisis en {{workingDir}} — ¿listo?", &v);
        assert_eq!(r.text, "Análisis en C:/proyectos/café — ¿listo?");
    }

    #[test]
    fn step_ids_come_only_from_this_run() {
        let ids = referenced_step_ids(
            "{{steps.s1.output}} {{prev.s4.output}} {{steps.s1.title}} {{steps.s2.output}} {{workingDir}}",
        );
        // s1 deduped, prev.s4 excluded (it reads the previous run), workingDir ignored.
        assert_eq!(ids, vec!["s1", "s2"]);
    }
}
