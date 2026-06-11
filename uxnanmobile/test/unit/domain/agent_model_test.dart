import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_model.dart';

void main() {
  group('groupModelsByProvider', () {
    test('groups provider/model ids by their prefix, preserving order', () {
      final groups = groupModelsByProvider(const [
        AgentModel(id: 'google/gemini-2.5-pro', displayName: 'gemini-2.5-pro'),
        AgentModel(id: 'openai/gpt-5', displayName: 'gpt-5'),
        AgentModel(id: 'google/gemini-flash', displayName: 'gemini-flash'),
      ]);
      expect(groups.map((g) => g.provider).toList(), ['google', 'openai']);
      expect(
        groups.first.models.map((m) => m.id).toList(),
        ['google/gemini-2.5-pro', 'google/gemini-flash'],
      );
      expect(groups[1].models.single.id, 'openai/gpt-5');
    });

    test('falls back to description then "Other" when the id has no slash', () {
      final groups = groupModelsByProvider(const [
        AgentModel(id: 'opus', displayName: 'opus', description: 'anthropic'),
        AgentModel(id: 'gpt-5-codex', displayName: 'gpt-5-codex'),
      ]);
      expect(groups.map((g) => g.provider).toList(), ['anthropic', 'Other']);
    });

    test('a single shared provider collapses to one group (flat list)', () {
      final groups = groupModelsByProvider(const [
        AgentModel(id: 'opus', displayName: 'opus'),
        AgentModel(id: 'sonnet', displayName: 'sonnet'),
      ]);
      expect(groups, hasLength(1));
      expect(groups.single.provider, 'Other');
      expect(groups.single.models, hasLength(2));
    });

    test('empty input yields no groups', () {
      expect(groupModelsByProvider(const []), isEmpty);
    });
  });

  group('providerOfModel', () {
    test('prefers the id prefix before the first slash', () {
      expect(
        providerOfModel(
          const AgentModel(id: 'opencode/glm-5', displayName: 'opencode/glm-5'),
        ),
        'opencode',
      );
    });

    test('uses description, then "Other", for ids without a slash', () {
      expect(
        providerOfModel(
          const AgentModel(id: 'opus', displayName: 'opus', description: 'x'),
        ),
        'x',
      );
      expect(
        providerOfModel(const AgentModel(id: 'codex', displayName: 'codex')),
        'Other',
      );
    });
  });
}
