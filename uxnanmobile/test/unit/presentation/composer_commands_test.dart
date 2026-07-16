import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_command.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_commands.dart';

void main() {
  const commands = [
    AgentCommand(name: 'compact', description: 'Free up context'),
    AgentCommand(name: 'refactor', argumentHint: '<file>'),
    AgentCommand(name: 'hidden', headlessSupported: false),
  ];

  group('parseAgentCommand', () {
    test('matches a bare /name to an advertised command', () {
      final parsed = parseAgentCommand('/compact', commands);
      expect(parsed, isNotNull);
      expect(parsed!.name, 'compact');
      expect(parsed.args, isNull);
    });

    test('splits /name args into name + trimmed args', () {
      final parsed =
          parseAgentCommand('/refactor  lib/auth.dart high ', commands);
      expect(parsed, isNotNull);
      expect(parsed!.name, 'refactor');
      expect(parsed.args, 'lib/auth.dart high');
    });

    test('returns null for an unknown command (sent as plain text)', () {
      expect(parseAgentCommand('/unknown do it', commands), isNull);
      expect(parseAgentCommand('just a message', commands), isNull);
    });

    test('does not match a command that is not headless-supported', () {
      expect(parseAgentCommand('/hidden', commands), isNull);
    });
  });

  group('agentComposerCommands', () {
    test('maps headless commands to /name palette rows, hiding the rest', () {
      final rows = agentComposerCommands(commands);
      // `hidden` (headlessSupported: false) is dropped.
      expect(rows.map((r) => r.id), ['compact', 'refactor']);
      expect(rows.first.label, '/compact');
      expect(rows.first.template, '/compact ');
      // The argument hint is surfaced when there is no description.
      expect(rows[1].description, 'args: <file>');
    });
  });
}
