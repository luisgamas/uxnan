import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Remembers each conversation's scroll position for the app session, so
/// reopening a thread restores where the user left off instead of jumping to
/// the top. In-memory only (per session); a thread with no saved position opens
/// at the newest message, never at the top.
///
/// Not persisted to disk: the saved pixel offset only maps cleanly onto the
/// same rendered content, which a cross-restart resync can change. Within a
/// session the content is stable enough for an exact restore.
class ConversationScrollStore {
  final Map<String, ({double offset, bool atBottom})> _positions = {};

  /// The saved position for [threadId] (the pixel `offset` and whether it was
  /// pinned to the bottom), or `null` when none has been recorded.
  ({double offset, bool atBottom})? positionFor(String threadId) =>
      _positions[threadId];

  /// Records the current [offset] for [threadId]. [atBottom] marks that the
  /// user was at (or near) the newest message, so the restore follows the
  /// bottom as new messages arrive instead of pinning a now-stale offset.
  void save(String threadId, {required double offset, required bool atBottom}) {
    _positions[threadId] = (offset: offset, atBottom: atBottom);
  }
}

/// The (session-scoped) conversation scroll-position store.
final conversationScrollStoreProvider = Provider<ConversationScrollStore>(
  (ref) => ConversationScrollStore(),
);
