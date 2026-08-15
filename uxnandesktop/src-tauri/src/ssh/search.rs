//! Searching a host's project — by file name, and by content.
//!
//! **Why git and not a walk.** Everything else about a host's files goes over
//! SFTP, because it is a subsystem and needs nothing installed. Search is the
//! one thing SFTP cannot do: it has no "find", so the only way to search over it
//! is to list every folder and read every file, one request at a time, across a
//! network. A repository of any size makes that thousands of round trips for one
//! keystroke.
//!
//! The mature remote clients solve this by installing a server on the host that
//! carries `ripgrep`. We decided against a host-side helper (§5.11), and asking
//! for `rg` to be installed would put the feature behind something most machines
//! do not have.
//!
//! So this asks **git**, which every host that this app can already do anything
//! useful with has: the branch, the review and the history all run it there
//! (§5.10b, §5.10c). Two commands, one round trip each:
//!
//! - `git ls-files -co --exclude-standard -z` — every tracked and untracked file
//!   that is not ignored. That is exactly what the local search walks (the
//!   `ignore` crate reads the same `.gitignore` rules), so both machines answer
//!   the same set of files rather than two different notions of "the project".
//! - `git grep -n -I --no-color -z` — the matching lines, without moving a single
//!   file across the link.
//!
//! **The match offsets are computed here**, not there: `git grep` reports lines,
//! not columns, and the highlight has to line up with what the local search
//! would have produced. Each returned line is re-matched with the **same regex
//! the local search builds** (`crate::fs::build_content_regex`), so "what counts
//! as a match" has one definition in this app instead of two.
//!
//! **What this cannot do:** a folder on a host that is not a git repository. The
//! caller is told so plainly rather than being handed an empty result, which is
//! indistinguishable from "nothing matched".

use super::conn::Connection;
use super::shellkind::{quote_arg, ShellKind};
use crate::error::AppError;
use crate::fs::{
    build_content_regex, snippet_for, ContentFileMatch, ContentQuery, ContentSearch, FileSearch,
    FsEntry, SearchFilters, MAX_MATCHES_PER_FILE,
};

/// Search a host's project by file name.
///
/// The query is matched the way the local search matches it — whitespace-split
/// tokens, all of which must appear in the file's project-relative path, case
/// insensitively — because the two search boxes are the same box.
pub async fn files(
    conn: &Connection,
    kind: ShellKind,
    root: &str,
    query: &str,
    include_hidden: bool,
    filters: &SearchFilters,
    limit: usize,
) -> Result<FileSearch, AppError> {
    let tokens: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    if tokens.is_empty() || limit == 0 {
        return Ok(FileSearch {
            entries: Vec::new(),
            truncated: false,
        });
    }
    let listing = list_files(conn, kind, root).await?;
    let globs = crate::fs::CompiledFilters::new(filters);

    let mut entries: Vec<FsEntry> = Vec::new();
    let mut truncated = false;
    for rel in listing {
        if !include_hidden && is_hidden(&rel) {
            continue;
        }
        if !globs.allows(&rel) {
            continue;
        }
        let lowered = rel.to_lowercase();
        if !tokens.iter().all(|t| lowered.contains(t.as_str())) {
            continue;
        }
        let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
        entries.push(FsEntry {
            path: format!("{}/{rel}", root.trim_end_matches('/')),
            name,
            is_dir: false,
            ignored: false,
        });
        if entries.len() >= limit {
            truncated = true;
            break;
        }
    }
    entries.sort_by_key(|e| e.path.to_lowercase());
    Ok(FileSearch { entries, truncated })
}

