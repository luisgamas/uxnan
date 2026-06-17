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

  /// Discard working-tree changes for selected files (destructive).
  discard,

  /// Open a pull request for the current branch.
  createPr,

  /// Undo the last commit before pushing (soft reset).
  undoCommit,

  /// Delete a local branch (refused unless merged, or forced).
  deleteBranch,

  /// Remove a git worktree (refused if dirty, or forced).
  removeWorktree,

  /// Commit, push and open a draft pull request in one stacked operation.
  stackedPublish,
}
