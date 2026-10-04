//! A project's git on this host, for the app's Changes and History panels and
//! a project's row — the workspace engine's own `git`, the code the app runs
//! on its own disk, so a repository here reads, stages and commits exactly as
//! one there.
//!
//! git runs with this daemon's environment, which follows the agent the
//! latest connection forwards (`agent_socket`): a push over SSH uses the keys
//! the person holds where the app runs, as a push from a terminal here does.

use uxnan_host_protocol::{GitCall, Outcome};
use uxnan_workspace_engine::Error;
use uxnan_workspace_engine::{git, worktreeloc};

use crate::files::{outcome, parsed, value};

/// Answer one `Git` call.
pub async fn serve(call: GitCall) -> Outcome {
    outcome(run(call).await)
}

async fn run(call: GitCall) -> Result<serde_json::Value, Error> {
    match call {
        GitCall::Review { path } => value(git::review(&path).await?),
        GitCall::Status { path } => value(git::repo_status(&path).await?),
        GitCall::Diff { path, file, staged } => value(git::diff_file(&path, &file, staged).await?),
        GitCall::DiffHead { path, file } => value(git::diff_head(&path, &file).await?),
        GitCall::ImageDiff { path, file, staged } => {
            value(git::image_diff(&path, &file, staged).await?)
        }
        GitCall::StagedDiff { path } => value(git::staged_diff(&path).await?),
        GitCall::Log { path, limit, skip } => {
            value(git::log(&path, limit as usize, skip as usize).await?)
        }
        GitCall::Show { path, hash } => value(git::show(&path, &hash).await?),
        GitCall::Stage { path, file } => value(git::stage_file(&path, &file).await?),
        GitCall::Unstage { path, file } => value(git::unstage_file(&path, &file).await?),
        GitCall::StageAll { path } => value(git::stage_all(&path).await?),
        GitCall::UnstageAll { path } => value(git::unstage_all(&path).await?),
        GitCall::Discard {
            path,
            file,
            untracked,
        } => value(git::discard_file(&path, &file, untracked).await?),
        GitCall::Apply {
            path,
            patch,
            cached,
            reverse,
        } => value(git::apply_patch(&path, &patch, cached, reverse).await?),
        GitCall::Commit {
            path,
            message,
            amend,
            sign_off,
        } => {
            let message = message.trim();
            if message.is_empty() {
                return Err(Error::Invalid("commit message is required".to_string()));
            }
            value(git::commit(&path, message, amend, sign_off).await?)
        }
        GitCall::Fetch { path } => {
            git::fetch_remote(&path).await?;
            value(git::worktree_status(&path).await?)
        }
        GitCall::Push { path } => value(git::push(&path).await?),
        GitCall::Pull { path } => value(git::pull(&path).await?),
        GitCall::Worktrees { path } => value(git::list_worktrees(&path).await?),
        GitCall::Branches { path } => value(git::branch_list(&path).await?),
        GitCall::WorktreeLocation {
            path,
            branch,
            mode,
            root,
        } => {
            let resolved =
                worktreeloc::resolve(&path, &branch, parsed(mode)?, root.as_deref()).await?;
            value(resolved.path)
        }
        GitCall::AddWorktree {
            path,
            spec,
            mode,
            root,
        } => {
            value(worktreeloc::create(&path, parsed(spec)?, parsed(mode)?, root.as_deref()).await?)
        }
        GitCall::RemoveWorktree {
            path,
            worktree,
            branch,
            force,
            cleanup,
        } => value(
            git::remove_worktree(&path, &worktree, branch.as_deref(), force, parsed(cleanup)?)
                .await?,
        ),
        GitCall::BranchIntegrated { path, branch } => {
            value(git::is_git_repo(&path).await && git::branch_integrated(&path, &branch).await)
        }
    }
}
