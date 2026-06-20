/// What the conversation's context indicator shows above the composer.
enum ContextIndicatorMode {
  /// The percentage of the context window used. Falls back to the raw token
  /// count when the agent reports no window (so usage is still visible).
  percentage,

  /// The raw context-occupying token count only.
  tokens,

  /// Both the token count and the percentage, side by side.
  both,
}
