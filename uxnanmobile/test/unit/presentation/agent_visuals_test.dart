import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/presentation/widgets/agent_logos.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';

void main() {
  group('AgentVisuals', () {
    test('pi has a logo, label and accent color', () {
      expect(AgentVisuals.logoFor(AgentId.piAgent), AgentLogos.pi);
      expect(AgentVisuals.labelFor(AgentId.piAgent), 'pi');
      // colorFor returns a concrete color (compile-time mapping).
      expect(AgentVisuals.colorFor(AgentId.piAgent), isNotNull);
    });

    test('the pi wire id round-trips through AgentId', () {
      expect(AgentId.piAgent.wireId, 'pi-agent');
      expect(AgentIdParsing.fromWireId('pi-agent'), AgentId.piAgent);
    });

    test('every known agent has a label', () {
      for (final id in AgentId.values) {
        expect(AgentVisuals.labelFor(id), isNotEmpty);
      }
    });
  });
}
