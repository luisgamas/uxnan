import 'package:equatable/equatable.dart';

/// Aggregate diff counters for a repository's working tree (spec 02a §5.5).
class GitDiffTotals extends Equatable {
  /// Creates a [GitDiffTotals].
  const GitDiffTotals({
    this.additions = 0,
    this.deletions = 0,
    this.binaryFiles = 0,
    this.changedFileCount = 0,
  });

  /// Reconstructs a [GitDiffTotals] from its JSON form, tolerating missing or
  /// mistyped fields (the bridge shape is verified end-to-end later, FOR-DEV).
  factory GitDiffTotals.fromJson(Map<String, dynamic> json) => GitDiffTotals(
        additions: _int(json['additions']),
        deletions: _int(json['deletions']),
        binaryFiles: _int(json['binaryFiles']),
        changedFileCount: _int(json['changedFileCount']),
      );

  /// Total inserted lines across all changed files.
  final int additions;

  /// Total removed lines across all changed files.
  final int deletions;

  /// Number of changed binary files (no line counts).
  final int binaryFiles;

  /// Number of changed files.
  final int changedFileCount;

  /// Whether there are no recorded changes.
  bool get isEmpty =>
      additions == 0 &&
      deletions == 0 &&
      binaryFiles == 0 &&
      changedFileCount == 0;

  static int _int(Object? value) => value is num ? value.toInt() : 0;

  @override
  List<Object?> get props => [
        additions,
        deletions,
        binaryFiles,
        changedFileCount,
      ];
}
