import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';

// The same cases as shared/test/access-mode.test.ts: the phone shows the mode
// the bridge will run.
void main() {
  group('AgentCapabilities.effectiveAccessMode', () {
    const caps = AgentCapabilities(
      accessModes: [ApprovalMode.approveForMe, ApprovalMode.fullAccess],
      defaultAccessMode: ApprovalMode.fullAccess,
    );

    test('keeps a stored mode the agent offers', () {
      expect(
        caps.effectiveAccessMode(ApprovalMode.approveForMe),
        ApprovalMode.approveForMe,
      );
    });

    test('runs a mode the agent does not offer as its default', () {
      final retired = caps.effectiveAccessMode(ApprovalMode.plan);
      expect(retired, ApprovalMode.fullAccess);
      expect(caps.effectiveAccessMode(null), ApprovalMode.fullAccess);
    });

    test('falls back to the first mode when the default is not listed', () {
      const odd = AgentCapabilities(
        accessModes: [ApprovalMode.requestApproval],
        defaultAccessMode: ApprovalMode.fullAccess,
      );
      expect(odd.effectiveAccessMode(null), ApprovalMode.requestApproval);
    });

    test('has no mode for an agent that offers none', () {
      const none = AgentCapabilities();
      expect(none.effectiveAccessMode(ApprovalMode.fullAccess), isNull);
    });
  });

  test('ApprovalMode.fromName reads the wire name, and nothing else', () {
    expect(ApprovalMode.fromName('plan'), ApprovalMode.plan);
    expect(ApprovalMode.fromName('retired'), isNull);
    expect(ApprovalMode.fromName(null), isNull);
  });
}
