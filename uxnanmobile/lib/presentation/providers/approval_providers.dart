import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/value_objects/elicitation_resolution.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';

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
///
/// [decidedAtMs] is set when the user answers (regardless of whether the
/// bridge confirms the send) so the card can show "Answered · 14:32" even
/// when the bridge is offline.
class ApprovalResponseState {
  /// Creates an [ApprovalResponseState].
  const ApprovalResponseState({
    required this.phase,
    this.decision,
    this.decidedAtMs,
    this.withdrawn = false,
  });

  /// What the card shows: the bridge's stored record on the card when it has
  /// one (the owner's word, so a card settled while this phone was away is
  /// settled here too), else this phone's own state. The time this phone
  /// answered is kept when both agree it is settled.
  static ApprovalResponseState? settled(
    ApprovalOutcome? stored,
    ApprovalResponseState? local,
  ) {
    if (stored == null) return local;
    return ApprovalResponseState(
      phase: ApprovalResponsePhase.resolved,
      decision: stored.decision,
      decidedAtMs: local?.phase == ApprovalResponsePhase.resolved
          ? local?.decidedAtMs
          : null,
      withdrawn: stored.withdrawn,
    );
  }

  /// Where the response is in its lifecycle.
  final ApprovalResponsePhase phase;

  /// The decision the user chose (null while [phase] is
  /// [ApprovalResponsePhase.idle]).
  final ApprovalDecision? decision;

  /// When the user picked the decision (epoch ms); null while [phase] is idle.
  final int? decidedAtMs;

  /// True when no person answered it: the agent settled it itself, or the run
  /// that asked ended. The card then says it is no longer waiting, not what
  /// [decision] the bridge sent the agent.
  final bool withdrawn;

  /// Creates a copy with the given fields replaced.
  ApprovalResponseState copyWith({
    ApprovalResponsePhase? phase,
    ApprovalDecision? decision,
    int? decidedAtMs,
  }) =>
      ApprovalResponseState(
        phase: phase ?? this.phase,
        decision: decision ?? this.decision,
        decidedAtMs: decidedAtMs ?? this.decidedAtMs,
        withdrawn: withdrawn,
      );
}

/// Tracks the user's responses to pending approvals so an approval card can
/// flip to an in-flight / resolved / failed state without waiting for a fresh
/// content block. The map is **persisted on-device** via the
/// `approvalResponseStoreProvider` (see `ApprovalResponseStore`) so an
/// answered card stays in its resolved state across scrolls and app restarts
/// (the buttons never reappear, the card never asks twice).
///
/// `build()` returns the empty map synchronously (so the UI can render on the
/// first frame), then hydrates from the store — a stale read just renders
/// `idle` for a frame and flips to the persisted `resolved` state on the
/// next rebuild, the same pattern as the other persistence-backed notifiers
/// (e.g. `NotificationPreferencesController`).
class ApprovalResponses extends Notifier<Map<String, ApprovalResponseState>> {
  @override
  Map<String, ApprovalResponseState> build() {
    unawaited(_hydrate());
    return const {};
  }

  /// Settles the card for an approval the bridge says is no longer pending —
  /// answered on this phone, another phone, the desktop, or withdrawn — so a
  /// card never stays actionable after someone else answered it. A card this
  /// phone already resolved keeps its own record. Fed from
  /// `ThreadManager.resolutionsStream` by the app root.
  void adoptResolution(ApprovalResolution resolution) {
    final existing = state[resolution.approvalId];
    if (existing?.phase == ApprovalResponsePhase.resolved) return;
    final decision = resolution.decision ?? ApprovalDecision.reject;
    final now = DateTime.now().millisecondsSinceEpoch;
    _set(
      resolution.approvalId,
      ApprovalResponsePhase.resolved,
      decision,
      now,
      withdrawn: resolution.withdrawn,
    );
    unawaited(
      ref.read(approvalResponseStoreProvider).record(
            approvalId: resolution.approvalId,
            decision: _decisionToWire(decision),
            decidedAtMs: now,
            withdrawn: resolution.withdrawn,
          ),
    );
  }

  /// Loads the persisted decisions and merges them into the in-memory map.
  /// Decisions not yet present in memory are added with a `resolved` phase
  /// (and the original `decidedAtMs` from the store) so the card renders as
  /// already-answered on the very next rebuild.
  Future<void> _hydrate() async {
    final persisted = await ref.read(approvalResponseStoreProvider).readAll();
    if (persisted.isEmpty) return;
    var changed = false;
    final next = <String, ApprovalResponseState>{...state};
    for (final entry in persisted.entries) {
      final decision = _decisionFromWire(entry.value.decision);
      if (decision == null) continue;
      final existing = next[entry.key];
      // Don't downgrade a more authoritative in-memory state (a fresh
      // `sending` round-trip in progress) to a stale persisted `resolved`.
      if (existing?.phase == ApprovalResponsePhase.sending) continue;
      next[entry.key] = ApprovalResponseState(
        phase: ApprovalResponsePhase.resolved,
        decision: decision,
        decidedAtMs: entry.value.decidedAtMs,
        withdrawn: entry.value.withdrawn,
      );
      changed = true;
    }
    if (changed) state = next;
  }

  /// Sends [decision] for [approvalId] on [threadId], moving the card through
  /// sending → resolved (or failed) so the buttons reflect progress.
  /// The decision is persisted as soon as the user picks it, so a crash /
  /// network drop after the tap still leaves the card in its resolved state.
  Future<void> respond(
    String threadId,
    String approvalId,
    ApprovalDecision decision,
  ) async {
    if (state[approvalId]?.phase == ApprovalResponsePhase.sending) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    _set(approvalId, ApprovalResponsePhase.sending, decision, now);
    // Persist the decision immediately (before the bridge round-trip) so an
    // answered card never re-asks on restart, even if the bridge never
    // confirms.
    await ref.read(approvalResponseStoreProvider).record(
          approvalId: approvalId,
          decision: _decisionToWire(decision),
          decidedAtMs: now,
        );
    final ok = await ref.read(threadManagerProvider).respondApproval(
          threadId: threadId,
          approvalId: approvalId,
          decision: decision,
        );
    if (!ok) {
      // The bridge didn't accept the response; flip to `failed` so the
      // buttons re-enable. The persisted decision stays — the user can tap
      // again to retry and we'll overwrite the same record idempotently.
      state = {
        ...state,
        approvalId: ApprovalResponseState(
          phase: ApprovalResponsePhase.failed,
          decision: decision,
          decidedAtMs: now,
        ),
      };
    } else {
      _set(approvalId, ApprovalResponsePhase.resolved, decision, now);
    }
  }

  void _set(
    String approvalId,
    ApprovalResponsePhase phase,
    ApprovalDecision d,
    int decidedAtMs, {
    bool withdrawn = false,
  }) {
    state = {
      ...state,
      approvalId: ApprovalResponseState(
        phase: phase,
        decision: d,
        decidedAtMs: decidedAtMs,
        withdrawn: withdrawn,
      ),
    };
  }

  static String _decisionToWire(ApprovalDecision d) => d.name;

  static ApprovalDecision? _decisionFromWire(String? name) {
    if (name == null) return null;
    for (final value in ApprovalDecision.values) {
      if (value.name == name) return value;
    }
    return null;
  }
}

/// Holds the in-memory approval-response states.
final approvalResponsesProvider =
    NotifierProvider<ApprovalResponses, Map<String, ApprovalResponseState>>(
  ApprovalResponses.new,
);
