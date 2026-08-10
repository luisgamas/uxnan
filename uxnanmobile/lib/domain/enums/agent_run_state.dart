/// What an agent is doing, in the vocabulary `uxnandesktop` uses in its
/// sidebar — so a conversation reads the same on both.
///
/// The states are the same; **how they are known is not.** The desktop app owns
/// the terminals its agents run in and reads a hook server, a terminal title
/// and PTY activity. The phone owns none of that: the bridge sends turn events,
/// queue state and content blocks, and this is derived from those. That is why
/// the derivation lives in the presentation layer next to the providers it
/// reads, rather than pretending to be a fact the bridge reported.
enum AgentRunState {
  /// A turn is in flight: the agent is producing something right now.
  working,

  /// The agent asked and stopped. It needs **you** — an approval or a choice —
  /// and nothing moves until you answer. The one state worth interrupting
  /// someone for, which is why it outranks [working] when both are true.
  waiting,

  /// Held by something that is not the user's attention: the agent is not
  /// signed in on the PC, or the message queue was paused after a stop or a
  /// failure. Needs an action, but not an answer.
  blocked,

  /// The last turn finished and its reply has not been read yet.
  done,

  /// Nothing is happening. By far the most common state, which is why it is
  /// drawn as a plain dot rather than a glyph.
  idle,
}
