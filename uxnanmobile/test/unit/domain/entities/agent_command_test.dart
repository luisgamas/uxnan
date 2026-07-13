import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_command.dart';

void main() {
  group('AgentCommand.fromAny', () {
    test('parses a structured map', () {
      final command = AgentCommand.fromAny({
        'name': 'refactor',
        'description': 'Refactor a file',
        'argumentHint': '<file>',
        'source': 'custom',
        'headlessSupported': true,
      });
      expect(command, isNotNull);
      expect(command!.name, 'refactor');
      expect(command.description, 'Refactor a file');
      expect(command.argumentHint, '<file>');
      expect(command.source, 'custom');
      expect(command.headlessSupported, isTrue);
    });

    test('defaults source=custom and headlessSupported=true when absent', () {
      final command = AgentCommand.fromAny({'name': 'compact'});
      expect(command, isNotNull);
      expect(command!.source, 'custom');
      expect(command.headlessSupported, isTrue);
      expect(command.description, isNull);
      expect(command.argumentHint, isNull);
    });

    test('honours headlessSupported: false', () {
      final command = AgentCommand.fromAny({
        'name': 'config',
        'headlessSupported': false,
      });
      expect(command!.headlessSupported, isFalse);
    });

    test('returns null when name is missing or empty', () {
      expect(AgentCommand.fromAny({'description': 'x'}), isNull);
      expect(AgentCommand.fromAny({'name': '   '}), isNull);
      expect(AgentCommand.fromAny('not a map'), isNull);
    });
  });
}
