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
    this.contextUsedFraction,
    this.gitBranch,
    this.isLocal = true,
  });

  /// Active model display name.
  final String modelName;

  /// Context window usage as a 0–1 fraction, or null when unknown.
  ///
  /// FOR-DEV: the bridge does not yet report token usage; the context badge is
  /// hidden while this is null instead of showing a fabricated percentage.
  final double? contextUsedFraction;

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

  /// Returns a copy with the approval mode replaced.
  SessionEnvironment withApprovalMode(ApprovalMode mode) => SessionEnvironment(
        modelName: modelName,
        contextUsedFraction: contextUsedFraction,
        approvalMode: mode,
        gitBranch: gitBranch,
        isLocal: isLocal,
      );

  /// Returns a copy with the model and git branch replaced.
  SessionEnvironment copyWith({String? modelName, String? gitBranch}) =>
      SessionEnvironment(
        modelName: modelName ?? this.modelName,
        contextUsedFraction: contextUsedFraction,
        approvalMode: approvalMode,
        gitBranch: gitBranch ?? this.gitBranch,
        isLocal: isLocal,
      );
}
