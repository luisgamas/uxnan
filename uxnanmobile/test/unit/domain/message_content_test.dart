import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/approval_risk.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/plan_step_status.dart';
import 'package:uxnan/domain/enums/subagent_action_kind.dart';
import 'package:uxnan/domain/enums/system_content_kind.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

void main() {
  MessageContent roundTrip(MessageContent content) =>
      MessageContent.fromJson(content.toJson());

  group('MessageContent JSON round-trip', () {
    test('text', () {
      const c = TextContent('hola', isStreaming: true);
      expect(roundTrip(c), c);
    });

    test('code', () {
      const c = CodeContent('print(1)', language: 'dart', filename: 'a.dart');
      expect(roundTrip(c), c);
    });

    test('image', () {
      const c = ImageContent(mimeType: 'image/png', path: '/p.png', width: 10);
      expect(roundTrip(c), c);
    });

    test('tool use', () {
      const c = ToolUseContent(
        toolName: 'read',
        toolId: 't1',
        input: {'path': 'x'},
        output: 'ok',
      );
      expect(roundTrip(c), c);
    });

    test('diff', () {
      const c = DiffContent(
        filename: 'a.dart',
        diff: '@@ -1 +1 @@',
        additions: 2,
        deletions: 1,
      );
      expect(roundTrip(c), c);
    });

    test('mermaid', () {
      const c = MermaidContent('graph TD;', diagramType: 'flowchart');
      expect(roundTrip(c), c);
    });

    test('system', () {
      const c = SystemContent('careful', kind: SystemContentKind.warning);
      expect(roundTrip(c), c);
    });

    test('command execution', () {
      const c = CommandExecutionContent(
        command: 'git status',
        status: CommandStatus.completed,
        output: 'clean',
        exitCode: 0,
      );
      expect(roundTrip(c), c);
    });

    test('approval', () {
      const c = ApprovalContent(
        ApprovalRequest(
          approvalId: 'a1',
          action: 'rm -rf build',
          risk: ApprovalRisk.high,
          detail: 'in /project',
        ),
      );
      expect(roundTrip(c), c);
    });

    test('plan', () {
      const c = PlanContent(
        PlanState(
          title: 'Refactor',
          steps: [
            PlanStep(description: 'a', status: PlanStepStatus.completed),
            PlanStep(description: 'b', status: PlanStepStatus.inProgress),
            PlanStep(description: 'c'),
          ],
        ),
      );
      expect(roundTrip(c), c);
    });

    test('subagent', () {
      const c = SubagentContent(
        SubagentState(
          id: 's1',
          name: 'reviewer',
          status: 'running',
          actions: [
            SubagentAction(label: 'read file', kind: SubagentActionKind.tool),
            SubagentAction(label: 'note'),
          ],
        ),
      );
      expect(roundTrip(c), c);
    });

    test('question', () {
      const c = QuestionContent(
        QuestionRequest(
          questionId: 'q1',
          questions: [
            QuestionItem(
              question: 'Which language?',
              header: 'Language',
              options: [
                QuestionOption(label: 'Dart', description: 'typed'),
                QuestionOption(label: 'JS'),
              ],
              multiple: true,
            ),
          ],
        ),
      );
      expect(roundTrip(c), c);
    });
  });

  group('advanced content tolerant parsing', () {
    test('approval accepts a flat payload', () {
      final c = MessageContent.fromJson({
        'type': 'approval',
        'approvalId': 'a1',
        'action': 'delete a file',
        'risk': 'medium',
      });
      expect(c, isA<ApprovalContent>());
      final request = (c as ApprovalContent).request;
      expect(request.approvalId, 'a1');
      expect(request.risk, ApprovalRisk.medium);
    });

    test('question accepts a flat payload and defaults missing fields', () {
      final c = MessageContent.fromJson({
        'type': 'question',
        'questionId': 'q1',
        'questions': [
          {
            'question': 'Pick one',
            'options': [
              {'label': 'A'},
              {'label': 'B'},
            ],
          },
        ],
      });
      expect(c, isA<QuestionContent>());
      final request = (c as QuestionContent).request;
      expect(request.questionId, 'q1');
      final question = request.questions.single;
      expect(question.options.length, 2);
      expect(question.header, isNull);
      // `multiple` defaults to single-select when the field is absent.
      expect(question.multiple, isFalse);
    });

    test('plan maps the in_progress wire status', () {
      final c = MessageContent.fromJson({
        'type': 'plan',
        'state': {
          'steps': [
            {'description': 'x', 'status': 'in_progress'},
          ],
        },
      }) as PlanContent;
      expect(c.state.steps.single.status, PlanStepStatus.inProgress);
    });

    test('unknown risk and subagent kind fall back gracefully', () {
      final approval = MessageContent.fromJson({
        'type': 'approval',
        'action': 'x',
        'risk': 'nope',
      }) as ApprovalContent;
      expect(approval.request.risk, ApprovalRisk.unknown);

      final subagent = MessageContent.fromJson({
        'type': 'subagent',
        'state': {
          'name': 'n',
          'actions': [
            {'label': 'l', 'kind': 'weird'},
          ],
        },
      }) as SubagentContent;
      expect(subagent.state.actions.single.kind, SubagentActionKind.unknown);
    });
  });

  group('unknown content', () {
    test('preserves the raw JSON of an unmodeled type', () {
      final json = {
        'type': 'holographic',
        'frames': 3,
      };
      final decoded = MessageContent.fromJson(json);
      expect(decoded, isA<UnknownContent>());
      expect((decoded as UnknownContent).type, 'holographic');
      expect(decoded.toJson(), json);
    });

    test('handles a missing type', () {
      final decoded = MessageContent.fromJson({'foo': 'bar'});
      expect(decoded, isA<UnknownContent>());
      expect((decoded as UnknownContent).type, 'unknown');
    });
  });
}
