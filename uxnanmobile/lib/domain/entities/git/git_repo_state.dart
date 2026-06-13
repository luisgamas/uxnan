import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/domain/value_objects/git/git_diff_totals.dart';

/// Snapshot of a git repository's state at a working directory (spec 02a §5.5).
///
/// Produced from a `git/status` response. The bridge runs git locally and
/// returns this shape; the parser is tolerant because the exact JSON is only
/// confirmed against a live bridge later (FOR-DEV).
class GitRepoState extends Equatable {
  /// Creates a [GitRepoState].
  const GitRepoState({
    required this.branch,
    this.upstream,
    this.isDirty = false,
    this.ahead = 0,
    this.behind = 0,
    this.diffTotals = const GitDiffTotals(),
    this.changedFiles = const [],
  });

  /// Reconstructs a [GitRepoState] from a `git/status` JSON result.
  ///
  /// The bridge sends the file list under `files`; an older shape used
  /// `changedFiles`. Both are accepted. When `diffTotals` is absent it is
  /// derived from the per-file counts.
  factory GitRepoState.fromJson(Map<String, dynamic> json) {
    final rawFiles = json['files'] ?? json['changedFiles'];
    final totals = json['diffTotals'];
    final changedFiles = [
      if (rawFiles is List)
        for (final f in rawFiles)
          if (f is Map) GitChangedFile.fromJson(f.cast<String, dynamic>()),
    ];
    return GitRepoState(
      branch: json['branch'] as String? ?? '',
      upstream: json['upstream'] as String?,
      isDirty: json['isDirty'] == true,
      ahead: json['ahead'] is num ? (json['ahead'] as num).toInt() : 0,
      behind: json['behind'] is num ? (json['behind'] as num).toInt() : 0,
      diffTotals: totals is Map
          ? GitDiffTotals.fromJson(totals.cast<String, dynamic>())
          : _totalsFrom(changedFiles),
      changedFiles: changedFiles,
    );
  }

  static GitDiffTotals _totalsFrom(List<GitChangedFile> files) {
    var additions = 0;
    var deletions = 0;
    for (final f in files) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return GitDiffTotals(
      additions: additions,
      deletions: deletions,
      changedFileCount: files.length,
    );
  }

  /// Current branch name (empty when detached/unknown).
  final String branch;

  /// Upstream tracking ref, if any (e.g. `origin/main`).
  final String? upstream;

  /// Whether the working tree has uncommitted changes.
  final bool isDirty;

  /// Number of local commits ahead of the upstream.
  final int ahead;

  /// Number of upstream commits the local branch is behind.
  final int behind;

  /// Aggregate diff counters for the working tree.
  final GitDiffTotals diffTotals;

  /// The list of changed files.
  final List<GitChangedFile> changedFiles;

  /// Whether the branch has commits to push.
  bool get hasUnpushedCommits => ahead > 0;

  @override
  List<Object?> get props => [
        branch,
        upstream,
        isDirty,
        ahead,
        behind,
        diffTotals,
        changedFiles,
      ];
}
