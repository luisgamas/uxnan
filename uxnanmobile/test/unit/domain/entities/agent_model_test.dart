import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_model.dart';

void main() {
  group('AgentModel.fromAny', () {
    test('parses a structured map', () {
      final model = AgentModel.fromAny({
        'id': 'gpt-5.5',
        'displayName': 'GPT-5.5',
        'description': 'Frontier model.',
        'isDefault': true,
      });
      expect(model, isNotNull);
      expect(model!.id, 'gpt-5.5');
      expect(model.displayName, 'GPT-5.5');
      expect(model.description, 'Frontier model.');
      expect(model.isDefault, isTrue);
    });

    test('accepts a bare id string (legacy bridge)', () {
      final model = AgentModel.fromAny('anthropic/claude-3-opus');
      expect(model, isNotNull);
      expect(model!.id, 'anthropic/claude-3-opus');
      expect(model.displayName, 'anthropic/claude-3-opus');
      expect(model.isDefault, isFalse);
    });

    test('falls back displayName to id and drops empty description/version',
        () {
      final model = AgentModel.fromAny({
        'id': 'opus',
        'displayName': '',
        'description': '',
        'version': '',
      });
      expect(model!.displayName, 'opus');
      expect(model.description, isNull);
      expect(model.version, isNull);
    });

    test('keeps the resolved version when present', () {
      final model = AgentModel.fromAny({
        'id': 'opus',
        'displayName': 'Opus',
        'version': 'claude-opus-4-8',
      });
      expect(model!.version, 'claude-opus-4-8');
    });

    test('returns null for missing/empty id or wrong types', () {
      expect(AgentModel.fromAny({'displayName': 'no id'}), isNull);
      expect(AgentModel.fromAny({'id': '  '}), isNull);
      expect(AgentModel.fromAny(''), isNull);
      expect(AgentModel.fromAny(42), isNull);
      expect(AgentModel.fromAny(null), isNull);
    });
  });
}
