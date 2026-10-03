import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';

void main() {
  group('Project.fromJson', () {
    test('parses a full project entry', () {
      final project = Project.fromJson(const {
        'id': 'p1',
        'name': 'App',
        'cwd': '/projects/app',
        'agentId': 'claude-code',
      });
      expect(project.id, 'p1');
      expect(project.name, 'App');
      expect(project.cwd, '/projects/app');
      expect(project.agentId, 'claude-code');
    });

    test('falls back to id for name and tolerates missing fields', () {
      final project = Project.fromJson(const {'id': 'p2'});
      expect(project.name, 'p2');
      expect(project.cwd, '');
      expect(project.agentId, isNull);
    });
  });

  group('AgentDescriptor.fromJson', () {
    test('parses capabilities and default model', () {
      final agent = AgentDescriptor.fromJson(const {
        'agentId': 'codex',
        'displayName': 'Codex',
        'available': true,
        'capabilities': {
          'accessModes': ['requestApproval', 'plan', 'retired'],
          'defaultAccessMode': 'requestApproval',
          'streaming': true,
          'approvals': false,
          'forking': true,
          'images': false,
        },
        'defaultModel': 'gpt-5',
      });
      expect(agent.agentId, 'codex');
      expect(agent.displayName, 'Codex');
      expect(agent.available, isTrue);
      // A mode this app does not know is dropped, not guessed at.
      expect(
        agent.capabilities.accessModes,
        [ApprovalMode.requestApproval, ApprovalMode.plan],
      );
      expect(
        agent.capabilities.defaultAccessMode,
        ApprovalMode.requestApproval,
      );
      expect(agent.capabilities.streaming, isTrue);
      expect(agent.capabilities.approvals, isFalse);
      expect(agent.defaultModel, 'gpt-5');
    });

    test('defaults capabilities and availability when absent', () {
      final agent = AgentDescriptor.fromJson(const {'agentId': 'pi-agent'});
      expect(agent.displayName, 'pi-agent');
      expect(agent.available, isFalse);
      expect(agent.capabilities, const AgentCapabilities());
      expect(agent.defaultModel, isNull);
    });
  });
}
