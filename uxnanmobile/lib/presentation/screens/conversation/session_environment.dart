import 'package:uxnan/domain/enums/approval_mode.dart';

/// Presentational snapshot of the active session's environment, shown in the
/// status sheet and composer (model, context usage, approval mode, git).
///
/// FOR-DEV: currently fed sample values; wire to the real bridge status
/// (`bridge/status`, `getAuthStatus`) and git state (`git/status`) when those
/// flows land.
class SessionEnvironment {
  /// Creates a [SessionEnvironment].
  const SessionEnvironment({
    required this.modelName,
    required this.contextUsedFraction,
    required this.approvalMode,
    this.gitBranch,
    this.isLocal = true,
  });

  /// A sample environment for the demo/preview.
  factory SessionEnvironment.sample() => const SessionEnvironment(
        modelName: 'Claude Opus 4.8',
        contextUsedFraction: 0.42,
        approvalMode: ApprovalMode.approveForMe,
        gitBranch: 'main',
      );

  /// Active model display name.
  final String modelName;

  /// Context window usage as a 0–1 fraction.
  final double contextUsedFraction;

  /// Current approval mode.
  final ApprovalMode approvalMode;

  /// Current git branch, if a repo is open.
  final String? gitBranch;

  /// Whether the workspace is a local checkout.
  final bool isLocal;

  /// Context usage as a whole-number percentage.
  int get contextPercent => (contextUsedFraction * 100).round();

  /// Returns a copy with the approval mode replaced.
  SessionEnvironment withApprovalMode(ApprovalMode mode) => SessionEnvironment(
        modelName: modelName,
        contextUsedFraction: contextUsedFraction,
        approvalMode: mode,
        gitBranch: gitBranch,
        isLocal: isLocal,
      );
}
