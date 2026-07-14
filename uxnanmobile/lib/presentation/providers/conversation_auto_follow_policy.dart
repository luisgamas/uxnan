/// Owns the conversation timeline's auto-follow intent independently from its
/// [ScrollController]. Manual interaction always wins over streaming updates:
/// following pauses as soon as a drag begins and resumes only at the bottom or
/// after an explicit action such as "jump to latest" or sending a message.
class ConversationAutoFollowPolicy {
  bool _followingLatest = true;
  bool _userDragging = false;

  /// Whether a post-layout streaming update may move the timeline.
  bool get shouldFollow => _followingLatest && !_userDragging;

  /// Whether the user deliberately detached from the latest content.
  bool get isDetached => !_followingLatest;

  /// Pauses auto-follow immediately when a pointer-driven scroll begins.
  void beginUserScroll() {
    _userDragging = true;
    _followingLatest = false;
  }

  /// Ends a pointer-driven scroll and follows again only when it settled near
  /// the bottom. Remaining in older content keeps the timeline detached.
  void endUserScroll({required bool nearBottom}) {
    _userDragging = false;
    _followingLatest = nearBottom;
  }

  /// Restores whether the saved position represented the latest content.
  void restore({required bool atBottom}) {
    _userDragging = false;
    _followingLatest = atBottom;
  }

  /// Re-enables auto-follow after an explicit user action.
  void resume() {
    _followingLatest = true;
  }
}