/// Search a host's project by content.
pub async fn content(
    conn: &Connection,
    kind: ShellKind,
    root: &str,
    query: &ContentQuery,
    include_hidden: bool,
    filters: &SearchFilters,
    limit: usize,
) -> Result<ContentSearch, AppError> {
    if query.query.is_empty() || limit == 0 {
        return Ok(ContentSearch {
            files: Vec::new(),
            total: 0,
            truncated: false,
        });
    }
    // Built before anything is sent: an invalid pattern is the user's to fix,
    // and there is no reason to make a host run a search we cannot read back.
    let re = build_content_regex(query)?;
    let raw = grep(conn, kind, root, query).await?;
    let globs = crate::fs::CompiledFilters::new(filters);

    let mut files: Vec<ContentFileMatch> = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;
    for (rel, line_no, text) in parse_grep(&raw) {
        if !include_hidden && is_hidden(&rel) {
            continue;
        }
        if !globs.allows(&rel) {
            continue;
        }
        // The host found the line; this decides what part of it is the match, so
        // the highlight is the local search's own and not a second opinion.
        let mut hits = Vec::new();
        for m in re.find_iter(&text) {
            if m.start() == m.end() {
                continue;
            }
            let mut snippet = snippet_for(&text, m.start(), m.end());
            snippet.line = line_no;
            hits.push(snippet);
        }
        if hits.is_empty() {
            // git's pattern dialect matched something ours does not (an exotic
            // regex). Dropping the line keeps one definition of a match rather
            // than showing a hit nothing can highlight.
            continue;
        }

        let entry = match files.iter_mut().find(|f| f.path.ends_with(&rel)) {
            Some(existing) => existing,
            None => {
                if files.len() >= limit {
                    truncated = true;
                    break;
                }
                let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
                files.push(ContentFileMatch {
                    path: format!("{}/{rel}", root.trim_end_matches('/')),
                    name,
                    matches: Vec::new(),
                    truncated: false,
                });
                files.last_mut().expect("just pushed")
            }
        };
        for hit in hits {
            if entry.matches.len() >= MAX_MATCHES_PER_FILE {
                entry.truncated = true;
                break;
            }
            entry.matches.push(hit);
            total += 1;
        }
    }
    files.sort_by_key(|f| f.path.to_lowercase());
    Ok(ContentSearch {
        files,
        total: total as u32,
        truncated,
    })
}

/// Whether any segment of a project-relative path starts with a dot — the same
/// rule the local walker applies for "hidden".
fn is_hidden(rel: &str) -> bool {
    rel.split('/').any(|segment| segment.starts_with('.'))
}

/// Every file git knows about in the worktree, project-relative.
async fn list_files(
    conn: &Connection,
    kind: ShellKind,
    root: &str,
) -> Result<Vec<String>, AppError> {
    let p = quote_arg(kind, root);
    // `-c` tracked, `-o` untracked, `--exclude-standard` so ignored files stay
    // ignored, `-z` so a path with a space or a quote in it survives.
    let out = conn
        .exec(&format!("git -C {p} ls-files -co --exclude-standard -z"))
        .await?;
    if out.exit_code != Some(0) {
        return Err(not_a_repository(root));
    }
    Ok(out
        .stdout
        .split('\0')
        .map(str::trim_end_matches_cr)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect())
}

/// Run the search on the host and hand back its raw answer.
async fn grep(
    conn: &Connection,
    kind: ShellKind,
    root: &str,
    query: &ContentQuery,
) -> Result<String, AppError> {
    let p = quote_arg(kind, root);
    // `-I` skips binary files, `-n` numbers the lines, `-z` puts a NUL after the
    // path so a path with a colon in it is still readable, and `--untracked
    // --exclude-standard` matches what the local search walks.
    let mut flags = String::from("-n -I --no-color -z --untracked --exclude-standard");
    if !query.case_sensitive {
        flags.push_str(" -i");
    }
    if query.whole_word {
        flags.push_str(" -w");
    }
    // `-F` is a literal search, `-E` the extended regex git shares most of its
    // syntax with. The pattern is quoted for the host's shell like anything else.
    flags.push_str(if query.is_regex { " -E" } else { " -F" });
    let pattern = quote_arg(kind, &query.query);

    let out = conn
        .exec(&format!("git -C {p} grep {flags} -e {pattern}"))
        .await?;
    match out.exit_code {
        // git grep answers 1 when nothing matched, which is not a failure.
        Some(0) | Some(1) => Ok(out.stdout),
        _ => Err(not_a_repository(root)),
    }
}

