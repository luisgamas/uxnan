//! Argument validation against a catalog entry's schema.
//!
//! The schemas are a small, closed subset of JSON Schema (an object with typed
//! properties, a `required` list, `additionalProperties: false`, and per
//! property `enum`, `minimum` / `maximum` and `maxLength`), so they are checked
//! here directly instead of pulling a validator crate in for a screenful of
//! rules. A misspelled or extra argument is an error the caller sees —
//! for an agent, silently ignoring one is how it "calls" a tool and nothing
//! happens.

use serde_json::Value;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

/// Check `params` against `schema`. `null`/absent params count as `{}`.
pub fn validate(schema: &Value, params: &Value) -> Result<(), RpcError> {
    let empty = serde_json::Map::new();
    let obj = match params {
        Value::Null => &empty,
        Value::Object(m) => m,
        _ => {
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                "params must be an object",
            ))
        }
    };
    let props = schema
        .get("properties")
        .and_then(|p| p.as_object())
        .cloned()
        .unwrap_or_default();
    for key in obj.keys() {
        if !props.contains_key(key) {
            let known: Vec<&str> = props.keys().map(String::as_str).collect();
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!(
                    "unknown argument `{key}`; accepted: {}",
                    if known.is_empty() {
                        "none".to_string()
                    } else {
                        known.join(", ")
                    }
                ),
            ));
        }
    }
    if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
        for r in required.iter().filter_map(|r| r.as_str()) {
            let present = obj.get(r).map(|v| !v.is_null()).unwrap_or(false);
            if !present {
                return Err(RpcError::new(
                    ErrorCode::InvalidParams,
                    format!("missing required argument `{r}`"),
                ));
            }
        }
    }
    for (key, value) in obj {
        if value.is_null() {
            continue;
        }
        let expected = props
            .get(key)
            .and_then(|p| p.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("any");
        let ok = match expected {
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "integer" => value.as_i64().is_some(),
            "number" => value.is_number(),
            "array" => value.is_array(),
            "object" => value.is_object(),
            _ => true,
        };
        if !ok {
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!("argument `{key}` must be a {expected}"),
            ));
        }
        if expected == "string" && value.as_str().is_some_and(|s| s.trim().is_empty()) {
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!("argument `{key}` must not be empty"),
            ));
        }
        if let Some(prop) = props.get(key) {
            bounds(key, prop, value)?;
        }
    }
    Ok(())
}

/// The per-property constraints: `enum`, `minimum` / `maximum`, `maxLength`.
fn bounds(key: &str, prop: &Value, value: &Value) -> Result<(), RpcError> {
    let bad = |why: String| Err(RpcError::new(ErrorCode::InvalidParams, why));
    if let Some(allowed) = prop.get("enum").and_then(|e| e.as_array()) {
        if !allowed.contains(value) {
            let list: Vec<String> = allowed.iter().map(|v| v.to_string()).collect();
            return bad(format!(
                "argument `{key}` must be one of {}",
                list.join(", ")
            ));
        }
    }
    if let Some(n) = value.as_f64() {
        if let Some(min) = prop.get("minimum").and_then(|m| m.as_f64()) {
            if n < min {
                return bad(format!("argument `{key}` must be at least {min}"));
            }
        }
        if let Some(max) = prop.get("maximum").and_then(|m| m.as_f64()) {
            if n > max {
                return bad(format!("argument `{key}` must be at most {max}"));
            }
        }
    }
    if let (Some(text), Some(max)) = (
        value.as_str(),
        prop.get("maxLength").and_then(|m| m.as_u64()),
    ) {
        if text.chars().count() as u64 > max {
            return bad(format!("argument `{key}` must be at most {max} characters"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn enforces_enum_range_and_length() {
        let schema = json!({
            "type": "object",
            "properties": {
                "level": { "type": "string", "enum": ["all", "error"] },
                "amount": { "type": "number", "minimum": 0.05, "maximum": 5 },
                "text": { "type": "string", "maxLength": 3 }
            },
            "required": [],
            "additionalProperties": false
        });
        assert!(validate(
            &schema,
            &json!({ "level": "error", "amount": 1, "text": "abc" })
        )
        .is_ok());
        assert!(validate(&schema, &json!({ "level": "warn" })).is_err());
        assert!(validate(&schema, &json!({ "amount": 0 })).is_err());
        assert!(validate(&schema, &json!({ "amount": 9 })).is_err());
        assert!(validate(&schema, &json!({ "text": "abcd" })).is_err());
        // Length counts characters, not bytes.
        assert!(validate(&schema, &json!({ "text": "ñññ" })).is_ok());
    }

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "staged": { "type": "boolean" }
            },
            "required": ["path"],
            "additionalProperties": false
        })
    }

    #[test]
    fn accepts_a_conforming_object_and_null_for_an_empty_schema() {
        assert!(validate(&schema(), &json!({ "path": "a", "staged": true })).is_ok());
        let none = json!({ "type": "object", "properties": {}, "required": [], "additionalProperties": false });
        assert!(validate(&none, &Value::Null).is_ok());
        assert!(validate(&none, &json!({})).is_ok());
    }

    #[test]
    fn names_the_unknown_argument_and_the_accepted_ones() {
        let err = validate(&schema(), &json!({ "path": "a", "stagd": true })).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidParams);
        assert!(err.message.contains("`stagd`"));
        assert!(err.message.contains("path, staged"));
    }

    #[test]
    fn requires_the_required_and_types_the_typed() {
        let missing = validate(&schema(), &json!({ "staged": true })).unwrap_err();
        assert!(missing.message.contains("missing required argument `path`"));
        let wrong = validate(&schema(), &json!({ "path": 3 })).unwrap_err();
        assert!(wrong.message.contains("must be a string"));
        let empty = validate(&schema(), &json!({ "path": "  " })).unwrap_err();
        assert!(empty.message.contains("must not be empty"));
        let not_obj = validate(&schema(), &json!([1])).unwrap_err();
        assert!(not_obj.message.contains("must be an object"));
    }
}
