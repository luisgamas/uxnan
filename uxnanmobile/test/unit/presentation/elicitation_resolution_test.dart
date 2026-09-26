import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/value_objects/elicitation_resolution.dart';
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
            timedOut: false,
          ),
        );
    final state = container.read(approvalResponsesProvider)['appr-1'];
    expect(state?.phase, ApprovalResponsePhase.resolved);
    expect(state?.decision, ApprovalDecision.approveSession);
    await Future<void>.delayed(Duration.zero);
    final stored = await ApprovalResponseStore().read('appr-1');
    expect(stored?.decision, 'approveSession');
  });

  test('a timed-out approval of an unknown decision settles as a reject', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(approvalResponsesProvider.notifier).adoptResolution(
          const ApprovalResolution(
            approvalId: 'appr-2',
            decision: null,
            timedOut: true,
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
          timedOut: false,
        ),
      )
      ..adoptResolution(
        const ApprovalResolution(
          approvalId: 'appr-3',
          decision: ApprovalDecision.reject,
          timedOut: true,
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
            timedOut: false,
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
}
