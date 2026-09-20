//! Selectors: how a caller names a project, a worktree or a terminal without
//! copying an id off the sidebar.
//!
//! `current` is the anchor of a caller that runs inside Uxnan — its own
//! terminal, and from it its worktree and project. The rest are explicit and
//! work from anywhere. A bare absolute path is accepted as `path:` because it
//! is what a shell produces; a bare word is **not** guessed at (a branch and a
//! project name can collide), so it is an error that names the forms.

use std::fmt;

/// A parsed selector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selector {
    /// The caller's own terminal / worktree / project.
    Current,
    /// An id: a project id or a terminal id.
    Id(String),
    /// An absolute folder path (a project or a worktree).
    Path(String),
    /// A branch name (a worktree).
    Branch(String),
    /// A project's display name.
    Name(String),
}

impl Selector {
    /// Parse the text form. Whitespace around the value is ignored; an empty
    /// value after the prefix is an error.
    pub fn parse(text: &str) -> Result<Selector, SelectorError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(SelectorError::Empty);
        }
        if text == "current" {
            return Ok(Selector::Current);
        }
        for (prefix, make) in [
            ("id:", Selector::Id as fn(String) -> Selector),
            ("path:", Selector::Path),
            ("branch:", Selector::Branch),
            ("name:", Selector::Name),
        ] {
            if let Some(rest) = text.strip_prefix(prefix) {
                let rest = rest.trim();
                if rest.is_empty() {
                    return Err(SelectorError::EmptyValue(prefix));
                }
                return Ok(make(rest.to_string()));
            }
        }
        if is_absolute_path(text) {
            return Ok(Selector::Path(text.to_string()));
        }
        Err(SelectorError::Unrecognized(text.to_string()))
    }
}

/// Whether a string looks like an absolute path on any platform this runs on:
/// POSIX (`/…`), Windows drive (`C:\…` / `C:/…`) or UNC (`\\server\…`).
fn is_absolute_path(s: &str) -> bool {
    if s.starts_with('/') || s.starts_with("\\\\") {
        return true;
    }
    let b = s.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\')
}

impl fmt::Display for Selector {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Selector::Current => write!(f, "current"),
            Selector::Id(v) => write!(f, "id:{v}"),
            Selector::Path(v) => write!(f, "path:{v}"),
            Selector::Branch(v) => write!(f, "branch:{v}"),
            Selector::Name(v) => write!(f, "name:{v}"),
        }
    }
}

/// Why a selector did not parse. The messages name the accepted forms, because
/// the reader is often an agent that will try again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectorError {
    Empty,
    EmptyValue(&'static str),
    Unrecognized(String),
}

impl fmt::Display for SelectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SelectorError::Empty => write!(
                f,
                "empty selector; use `current`, `id:<id>`, `path:<absolute path>`, `branch:<name>` or `name:<project name>`"
            ),
            SelectorError::EmptyValue(prefix) => {
                write!(f, "selector `{prefix}` needs a value after the colon")
            }
            SelectorError::Unrecognized(s) => write!(
                f,
                "unrecognized selector `{s}`; use `current`, `id:<id>`, `path:<absolute path>`, `branch:<name>` or `name:<project name>`"
            ),
        }
    }
}

impl std::error::Error for SelectorError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_form() {
        assert_eq!(Selector::parse("current").unwrap(), Selector::Current);
        assert_eq!(
            Selector::parse(" id:abc ").unwrap(),
            Selector::Id("abc".into())
        );
        assert_eq!(
            Selector::parse("path:/home/dev/app").unwrap(),
            Selector::Path("/home/dev/app".into())
        );
        assert_eq!(
            Selector::parse("branch:feat/x").unwrap(),
            Selector::Branch("feat/x".into())
        );
        assert_eq!(
            Selector::parse("name:uxnan").unwrap(),
            Selector::Name("uxnan".into())
        );
    }

    #[test]
    fn a_bare_absolute_path_is_a_path_on_every_platform() {
        assert_eq!(
            Selector::parse("/home/dev/app").unwrap(),
            Selector::Path("/home/dev/app".into())
        );
        assert_eq!(
            Selector::parse("C:\\Users\\dev\\app").unwrap(),
            Selector::Path("C:\\Users\\dev\\app".into())
        );
        assert_eq!(
            Selector::parse("D:/code/app").unwrap(),
            Selector::Path("D:/code/app".into())
        );
        assert_eq!(
            Selector::parse("\\\\wsl$\\Ubuntu\\home").unwrap(),
            Selector::Path("\\\\wsl$\\Ubuntu\\home".into())
        );
    }

    /// A bare word could be a branch or a project name; guessing would pick the
    /// wrong one silently, so it is refused with the forms spelled out.
    #[test]
    fn a_bare_word_is_refused_with_the_forms() {
        let err = Selector::parse("main").unwrap_err();
        assert!(matches!(err, SelectorError::Unrecognized(_)));
        assert!(err.to_string().contains("branch:<name>"));
        assert_eq!(Selector::parse("").unwrap_err(), SelectorError::Empty);
        assert_eq!(
            Selector::parse("branch:").unwrap_err(),
            SelectorError::EmptyValue("branch:")
        );
    }

    #[test]
    fn display_round_trips() {
        for s in ["current", "id:x", "path:/a", "branch:b", "name:n"] {
            assert_eq!(Selector::parse(s).unwrap().to_string(), s);
        }
    }
}
