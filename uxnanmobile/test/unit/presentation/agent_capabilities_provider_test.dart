import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

void main() {
  test('returns the agent capabilities when the agent is known', () async {
    final container = ProviderContainer(
      overrides: [
        agentsProvider.overrideWith(
          (ref) async => const [
            AgentDescriptor(
              agentId: 'codex',
              displayName: 'Codex',
              available: true,
              capabilities: AgentCapabilities(approvals: true),
            ),
          ],
        ),
      ],
    );
    addTearDown(container.dispose);
    await container.read(agentsProvider.future);

    final caps = container.read(agentCapabilitiesProvider('codex'));
    expect(caps.approvals, isTrue);
    expect(caps.images, isFalse);
    expect(caps.reportsContextUsage, isFalse);
  });

  test('AgentCapabilities.fromJson parses reportsContextUsage', () {
    expect(
      AgentCapabilities.fromJson(const {'reportsContextUsage': true})
          .reportsContextUsage,
      isTrue,
    );
    expect(AgentCapabilities.fromJson(const {}).reportsContextUsage, isFalse);
  });

  test('is permissive when the agent is unknown', () async {
    final container = ProviderContainer(
      overrides: [
        agentsProvider.overrideWith((ref) async => const <AgentDescriptor>[]),
      ],
    );
    addTearDown(container.dispose);
    await container.read(agentsProvider.future);

    final caps = container.read(agentCapabilitiesProvider('nope'));
    expect(caps.approvals, isTrue);
    expect(caps.images, isTrue);
    expect(caps.planMode, isTrue);
    expect(caps.reportsContextUsage, isTrue);
  });
}
