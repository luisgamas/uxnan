import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
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

  /// A sample repository state for the demo/preview (FOR-DEV).
  factory GitRepoState.sample() => const GitRepoState(
        branch: 'feature/login',
        upstream: 'origin/feature/login',
        isDirty: true,
        ahead: 2,
        diffTotals: GitDiffTotals(
          additions: 24,
          deletions: 6,
          changedFileCount: 3,
        ),
        changedFiles: [
          GitChangedFile(
            path: 'lib/presentation/screens/login/login_screen.dart',
            status: GitFileStatus.modified,
            additions: 18,
            deletions: 4,
          ),
          GitChangedFile(
            path: 'lib/application/auth/login_controller.dart',
            status: GitFileStatus.added,
            additions: 6,
          ),
          GitChangedFile(
            path: 'lib/legacy/old_login.dart',
            status: GitFileStatus.deleted,
            deletions: 2,
          ),
        ],
      );

  /// Reconstructs a [GitRepoState] from a `git/status` JSON result.
  factory GitRepoState.fromJson(Map<String, dynamic> json) {
    final files = json['changedFiles'];
    final totals = json['diffTotals'];
    return GitRepoState(
      branch: json['branch'] as String? ?? '',
      upstream: json['upstream'] as String?,
      isDirty: json['isDirty'] == true,
      ahead: json['ahead'] is num ? (json['ahead'] as num).toInt() : 0,
      behind: json['behind'] is num ? (json['behind'] as num).toInt() : 0,
      diffTotals: totals is Map
          ? GitDiffTotals.fromJson(totals.cast<String, dynamic>())
          : const GitDiffTotals(),
      changedFiles: [
        if (files is List)
          for (final f in files)
            if (f is Map) GitChangedFile.fromJson(f.cast<String, dynamic>()),
      ],
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
