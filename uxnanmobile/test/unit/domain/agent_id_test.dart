import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/agent_id.dart';

void main() {
  group('AgentId wire mapping', () {
    test('every value round-trips through its wireId', () {
      for (final id in AgentId.values) {
        expect(AgentIdParsing.fromWireId(id.wireId), id);
      }
    });

    test('hyphenated wire ids decode correctly', () {
      expect(AgentIdParsing.fromWireId('claude-code'), AgentId.claudeCode);
      expect(AgentIdParsing.fromWireId('gemini-cli'), AgentId.geminiCli);
      expect(AgentIdParsing.fromWireId('antigravity-cli'), AgentId.antigravity);
      expect(AgentIdParsing.fromWireId('pi-agent'), AgentId.piAgent);
    });

    test('grok round-trips through its wire id', () {
      expect(AgentId.grok.wireId, 'grok');
      expect(AgentIdParsing.fromWireId('grok'), AgentId.grok);
    });

    test('unknown wire ids degrade to custom', () {
      expect(AgentIdParsing.fromWireId('some-future-agent'), AgentId.custom);
    });
  });
}
