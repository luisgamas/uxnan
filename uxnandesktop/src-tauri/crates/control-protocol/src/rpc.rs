//! The wire envelope of the RPC transport: JSON-RPC 2.0, one request per call,
//! plus the error codes this protocol adds to the standard ones.
//!
//! The MCP transport has its own envelope (the MCP handshake), but a tool call
//! that fails is reported with the same [`ErrorCode`] and message in-band, so an
//! agent and a script read the same reason for the same failure.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A request as the client sends it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub params: Value,
}

impl Request {
    pub fn new(id: impl Into<Value>, method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id: id.into(),
            method: method.into(),
            params,
        }
    }
}

/// A response as the app returns it: exactly one of `result` / `error`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    pub fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: Value, error: RpcError) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(error),
        }
    }
}

/// Error codes. The negative five-digit ones are JSON-RPC's own; the `-320xx`
/// block is this protocol's, each one a distinct situation a client may want
/// to act on differently (retry, ask the person, give up).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "i64", try_from = "i64")]
pub enum ErrorCode {
    /// The body was not valid JSON.
    ParseError,
    /// The envelope was not a valid request.
    InvalidRequest,
    /// No catalog entry has this name.
    MethodNotFound,
    /// The params did not match the entry's schema, or a selector was malformed.
    InvalidParams,
    /// The app failed while carrying the request out.
    Internal,
    /// The entry's capability group is switched off (`settings.control.disabledGroups`).
    GroupDisabled,
    /// A selector named nothing: no such project, worktree or terminal.
    NotFound,
    /// The selector names something outside the caller's scope: a per-launch
    /// token reaches only the project its terminal runs in, and a launch
    /// request that named no terminal reaches none. (`uxnan-cli` also reports
    /// a refused token — the HTTP `401` — under this code.)
    ScopeDenied,
    /// The part of the app that owns this resource (its window) is not ready.
    Unavailable,
    /// The target is busy (an agent that is working, a run that is running).
    Busy,
    /// A wait ran out of time.
    Timeout,
    /// A caller-supplied `protocolVersion` the app does not speak.
    ProtocolMismatch,
    /// Refused by a safety policy or by the person: an action in a browser
    /// page that is not allowed there, or that the person declined (or did not
    /// answer in time).
    Refused,
}

impl ErrorCode {
    pub const fn code(self) -> i64 {
        match self {
            ErrorCode::ParseError => -32700,
            ErrorCode::InvalidRequest => -32600,
            ErrorCode::MethodNotFound => -32601,
            ErrorCode::InvalidParams => -32602,
            ErrorCode::Internal => -32603,
            ErrorCode::GroupDisabled => -32001,
            ErrorCode::NotFound => -32002,
            ErrorCode::ScopeDenied => -32003,
            ErrorCode::Unavailable => -32004,
            ErrorCode::Busy => -32005,
            ErrorCode::Timeout => -32006,
            ErrorCode::ProtocolMismatch => -32007,
            ErrorCode::Refused => -32008,
        }
    }

    /// The process exit status `uxnan-cli` maps the code to. Documented in
    /// `docs/control-api.md`; scripts branch on these.
    pub const fn exit_status(self) -> i32 {
        match self {
            ErrorCode::ParseError | ErrorCode::InvalidRequest | ErrorCode::Internal => 1,
            ErrorCode::MethodNotFound | ErrorCode::InvalidParams => 2,
            ErrorCode::Unavailable => 3,
            ErrorCode::ProtocolMismatch => 4,
            ErrorCode::GroupDisabled | ErrorCode::ScopeDenied => 5,
            ErrorCode::Timeout => 6,
            ErrorCode::NotFound => 7,
            ErrorCode::Busy => 8,
            ErrorCode::Refused => 9,
        }
    }
}

impl From<ErrorCode> for i64 {
    fn from(c: ErrorCode) -> i64 {
        c.code()
    }
}

impl TryFrom<i64> for ErrorCode {
    type Error = String;
    fn try_from(v: i64) -> Result<Self, Self::Error> {
        Ok(match v {
            -32700 => ErrorCode::ParseError,
            -32600 => ErrorCode::InvalidRequest,
            -32601 => ErrorCode::MethodNotFound,
            -32602 => ErrorCode::InvalidParams,
            -32603 => ErrorCode::Internal,
            -32001 => ErrorCode::GroupDisabled,
            -32002 => ErrorCode::NotFound,
            -32003 => ErrorCode::ScopeDenied,
            -32004 => ErrorCode::Unavailable,
            -32005 => ErrorCode::Busy,
            -32006 => ErrorCode::Timeout,
            -32007 => ErrorCode::ProtocolMismatch,
            -32008 => ErrorCode::Refused,
            other => return Err(format!("unknown error code {other}")),
        })
    }
}

/// The error object of a failed response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.code.code())
    }
}

impl std::error::Error for RpcError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_round_trip_and_stay_distinct() {
        let all = [
            ErrorCode::ParseError,
            ErrorCode::InvalidRequest,
            ErrorCode::MethodNotFound,
            ErrorCode::InvalidParams,
            ErrorCode::Internal,
            ErrorCode::GroupDisabled,
            ErrorCode::NotFound,
            ErrorCode::ScopeDenied,
            ErrorCode::Unavailable,
            ErrorCode::Busy,
            ErrorCode::Timeout,
            ErrorCode::ProtocolMismatch,
        ];
        let mut seen = std::collections::HashSet::new();
        for c in all {
            assert!(seen.insert(c.code()), "duplicate code for {c:?}");
            assert_eq!(ErrorCode::try_from(c.code()).unwrap(), c);
        }
        assert!(ErrorCode::try_from(-1).is_err());
    }

    #[test]
    fn error_serializes_as_a_number_code() {
        let e = RpcError::new(ErrorCode::NotFound, "no such worktree");
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], -32002);
        assert_eq!(v["message"], "no such worktree");
        assert!(v.get("data").is_none());
        let back: RpcError = serde_json::from_value(v).unwrap();
        assert_eq!(back.code, ErrorCode::NotFound);
    }

    #[test]
    fn response_carries_exactly_one_side() {
        let ok = serde_json::to_value(Response::ok(1.into(), serde_json::json!({"a": 1}))).unwrap();
        assert!(ok.get("error").is_none());
        assert_eq!(ok["result"]["a"], 1);
        let err = serde_json::to_value(Response::err(
            1.into(),
            RpcError::new(ErrorCode::Busy, "working"),
        ))
        .unwrap();
        assert!(err.get("result").is_none());
        assert_eq!(err["error"]["code"], -32005);
    }
}
