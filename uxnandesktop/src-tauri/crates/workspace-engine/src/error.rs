//! What can go wrong inside the engine, in terms the caller can act on.

use std::fmt;

#[derive(Debug)]
pub enum Error {
    /// The operating system's pseudoterminal layer refused something.
    Pty(String),
    /// No such terminal (or other engine object) — it ended, or never existed.
    NotFound(String),
    Io(std::io::Error),
    /// Something the caller asked for cannot be done as asked (an agent's
    /// config that does not parse, a path that cannot be resolved).
    Invalid(String),
    /// A JSON document the engine reads or writes is malformed.
    Json(serde_json::Error),
    /// git refused or failed, in its own words.
    Git(String),
    /// An agent CLI could not be run, or failed, in words a person can act on.
    Agent(String),
    /// The run was cancelled by whoever started it.
    Cancelled,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Pty(m) => write!(f, "pty error: {m}"),
            Error::NotFound(m) => write!(f, "not found: {m}"),
            Error::Io(e) => write!(f, "{e}"),
            Error::Invalid(m) => write!(f, "{m}"),
            Error::Json(e) => write!(f, "{e}"),
            Error::Git(m) => write!(f, "git error: {m}"),
            Error::Agent(m) => write!(f, "agent error: {m}"),
            Error::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e)
    }
}
