/// Contract for persisting per-thread composer drafts.
///
/// Defined in `architecture/02a-system-architecture.md` (section 5.1.4). Drafts
/// let the user resume an unsent message after navigating away or reconnecting.
abstract class IComposerDraftRepository {
  /// Returns the saved draft for [threadId], or `null` if none exists.
  Future<String?> getDraft(String threadId);

  /// Saves [content] as the draft for [threadId].
  Future<void> saveDraft(String threadId, String content);

  /// Clears the draft for [threadId].
  Future<void> clearDraft(String threadId);
}
