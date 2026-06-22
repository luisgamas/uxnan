import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/value_objects/git/git_diff_totals.dart';

/// A single commit in the repository log (spec 02a §5.8.6 + the git/log RPC).
///
/// Parsed from the bridge's `git/log` payload. `parents` is what powers the
/// GitKraken-style graph view: each parent is a "lane" the commit sits on,
/// and the graph renderer walks `parents` to draw the connecting lines.
class GitCommit extends Equatable {
  /// Creates a [GitCommit].
  const GitCommit({
    required this.sha,
    required this.shortSha,
    required this.parents,
    required this.authorName,
    required this.authorEmail,
    required this.authorTimestamp,
    required this.committerName,
    required this.committerEmail,
    required this.committerTimestamp,
    required this.messageTitle,
    required this.messageBody,
    this.stats,
  });

  /// Reconstructs a [GitCommit] from its JSON form. Tolerant of missing or
  /// mistyped fields — the wire shape is verified by the shared schema, but
  /// the phone decodes it as loosely as the rest of the app.
  factory GitCommit.fromJson(Map<String, dynamic> json) {
    final parentsRaw = json['parents'];
    final parents = parentsRaw is List
        ? parentsRaw
            .whereType<String>()
            .map((p) => p.trim())
            .where((p) => p.isNotEmpty)
            .toList()
        : const <String>[];
    final statsRaw = json['stats'];
    return GitCommit(
      sha: (json['sha'] as String?)?.trim() ?? '',
      shortSha: (json['shortSha'] as String?)?.trim() ??
          (json['sha'] as String?)?.trim().substring(0, 7) ??
          '',
      parents: parents,
      authorName: (json['authorName'] as String?) ?? '',
      authorEmail: (json['authorEmail'] as String?) ?? '',
      authorTimestamp: _int(json['authorTimestamp']),
      committerName: (json['committerName'] as String?) ?? '',
      committerEmail: (json['committerEmail'] as String?) ?? '',
      committerTimestamp: _int(json['committerTimestamp']),
      messageTitle: (json['messageTitle'] as String?) ?? '',
      messageBody: (json['messageBody'] as String?) ?? '',
      stats: statsRaw is Map
          ? GitDiffTotals.fromJson(statsRaw.cast<String, dynamic>())
          : null,
    );
  }

  /// Full 40-char SHA.
  final String sha;

  /// Abbreviated SHA (7 chars, git's default).
  final String shortSha;

  /// Parent commit SHAs in order (zero, one or two — merge commits have two).
  final List<String> parents;

  /// Commit author display name.
  final String authorName;

  /// Commit author email.
  final String authorEmail;

  /// Author date, unix epoch seconds.
  final int authorTimestamp;

  /// Committer display name (often equal to author).
  final String committerName;

  /// Committer email.
  final String committerEmail;

  /// Committer date, unix epoch seconds.
  final int committerTimestamp;

  /// First line of the commit message (the "title").
  final String messageTitle;

  /// Rest of the commit message after the title (may be empty).
  final String messageBody;

  /// Aggregate +/-/file-count stats for the commit (`git log --shortstat`).
  final GitDiffTotals? stats;

  /// The commit's `DateTime` in the local timezone — convenient for the UI.
  DateTime get authorDate =>
      DateTime.fromMillisecondsSinceEpoch(authorTimestamp * 1000);

  /// `true` when this commit has more than one parent (a merge commit).
  bool get isMerge => parents.length > 1;

  @override
  List<Object?> get props => [
        sha,
        shortSha,
        parents,
        authorName,
        authorEmail,
        authorTimestamp,
        committerName,
        committerEmail,
        committerTimestamp,
        messageTitle,
        messageBody,
        stats,
      ];
}

/// A page of commits for a repository, with cursor-based pagination.
///
/// When `hasMore` is true, pass `nextCursor` as the next call's
/// `GitLogParams.cursor` to fetch the previous page.
class GitLogResult extends Equatable {
  /// Creates a [GitLogResult].
  const GitLogResult({
    required this.commits,
    required this.hasMore,
    this.nextCursor,
  });

  /// Reconstructs a [GitLogResult] from its JSON form.
  factory GitLogResult.fromJson(Map<String, dynamic> json) {
    final raw = json['commits'];
    final commits = raw is List
        ? raw
            .whereType<Map<dynamic, dynamic>>()
            .map((m) => GitCommit.fromJson(m.cast<String, dynamic>()))
            .toList()
        : const <GitCommit>[];
    return GitLogResult(
      commits: commits,
      hasMore: json['hasMore'] == true,
      nextCursor: (json['nextCursor'] as String?)?.trim(),
    );
  }

  /// The commits in this page, newest first.
  final List<GitCommit> commits;

  /// Whether more commits exist beyond this page.
  final bool hasMore;

  /// SHA to pass as `cursor` on the next call. Undefined when `hasMore` is
  /// false.
  final String? nextCursor;

  /// Empty result (a fresh repo with no commits).
  static const empty = GitLogResult(commits: [], hasMore: false);

  @override
  List<Object?> get props => [commits, hasMore, nextCursor];
}

int _int(Object? value) => value is num ? value.toInt() : 0;

/// Parameters for the `git/log` RPC (mobile half — the manager's `log`
/// method wraps this in a typed call).
class GitLogParams extends Equatable {
  /// Creates a [GitLogParams].
  const GitLogParams({
    required this.cwd,
    this.limit,
    this.cursor,
    this.ref,
  });

  /// Workspace directory the log is read from.
  final String cwd;

  /// Max commits to return. Defaults to 50 on the bridge when omitted.
  final int? limit;

  /// Cursor for pagination. When set, returns commits strictly older than
  /// this SHA. Omit for the first (newest) page.
  final String? cursor;

  /// Optional ref (branch / tag / remote) to start from. Defaults to HEAD.
  final String? ref;

  /// Serialises the params into the shape the bridge's `git/log` RPC expects
  /// (omits null fields so the bridge sees a clean payload).
  Map<String, dynamic> toRpcParams() => {
        'cwd': cwd,
        if (limit != null) 'limit': limit,
        if (cursor != null) 'cursor': cursor,
        if (ref != null) 'ref': ref,
      };

  @override
  List<Object?> get props => [cwd, limit, cursor, ref];
}
