import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/command_status.dart';
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
  });

  group('unknown content', () {
    test('preserves the raw JSON of an unmodeled type', () {
      final json = {
        'type': 'plan',
        'state': {'steps': 3},
      };
      final decoded = MessageContent.fromJson(json);
      expect(decoded, isA<UnknownContent>());
      expect((decoded as UnknownContent).type, 'plan');
      expect(decoded.toJson(), json);
    });

    test('handles a missing type', () {
      final decoded = MessageContent.fromJson({'foo': 'bar'});
      expect(decoded, isA<UnknownContent>());
      expect((decoded as UnknownContent).type, 'unknown');
    });
  });
}