fn not_a_repository(root: &str) -> AppError {
    AppError::Invalid(format!(
        "{root} could not be searched on that host: searching asks git, and that folder is not a repository there"
    ))
}

/// Read `git grep -n -z` output: `path\0line\0text`, one record per line.
///
/// Scanned field by field rather than split on newlines first, because a path
/// **can** contain one: `-z` is what makes the path unambiguous, and splitting
/// on `\n` up front would throw that away.
fn parse_grep(raw: &str) -> Vec<(String, u32, String)> {
    let mut out = Vec::new();
    let mut rest = raw;
    while !rest.is_empty() {
        let Some(p_end) = rest.find('\0') else { break };
        let path = &rest[..p_end];
        rest = &rest[p_end + 1..];
        let Some(l_end) = rest.find('\0') else { break };
        let line = &rest[..l_end];
        rest = &rest[l_end + 1..];
        let (text, next) = match rest.find('\n') {
            Some(t_end) => (&rest[..t_end], &rest[t_end + 1..]),
            None => (rest, ""),
        };
        rest = next;
        // A host with CRLF line endings sends the carriage return along.
        let text = text.strip_suffix('\r').unwrap_or(text);
        if let Ok(number) = line.trim().parse::<u32>() {
            out.push((path.to_string(), number, text.to_string()));
        }
    }
    out
}

/// `str::trim_end_matches` with the one pattern this module needs, as a function
/// so it can be used point-free above.
trait TrimCr {
    fn trim_end_matches_cr(&self) -> &str;
}
impl TrimCr for str {
    fn trim_end_matches_cr(&self) -> &str {
        self.strip_suffix('\r').unwrap_or(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grep_output_is_read_field_by_field() {
        // The shape measured against a real host: path, NUL, line, NUL, text.
        let raw = "src/notes.txt\u{0}1\u{0}alpha beta\nsrc/notes.txt\u{0}2\u{0}BETA gamma\n";
        let parsed = parse_grep(raw);
        assert_eq!(
            parsed,
            vec![
                ("src/notes.txt".to_string(), 1, "alpha beta".to_string()),
                ("src/notes.txt".to_string(), 2, "BETA gamma".to_string()),
            ]
        );
    }

    #[test]
    fn a_newline_in_a_path_does_not_split_a_record() {
        // Why `-z` is used at all: splitting on newlines first would read this
        // as two broken records instead of one file with an unusual name.
        let raw = "od\nd\u{0}7\u{0}hit\n";
        assert_eq!(
            parse_grep(raw),
            vec![("od\nd".to_string(), 7, "hit".to_string())]
        );
    }

    #[test]
    fn a_windows_host_s_carriage_return_is_not_part_of_the_line() {
        let raw = "a.txt\u{0}3\u{0}text\r\n";
        assert_eq!(parse_grep(raw)[0].2, "text");
    }

    #[test]
    fn a_truncated_answer_yields_what_was_complete() {
        // A killed command or a channel that closed mid-record: keep the records
        // that arrived whole rather than inventing the last one.
        assert!(parse_grep("a.txt\u{0}").is_empty());
        assert_eq!(parse_grep("a.txt\u{0}9\u{0}tail").len(), 1);
    }

    #[test]
    fn hidden_is_any_dotted_segment() {
        assert!(is_hidden(".env"));
        assert!(is_hidden(".github/workflows/ci.yml"));
        assert!(is_hidden("src/.hidden/file.rs"));
        assert!(!is_hidden("src/main.rs"));
    }
}
