//! Human-readable rendering of results. `--json` bypasses all of this.
//!
//! Lists become aligned columns; a single record becomes `key: value` lines.
//! Nothing here is a contract — scripts use `--json` — so the layout is free
//! to serve the eye.

use serde_json::Value;

/// Render a result for `method`.
pub fn render(method: &str, value: &Value) -> String {
    match method {
        "status" => status(value),
        "project/list" => table(
            value.get("projects"),
            &["name", "isGit", "target", "path"],
            &[|p: &Value| {
                p["worktrees"]
                    .as_array()
                    .map(|w| w.len())
                    .unwrap_or(0)
                    .to_string()
            }],
            &["worktrees"],
        ),
        "worktree/list" => table(
            value.get("worktrees"),
            &["branch", "path"],
            &[
                |w: &Value| w["project"]["name"].as_str().unwrap_or("").to_string(),
                |w: &Value| {
                    w["agents"]
                        .as_array()
                        .map(|a| a.len())
                        .unwrap_or(0)
                        .to_string()
                },
            ],
            &["project", "agents"],
        ),
        "terminal/list" => table(
            value.get("terminals"),
            &["id", "title", "agentName", "workspace"],
            &[|t: &Value| t["agent"]["status"].as_str().unwrap_or("").to_string()],
            &["state"],
        ),
        "agent/list" => table(
            value.get("agents"),
            &["terminalId", "kind", "status", "tool", "cwd"],
            &[],
            &[],
        ),
        "run/list" => table(
            value.get("runs"),
            &["id", "title", "status", "steps", "completed"],
            &[],
            &[],
        ),
        "terminal/read" => value
            .get("text")
            .and_then(|t| t.as_str())
            .map(|t| format!("{t}\n"))
            .unwrap_or_default(),
        "agent/wait" => format!(
            "{} reached `{}` after {} ms\n",
            value["terminal"].as_str().unwrap_or("?"),
            value["reached"].as_str().unwrap_or("?"),
            value["waitedMs"]
        ),
        "automation/list" => table(
            value.get("automations"),
            &["id", "name", "enabled", "workingDir"],
            &[
                |a: &Value| a["schedule"]["kind"].as_str().unwrap_or("").to_string(),
                |a: &Value| {
                    a["steps"]
                        .as_array()
                        .map(|s| s.len())
                        .unwrap_or(0)
                        .to_string()
                },
            ],
            &["schedule", "steps"],
        ),
        _ => record(value, 0),
    }
}

fn status(v: &Value) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "Uxnan Desktop {} (pid {}), control protocol v{}\n",
        v["version"].as_str().unwrap_or("?"),
        v["pid"],
        v["protocolVersion"]
    ));
    out.push_str(&format!(
        "projects: {}  terminals: {}  agents: {}\n",
        v["counts"]["projects"], v["counts"]["terminals"], v["counts"]["agents"]
    ));
    if let Some(groups) = v["groups"].as_array() {
        let on: Vec<String> = groups
            .iter()
            .filter(|g| g["enabled"] == true)
            .map(|g| format!("{} v{}", g["name"].as_str().unwrap_or(""), g["version"]))
            .collect();
        let off: Vec<&str> = groups
            .iter()
            .filter(|g| g["enabled"] == false)
            .filter_map(|g| g["name"].as_str())
            .collect();
        out.push_str(&format!("groups on: {}\n", on.join(", ")));
        if !off.is_empty() {
            out.push_str(&format!("groups off: {}\n", off.join(", ")));
        }
    }
    if let Some(kind) = v["caller"]["kind"].as_str() {
        match v["caller"]["terminalId"].as_str() {
            Some(id) => out.push_str(&format!("caller: {kind} (terminal {id})\n")),
            None => out.push_str(&format!("caller: {kind}\n")),
        }
    }
    out
}

type Derived = fn(&Value) -> String;

