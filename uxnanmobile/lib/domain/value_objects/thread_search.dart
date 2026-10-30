import 'package:equatable/equatable.dart';

/// One message of a conversation that matched a `thread/search`
/// (`ThreadSearchMatch`, `shared/src/models/thread.ts`).
class ThreadSearchMatch extends Equatable {
  /// Creates a [ThreadSearchMatch].
  const ThreadSearchMatch({
    required this.turnId,
    required this.fromUser,
    required this.snippet,
    required this.matchStart,
    required this.matchLength,
    this.seq,
  });

  /// Parses the wire shape; `null` when it is unreadable.
  static ThreadSearchMatch? fromJson(Object? json) {
    if (json is! Map) return null;
    final turnId = json['turnId'];
    final snippet = json['snippet'];
    if (turnId is! String || snippet is! String) return null;
    int read(String key) => switch (json[key]) {
          final num value => value.toInt(),
          _ => 0,
        };
    final start = read('matchStart').clamp(0, snippet.length);
    final length = read('matchLength').clamp(0, snippet.length - start);
    final seq = json['seq'];
    return ThreadSearchMatch(
      turnId: turnId,
      seq: seq is num ? seq.toInt() : null,
      fromUser: json['role'] == 'user',
      snippet: snippet,
      matchStart: start,
      matchLength: length,
    );
  }

  /// The turn the message belongs to.
  final String turnId;

  /// The turn's position in its conversation, when known.
  final int? seq;

  /// Whether the person wrote it (otherwise the agent did).
  final bool fromUser;

  /// The words around the match, on one line.
  final String snippet;

  /// Where the matched word starts in [snippet].
  final int matchStart;

  /// How long it is there.
  final int matchLength;

  @override
  List<Object?> get props =>
      [turnId, seq, fromUser, snippet, matchStart, matchLength];
}

/// A conversation that matched (`ThreadSearchHit`).
class ThreadSearchHit extends Equatable {
  /// Creates a [ThreadSearchHit].
  const ThreadSearchHit({
    required this.threadId,
    required this.titleMatch,
    required this.matches,
    required this.matchCount,
  });

  /// Parses the wire shape; `null` when it is unreadable.
  static ThreadSearchHit? fromJson(Object? json) {
    if (json is! Map) return null;
    final threadId = json['threadId'];
    if (threadId is! String) return null;
    final raw = json['matches'];
    final count = json['matchCount'];
    return ThreadSearchHit(
      threadId: threadId,
      titleMatch: json['titleMatch'] == true,
      matches: [
        if (raw is List)
          for (final m in raw)
            if (ThreadSearchMatch.fromJson(m) case final match?) match,
      ],
      matchCount: count is num ? count.toInt() : 0,
    );
  }

  /// The conversation.
  final String threadId;

  /// Whether its title matched.
  final bool titleMatch;

  /// Its matching messages, newest first (at most three).
  final List<ThreadSearchMatch> matches;

  /// How many of its messages matched in all.
  final int matchCount;

  @override
  List<Object?> get props => [threadId, titleMatch, matches, matchCount];
}

/// One answer of `thread/search` (`ThreadSearchResult`).
class ThreadSearchPage extends Equatable {
  /// Creates a [ThreadSearchPage].
  const ThreadSearchPage({
    required this.hits,
    required this.searched,
    required this.total,
    this.nextCursor,
  });

  /// Parses the wire shape; an unreadable answer is an empty page.
  factory ThreadSearchPage.fromJson(Object? json) {
    final map = json is Map ? json : const <String, Object?>{};
    final raw = map['hits'];
    final cursor = map['nextCursor'];
    int read(String key) => switch (map[key]) {
          final num value => value.toInt(),
          _ => 0,
        };
    return ThreadSearchPage(
      hits: [
        if (raw is List)
          for (final h in raw)
            if (ThreadSearchHit.fromJson(h) case final hit?) hit,
      ],
      nextCursor: cursor is String ? cursor : null,
      searched: read('searched'),
      total: read('total'),
    );
  }

  /// The matching conversations of this answer.
  final List<ThreadSearchHit> hits;

  /// Where to continue, when not every conversation was searched yet.
  final String? nextCursor;

  /// Conversations this answer searched.
  final int searched;

  /// Conversations the search covers in all.
  final int total;

  @override
  List<Object?> get props => [hits, nextCursor, searched, total];
}

/// Shortest query `thread/search` answers (`THREAD_SEARCH_MIN_QUERY_CHARS`).
const int kThreadSearchMinQueryChars = 2;
