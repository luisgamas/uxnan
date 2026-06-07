/// Working-tree status of a changed file in a git repository (spec 02a §5.5).
enum GitFileStatus {
  /// A new file staged for addition.
  added,

  /// An existing tracked file with modifications.
  modified,

  /// A tracked file removed from the working tree.
  deleted,

  /// A tracked file moved or renamed.
  renamed,

  /// A file not yet tracked by git.
  untracked,
}
