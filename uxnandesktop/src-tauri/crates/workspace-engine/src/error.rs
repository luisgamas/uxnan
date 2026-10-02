//! What can go wrong inside the engine, in terms the caller can act on.

use std::fmt;

#[derive(Debug)]
pub enum Error {
    /// The operating system's pseudoterminal layer refused something.
    Pty(String),
    /// No such terminal (or other engine object) — it ended, or never existed.
    NotFound(String),
    Io(std::io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Pty(m) => write!(f, "pty error: {m}"),
            Error::NotFound(m) => write!(f, "not found: {m}"),
            Error::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}