/// An aligned table over an array of objects: `fields` are read directly,
/// `derived` are computed and titled by `derived_titles`.
fn table(
    rows: Option<&Value>,
    fields: &[&str],
    derived: &[Derived],
    derived_titles: &[&str],
) -> String {
    let Some(rows) = rows.and_then(|r| r.as_array()) else {
        return String::new();
    };
    if rows.is_empty() {
        return "(none)\n".into();
    }
    let titles: Vec<String> = fields
        .iter()
        .map(|f| f.to_string())
        .chain(derived_titles.iter().map(|t| t.to_string()))
        .collect();
    let cells: Vec<Vec<String>> = rows
        .iter()
        .map(|r| {
            fields
                .iter()
                .map(|f| scalar(&r[*f]))
                .chain(derived.iter().map(|d| d(r)))
                .collect()
        })
        .collect();
    let widths: Vec<usize> = (0..titles.len())
        .map(|i| {
            cells
                .iter()
                .map(|c| c[i].chars().count())
                .chain(std::iter::once(titles[i].chars().count()))
                .max()
                .unwrap_or(0)
        })
        .collect();
    let line = |c: &[String]| {
        c.iter()
            .enumerate()
            .map(|(i, v)| {
                if i + 1 == c.len() {
                    v.clone()
                } else {
                    format!("{:<w$}", v, w = widths[i])
                }
            })
            .collect::<Vec<_>>()
            .join("  ")
            .trim_end()
            .to_string()
    };
    let mut out = line(&titles);
    out.push('\n');
    for c in &cells {
        out.push_str(&line(c));
        out.push('\n');
    }
    out
}

fn scalar(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => {
            if *b {
                "yes".into()
            } else {
                "no".into()
            }
        }
        other => other.to_string(),
    }
}

/// `key: value` lines, nested objects indented, arrays of scalars inline.
fn record(v: &Value, depth: usize) -> String {
    let pad = "  ".repeat(depth);
    let mut out = String::new();
    match v {
        Value::Object(map) => {
            for (k, val) in map {
                match val {
                    Value::Object(_) => {
                        out.push_str(&format!("{pad}{k}:\n"));
                        out.push_str(&record(val, depth + 1));
                    }
                    Value::Array(items)
                        if items.iter().all(|i| !i.is_object() && !i.is_array()) =>
                    {
                        let inline: Vec<String> = items.iter().map(scalar).collect();
                        out.push_str(&format!("{pad}{k}: [{}]\n", inline.join(", ")));
                    }
                    Value::Array(items) => {
                        out.push_str(&format!("{pad}{k}: ({} items)\n", items.len()));
                        for item in items {
                            out.push_str(&format!("{pad}  -\n"));
                            out.push_str(&record(item, depth + 2));
                        }
                    }
                    other => out.push_str(&format!("{pad}{k}: {}\n", scalar(other))),
                }
            }
        }
        other => out.push_str(&format!("{pad}{}\n", scalar(other))),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_table_aligns_columns_and_derives_cells() {
        let v = json!({ "projects": [
            { "name": "uxnan", "isGit": true, "target": "local", "path": "/p/uxnan", "worktrees": [1, 2] },
            { "name": "x", "isGit": false, "target": "local", "path": "/p/x", "worktrees": [] }
        ]});
        let text = render("project/list", &v);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], "name   isGit  target  path      worktrees");
        assert_eq!(lines[1], "uxnan  yes    local   /p/uxnan  2");
        assert_eq!(lines[2], "x      no     local   /p/x      0");
        assert_eq!(
            render("project/list", &json!({ "projects": [] })),
            "(none)\n"
        );
    }

    #[test]
    fn a_record_nests_and_inlines_scalar_arrays() {
        let v =
            json!({ "path": "/w", "agents": [], "project": { "name": "p" }, "tags": ["a", "b"] });
        let text = render("worktree/show", &v);
        assert!(text.contains("path: /w\n"));
        assert!(text.contains("project:\n  name: p\n"));
        assert!(text.contains("tags: [a, b]\n"));
        assert!(text.contains("agents: []\n"));
    }
}
