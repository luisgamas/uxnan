import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// Lifecycle of a single interactive approval response.
enum ApprovalResponsePhase {
  /// No response sent yet — the prompt is actionable.
  idle,

  /// The response is in flight to the bridge.
  sending,

  /// The bridge accepted the response; the prompt is settled.
  resolved,

  /// The response failed to send; the prompt is actionable again.
  failed,
}

/// The local state of one approval response, keyed by `approvalId`.
class ApprovalResponseState {
  /// Creates an [ApprovalResponseState].
  const ApprovalResponseState({required this.phase, this.decision});

  /// Where the response is in its lifecycle.
  final ApprovalResponsePhase phase;

  /// The decision the user chose (null while [phase] is
  /// [ApprovalResponsePhase.idle]).
  final ApprovalDecision? decision;
}

/// Tracks the user's responses to pending approvals so an approval card can
/// flip to an in-flight / resolved / failed state without waiting for a fresh
/// content block. In memory only (approvals are ephemeral per session).
///
/// FOR-DEV: dormant until the bridge emits approval requests and accepts
/// `turn/send { approvalResponse }` (see `FOR-DEV.md`).
class ApprovalResponses extends Notifier<Map<String, ApprovalResponseState>> {
  @override
  Map<String, ApprovalResponseState> build() => const {};

  /// Sends [decision] for [approvalId] on [threadId], moving the card through
  /// sending → resolved (or failed) so the buttons reflect progress.
  Future<void> respond(
    String threadId,
    String approvalId,
    ApprovalDecision decision,
  ) async {
    if (state[approvalId]?.phase == ApprovalResponsePhase.sending) return;
    _set(approvalId, ApprovalResponsePhase.sending, decision);
    final ok = await ref.read(threadManagerProvider).respondApproval(
          threadId: threadId,
          approvalId: approvalId,
          decision: decision,
        );
    _set(
      approvalId,
      ok ? ApprovalResponsePhase.resolved : ApprovalResponsePhase.failed,
      decision,
    );
  }

  void _set(
    String approvalId,
    ApprovalResponsePhase phase,
    ApprovalDecision d,
  ) {
    state = {
      ...state,
      approvalId: ApprovalResponseState(phase: phase, decision: d),
    };
  }
}

/// Holds the in-memory approval-response states.
final approvalResponsesProvider =
    NotifierProvider<ApprovalResponses, Map<String, ApprovalResponseState>>(
  ApprovalResponses.new,
);
