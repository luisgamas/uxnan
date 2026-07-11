import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';

/// Lifecycle of a single interactive question response.
enum QuestionResponsePhase {
  /// No answer sent yet — the question is actionable.
  idle,

  /// The answer is in flight to the bridge.
  sending,

  /// The bridge accepted the answer; the question is settled.
  resolved,

  /// The answer failed to send; the question is actionable again.
  failed,
}

/// The local state of one question response, keyed by `questionId`.
///
/// [answeredAtMs] is set when the user answers (regardless of whether the
/// bridge confirms the send) so the card can show its chosen labels + "Answered
/// · 14:32" even when the bridge is offline.
class QuestionResponseState {
  /// Creates a [QuestionResponseState].
  const QuestionResponseState({
    required this.phase,
    this.answers,
    this.answeredAtMs,
  });

  /// Where the response is in its lifecycle.
  final QuestionResponsePhase phase;

  /// The chosen labels, one list per question (null while [phase] is
  /// [QuestionResponsePhase.idle]). An empty inner list means that question was
  /// skipped.
  final List<List<String>>? answers;

  /// When the user answered (epoch ms); null while [phase] is idle.
  final int? answeredAtMs;

  /// Creates a copy with the given fields replaced.
  QuestionResponseState copyWith({
    QuestionResponsePhase? phase,
    List<List<String>>? answers,
    int? answeredAtMs,
  }) =>
      QuestionResponseState(
        phase: phase ?? this.phase,
        answers: answers ?? this.answers,
        answeredAtMs: answeredAtMs ?? this.answeredAtMs,
      );
}

/// Tracks the user's answers to pending questions so a question card can flip
/// to an in-flight / resolved / failed state without waiting for a fresh
/// content block. The map is **persisted on-device** via the
/// `questionResponseStoreProvider` (see `QuestionResponseStore`) so an answered
/// card stays in its resolved state across scrolls and app restarts (the
/// options never re-enable, the card never asks twice).
///
/// `build()` returns the empty map synchronously (so the UI can render on the
/// first frame), then hydrates from the store — a stale read just renders
/// `idle` for a frame and flips to the persisted `resolved` state on the next
/// rebuild, the same pattern as the approval-response notifier.
class QuestionResponses extends Notifier<Map<String, QuestionResponseState>> {
  @override
  Map<String, QuestionResponseState> build() {
    unawaited(_hydrate());
    return const {};
  }

  /// Loads the persisted answers and merges them into the in-memory map.
  /// Answers not yet present in memory are added with a `resolved` phase (and
  /// the original `answeredAtMs` from the store) so the card renders as
  /// already-answered on the very next rebuild.
  Future<void> _hydrate() async {
    final persisted = await ref.read(questionResponseStoreProvider).readAll();
    if (persisted.isEmpty) return;
    var changed = false;
    final next = <String, QuestionResponseState>{...state};
    for (final entry in persisted.entries) {
      final existing = next[entry.key];
      // Don't downgrade a more authoritative in-memory state (a fresh
      // `sending` round-trip in progress) to a stale persisted `resolved`.
      if (existing?.phase == QuestionResponsePhase.sending) continue;
      next[entry.key] = QuestionResponseState(
        phase: QuestionResponsePhase.resolved,
        answers: entry.value.answers,
        answeredAtMs: entry.value.answeredAtMs,
      );
      changed = true;
    }
    if (changed) state = next;
  }

  /// Sends [answers] for [questionId] on [threadId], moving the card through
  /// sending → resolved (or failed) so the UI reflects progress. [answers] is
  /// one entry per question, each a list of chosen option labels (an empty
  /// inner list skips that question). The answers are persisted as soon as the
  /// user submits, so a crash / network drop after the tap still leaves the
  /// card in its resolved state.
  Future<void> respond(
    String threadId,
    String questionId,
    List<List<String>> answers,
  ) async {
    if (state[questionId]?.phase == QuestionResponsePhase.sending) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    _set(questionId, QuestionResponsePhase.sending, answers, now);
    // Persist immediately (before the bridge round-trip) so an answered card
    // never re-asks on restart, even if the bridge never confirms.
    await ref.read(questionResponseStoreProvider).record(
          questionId: questionId,
          answers: answers,
          answeredAtMs: now,
        );
    final ok = await ref.read(threadManagerProvider).respondQuestion(
          threadId: threadId,
          questionId: questionId,
          answers: answers,
        );
    if (!ok) {
      // The bridge didn't accept the answer; flip to `failed` so the options
      // re-enable. The persisted answers stay — the user can submit again to
      // retry and we'll overwrite the same record idempotently.
      state = {
        ...state,
        questionId: QuestionResponseState(
          phase: QuestionResponsePhase.failed,
          answers: answers,
          answeredAtMs: now,
        ),
      };
    } else {
      _set(questionId, QuestionResponsePhase.resolved, answers, now);
    }
  }

  void _set(
    String questionId,
    QuestionResponsePhase phase,
    List<List<String>> answers,
    int answeredAtMs,
  ) {
    state = {
      ...state,
      questionId: QuestionResponseState(
        phase: phase,
        answers: answers,
        answeredAtMs: answeredAtMs,
      ),
    };
  }
}

/// Holds the in-memory question-response states.
final questionResponsesProvider =
    NotifierProvider<QuestionResponses, Map<String, QuestionResponseState>>(
  QuestionResponses.new,
);
