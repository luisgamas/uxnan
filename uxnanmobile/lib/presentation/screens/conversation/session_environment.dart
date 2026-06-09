import 'package:uxnan/domain/enums/approval_mode.dart';

/// Presentational snapshot of the active session's environment, shown in the
/// status sheet and composer (model, context usage, approval mode, git).
///
/// Built from the active thread (model), the live git state (branch) and a
/// per-thread approval-mode setting. [contextUsedFraction] is null until the
/// bridge reports real token usage (the badge is hidden rather than faked).
class SessionEnvironment {
  /// Creates a [SessionEnvironment].
  const SessionEnvironment({
    required this.modelName,
    required this.approvalMode,
    this.resolvedModel,
    this.contextUsedFraction,
    this.contextTokens,
    this.gitBranch,
    this.isLocal = true,
  });

  /// Active model display name (the selected alias/id, the routing key).
  final String modelName;

  /// Concrete model the agent resolved [modelName] to for the latest turn
  /// (e.g. `claude-opus-4-8` for the `opus` alias), or null when unknown.
  final String? resolvedModel;

  /// Context window usage as a 0–1 fraction, or null when the model's context
  /// window is unknown (e.g. Codex) — in that case [contextTokens] carries the
  /// raw count so the UI can still show usage without a percentage.
  final double? contextUsedFraction;

  /// Raw context-occupying token count of the latest turn, when reported.
  final int? contextTokens;

  /// Current approval mode.
  ///
  /// FOR-DEV: there is no bridge RPC for the access/approval mode yet, so this
  /// is a local per-thread setting (not read back from the session).
  final ApprovalMode approvalMode;

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

  /// Returns a copy with the approval mode replaced.
  SessionEnvironment withApprovalMode(ApprovalMode mode) => SessionEnvironment(
        modelName: modelName,
        resolvedModel: resolvedModel,
        contextUsedFraction: contextUsedFraction,
        contextTokens: contextTokens,
        approvalMode: mode,
        gitBranch: gitBranch,
        isLocal: isLocal,
      );

  /// Returns a copy with the model and git branch replaced.
  SessionEnvironment copyWith({
    String? modelName,
    String? resolvedModel,
    String? gitBranch,
  }) =>
      SessionEnvironment(
        modelName: modelName ?? this.modelName,
        resolvedModel: resolvedModel ?? this.resolvedModel,
        contextUsedFraction: contextUsedFraction,
        contextTokens: contextTokens,
        approvalMode: approvalMode,
        gitBranch: gitBranch ?? this.gitBranch,
        isLocal: isLocal,
      );
}
