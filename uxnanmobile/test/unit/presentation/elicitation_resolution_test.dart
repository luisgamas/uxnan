import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/value_objects/elicitation_resolution.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/infrastructure/storage/approval_response_store.dart';
import 'package:uxnan/infrastructure/storage/question_response_store.dart';
import 'package:uxnan/presentation/providers/approval_providers.dart';
import 'package:uxnan/presentation/providers/question_providers.dart';

/// An approval or question answered on another client (the desktop, a second
/// phone) must settle this phone's card too, and survive a restart.
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('an approval answered elsewhere settles the card and is persisted',
      () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(approvalResponsesProvider.notifier).adoptResolution(
          const ApprovalResolution(
            approvalId: 'appr-1',
            decision: ApprovalDecision.approveSession,
            withdrawn: false,
          ),
        );
    final state = container.read(approvalResponsesProvider)['appr-1'];
    expect(state?.phase, ApprovalResponsePhase.resolved);
    expect(state?.decision, ApprovalDecision.approveSession);
    await Future<void>.delayed(Duration.zero);
    final stored = await ApprovalResponseStore().read('appr-1');
    expect(stored?.decision, 'approveSession');
  });

  test('a withdrawn approval of an unknown decision settles as a reject', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(approvalResponsesProvider.notifier).adoptResolution(
          const ApprovalResolution(
            approvalId: 'appr-2',
            decision: null,
            withdrawn: true,
          ),
        );
    expect(
      container.read(approvalResponsesProvider)['appr-2']?.decision,
      ApprovalDecision.reject,
    );
  });

  test('a card this phone already resolved keeps its own decision', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(approvalResponsesProvider.notifier)
      ..adoptResolution(
        const ApprovalResolution(
          approvalId: 'appr-3',
          decision: ApprovalDecision.approve,
          withdrawn: false,
        ),
      )
      ..adoptResolution(
        const ApprovalResolution(
          approvalId: 'appr-3',
          decision: ApprovalDecision.reject,
          withdrawn: true,
        ),
      );
    expect(notifier, isNotNull);
    expect(
      container.read(approvalResponsesProvider)['appr-3']?.decision,
      ApprovalDecision.approve,
    );
  });

  test('a question answered elsewhere shows the chosen labels', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(questionResponsesProvider.notifier).adoptResolution(
          const QuestionResolution(
            questionId: 'q-1',
            answers: [
              ['B'],
            ],
            withdrawn: false,
          ),
        );
    final state = container.read(questionResponsesProvider)['q-1'];
    expect(state?.phase, QuestionResponsePhase.resolved);
    expect(state?.answers, [
      ['B'],
    ]);
    await Future<void>.delayed(Duration.zero);
    final stored = await QuestionResponseStore().read('q-1');
    expect(stored?.answers, [
      ['B'],
    ]);
  });

  test('a withdrawn approval is kept as withdrawn, across a restart', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(approvalResponsesProvider.notifier).adoptResolution(
          const ApprovalResolution(
            approvalId: 'appr-w',
            decision: ApprovalDecision.reject,
            withdrawn: true,
          ),
        );
    final state = container.read(approvalResponsesProvider)['appr-w'];
    expect(state?.withdrawn, isTrue);
    await Future<void>.delayed(Duration.zero);
    expect((await ApprovalResponseStore().read('appr-w'))?.withdrawn, isTrue);
  });

  test('the stored outcome on the card is what it shows', () {
    const local = ApprovalResponseState(
      phase: ApprovalResponsePhase.resolved,
      decision: ApprovalDecision.approve,
      decidedAtMs: 7,
    );
    // Nothing stored: this phone's own state.
    expect(ApprovalResponseState.settled(null, local), same(local));
    expect(ApprovalResponseState.settled(null, null), isNull);
    // Stored: the bridge's record, keeping when this phone answered.
    final settled = ApprovalResponseState.settled(
      const ApprovalOutcome(decision: ApprovalDecision.approve),
      local,
    );
    expect(settled?.phase, ApprovalResponsePhase.resolved);
    expect(settled?.decidedAtMs, 7);
    final withdrawn = ApprovalResponseState.settled(
      const ApprovalOutcome(decision: ApprovalDecision.reject, withdrawn: true),
      null,
    );
    expect(withdrawn?.withdrawn, isTrue);
    expect(withdrawn?.decidedAtMs, isNull);

    final question = QuestionResponseState.settled(
      const QuestionOutcome(
        answers: [
          ['A'],
        ],
      ),
      null,
    );
    expect(question?.phase, QuestionResponsePhase.resolved);
    expect(question?.answers, [
      ['A'],
    ]);
    expect(QuestionResponseState.settled(null, null), isNull);
  });
}
