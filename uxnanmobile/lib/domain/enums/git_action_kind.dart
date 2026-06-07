/// The kind of Git action the user can trigger from the app.
enum GitActionKind {
  /// Create a commit from the staged/working changes.
  commit,

  /// Push commits to the remote.
  push,

  /// Pull commits from the remote.
  pull,

  /// Check out an existing branch.
  checkout,

  /// Create a new branch.
  createBranch,

  /// Create a new managed worktree.
  createWorktree,

  /// Revert changes made by the assistant.
  revert,

  /// Commit, push and open a draft pull request in one stacked operation.
  stackedPublish,
}
