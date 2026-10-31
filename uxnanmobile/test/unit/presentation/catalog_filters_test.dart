import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/domain/enums/client_kind.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/thread_origin.dart';
import 'package:uxnan/presentation/screens/threads/catalog_age.dart';
import 'package:uxnan/presentation/screens/threads/conversation_catalog_screen.dart';

/// The conversation catalog's filters and age groups (architecture/02a
/// §5.8.21) — the same rules the desktop's Conversations tab applies.
void main() {
  Thread thread(
    String id, {
    String? projectId,
    String agentId = 'codex',
    ClientKind? origin,
    ThreadStatus status = ThreadStatus.active,
  }) =>
      Thread(
        id: id,
        title: id,
        agentId: agentId,
        syncState: ThreadSyncState.synced,
        status: status,
        projectId: projectId,
        origin: origin == null ? null : ThreadOrigin(kind: origin, name: 'x'),
      );

  final all = [
    thread('a', projectId: 'p1', origin: ClientKind.phone),
    thread('b', projectId: 'p1', agentId: 'claude-code'),
    thread('c', projectId: 'p2', origin: ClientKind.desktop),
    thread('d', projectId: 'p1', status: ThreadStatus.archived),
  ];
  List<String> ids(List<Thread> threads) => [for (final t in threads) t.id];

  test('no filter lists every conversation but the archived ones', () {
    expect(ids(const CatalogFilters().apply(all)), ['a', 'b', 'c']);
    expect(
      ids(const CatalogFilters(includeArchived: true).apply(all)),
      ['a', 'b', 'c', 'd'],
    );
  });

  test('project, agent and origin narrow it, together', () {
    expect(ids(const CatalogFilters(projectId: 'p1').apply(all)), ['a', 'b']);
    expect(
      ids(const CatalogFilters(projectId: 'p1', agentId: 'codex').apply(all)),
      ['a'],
    );
    expect(
      ids(const CatalogFilters(origin: ClientKind.desktop).apply(all)),
      ['c'],
    );
  });

  test('"needs you" is waiting or blocked; the others are one state each', () {
    expect(CatalogState.needsYou.admits(AgentRunState.waiting), isTrue);
    expect(CatalogState.needsYou.admits(AgentRunState.blocked), isTrue);
    expect(CatalogState.needsYou.admits(AgentRunState.working), isFalse);
    expect(CatalogState.working.admits(AgentRunState.working), isTrue);
    expect(CatalogState.done.admits(AgentRunState.idle), isFalse);
    for (final state in AgentRunState.values) {
      expect(CatalogState.any.admits(state), isTrue);
    }
  });

  test('ages group as today, this week and earlier', () {
    final now = DateTime(2026, 10, 29, 15);
    expect(CatalogAge.of(DateTime(2026, 10, 29, 0, 1), now), CatalogAge.today);
    expect(CatalogAge.of(DateTime(2026, 10, 25), now), CatalogAge.week);
    expect(CatalogAge.of(DateTime(2026, 10, 2), now), CatalogAge.earlier);
    expect(CatalogAge.of(null, now), CatalogAge.earlier);
  });
}
