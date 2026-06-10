/// Presentational snapshot of the active session's environment shown in the
/// composer (model + context usage) and the app bar (git branch).
///
/// Built from the active thread (model), the live git state (branch) and the
/// reported token usage. [contextUsedFraction] is null when the model's context
/// window is unknown (e.g. Codex) — [contextTokens] then carries the raw count.
class SessionEnvironment {
  /// Creates a [SessionEnvironment].
  const SessionEnvironment({
    required this.modelName,
    this.contextUsedFraction,
    this.contextTokens,
    this.gitBranch,
    this.isLocal = true,
  });

  /// Active model display name (the selected alias/id, the routing key).
  final String modelName;

  /// Context window usage as a 0–1 fraction, or null when the model's context
  /// window is unknown (e.g. Codex) — in that case [contextTokens] carries the
  /// raw count so the UI can still show usage without a percentage.
  final double? contextUsedFraction;

  /// Raw context-occupying token count of the latest turn, when reported.
  final int? contextTokens;

  /// Current git branch, if a repo is open.
  final String? gitBranch;

  /// Whether the workspace is a local checkout.
  final bool isLocal;

  /// Whether real context usage is available.
  bool get hasContext => contextUsedFraction != null;

  /// Context usage as a whole-number percentage (0 when unknown).
  int get contextPercent => ((contextUsedFraction ?? 0) * 100).round();

  /// Compact label for the raw token count (e.g. `13.4k`), null when unknown.
  String? get contextTokensLabel {
    final tokens = contextTokens;
    if (tokens == null) return null;
    if (tokens < 1000) return '$tokens';
    return '${(tokens / 1000).toStringAsFixed(1)}k';
  }

  /// Returns a copy with the model and git branch replaced.
  SessionEnvironment copyWith({String? modelName, String? gitBranch}) =>
      SessionEnvironment(
        modelName: modelName ?? this.modelName,
        contextUsedFraction: contextUsedFraction,
        contextTokens: contextTokens,
        gitBranch: gitBranch ?? this.gitBranch,
        isLocal: isLocal,
      );
}
