//! Finding — and safely removing — worktrees the app can prove are disposable:
//! the workspace engine's (`uxnan_workspace_engine::worktreeclean`), so a host's
//! engine cleans its own managed roots by the same rules.

pub use uxnan_workspace_engine::worktreeclean::*;
