//! Worktree upkeep on this host — the workspace engine's own `worktreeclean`,
//! over this account's managed roots: the same proofs, the same refusals, the
//! same trash-then-delete, as on the app's machine.

use uxnan_host_protocol::{CleanupCall, Outcome};
use uxnan_workspace_engine::worktreeclean;
use uxnan_workspace_engine::Error;

use crate::files::{outcome, value};

/// This account's own roots, with the custom ones the app named added.
fn roots(extra: Vec<String>) -> (Vec<String>, String) {
    let (managed, repos) = worktreeclean::home_roots(&crate::paths_home());
    let mut roots = vec![managed];
    for root in extra {
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    (roots, repos)
}

/// Answer one `Cleanup` call; `busy` is where this daemon's terminals stand.
pub async fn serve(call: CleanupCall, busy: Vec<String>) -> Outcome {
    outcome(run(call, busy).await)
}

async fn run(call: CleanupCall, busy: Vec<String>) -> Result<serde_json::Value, Error> {
    match call {
        CleanupCall::Scan {
            roots: extra,
            projects,
        } => {
            let (roots, repos) = roots(extra);
            value(worktreeclean::scan_all(&roots, &repos, &projects, &busy).await)
        }
        CleanupCall::Sizes { paths } => {
            let mut sizes = Vec::with_capacity(paths.len());
            for path in paths {
                sizes.push(worktreeclean::dir_size(path).await);
            }
            value(sizes)
        }
        CleanupCall::Remove {
            roots: extra,
            projects,
            paths,
        } => {
            let (roots, repos) = roots(extra);
            value(worktreeclean::remove(&roots, &repos, &projects, &busy, &paths).await)
        }
    }
}

/// What a previous run moved aside and never finished deleting, and group
/// folders left holding only their marker — cleared when the daemon starts,
/// as the app does for its own roots.
pub async fn sweep_leftovers() {
    let (roots, _) = roots(Vec::new());
    let swept = worktreeclean::sweep_trash(&roots).await;
    let pruned = worktreeclean::prune_empty_groups(&roots).await;
    if swept > 0 || pruned > 0 {
        crate::log::line(&format!(
            "swept {swept} leftover worktree folder(s) and {pruned} empty group(s)"
        ));
    }
}
