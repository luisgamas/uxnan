import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_log.dart';

/// A single file touched by a commit, parsed from the bridge's `git/commitShow`
/// payload (`git show --name-status --numstat`). Rename/copy entries carry the
/// previous path in [oldPath].
class GitCommitFile extends Equatable {
  /// Creates a [GitCommitFile].
  const GitCommitFile({
    required this.path,
    required this.status,
    this.oldPath,
    this.additions = 0,
    this.deletions = 0,
    this.binary = false,
  });

  /// Reconstructs a [GitCommitFile] from its JSON form.
  factory GitCommitFile.fromJson(Map<String, dynamic> json) => GitCommitFile(
        path: (json['path'] as String?) ?? '',
        status: _status(json['status'] as String?),
        oldPath: (json['oldPath'] as String?)?.trim(),
        additions: _int(json['additions']),
        deletions: _int(json['deletions']),
        binary: json['binary'] == true,
      );

  /// Repository-relative path after the change (the new path on a rename).
  final String path;

  /// Previous path, set only for renames/copies.
  final String? oldPath;

  /// Per-file change kind.
  final GitFileStatus status;

  /// Lines added in this commit (0 for binary/unknown).
  final int additions;

  /// Lines removed in this commit (0 for binary/unknown).
  final int deletions;

  /// True when git reported the file as binary (no line counts).
  final bool binary;

  static GitFileStatus _status(String? name) {
    for (final value in GitFileStatus.values) {
      if (value.name == name) return value;
    }
    return GitFileStatus.modified;
  }

  @override
  List<Object?> get props => [
        path,
        oldPath,
        status,
        additions,
        deletions,
        binary,
      ];
}

/// Full detail of one commit: its metadata (incl. refs), the files it touched
/// with per-file +/- counts, and the complete unified diff. Backs the mobile
/// commit-detail view (`git/commitShow`).
class GitCommitDetails extends Equatable {
  /// Creates a [GitCommitDetails].
  const GitCommitDetails({
    required this.commit,
    this.files = const [],
    this.diff = '',
    this.diffTruncated = false,
  });

  /// Reconstructs a [GitCommitDetails] from its JSON form. Tolerant of a
  /// missing `commit` object (falls back to an empty commit).
  factory GitCommitDetails.fromJson(Map<String, dynamic> json) {
    final commitRaw = json['commit'];
    final filesRaw = json['files'];
    return GitCommitDetails(
      commit: commitRaw is Map
          ? GitCommit.fromJson(commitRaw.cast<String, dynamic>())
          : const GitCommit(
              sha: '',
              shortSha: '',
              parents: [],
              authorName: '',
              authorEmail: '',
              authorTimestamp: 0,
              committerName: '',
              committerEmail: '',
              committerTimestamp: 0,
              messageTitle: '',
              messageBody: '',
            ),
      files: filesRaw is List
          ? filesRaw
              .whereType<Map<dynamic, dynamic>>()
              .map((m) => GitCommitFile.fromJson(m.cast<String, dynamic>()))
              .toList()
          : const <GitCommitFile>[],
      diff: (json['diff'] as String?) ?? '',
      diffTruncated: json['diffTruncated'] == true,
    );
  }

  /// The commit's metadata (same shape as a `git/log` entry).
  final GitCommit commit;

  /// Files touched by the commit, with per-file stats.
  final List<GitCommitFile> files;

  /// The commit's full unified diff (may be truncated — see [diffTruncated]).
  final String diff;

  /// True when [diff] was capped because the patch exceeded the size budget.
  final bool diffTruncated;

  @override
  List<Object?> get props => [commit, files, diff, diffTruncated];
}

int _int(Object? value) => value is num ? value.toInt() : 0;
