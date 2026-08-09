import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart';

/// The sorting rules the three levels share.
///
/// The one that matters most is the tail: an item with nothing to sort on must
/// land in a *stable* place, or the bottom of the list reshuffles on every
/// rebuild while the user is looking at it.
void main() {
  Thread thread(
    String title, {
    DateTime? created,
    DateTime? activity,
  }) =>
      Thread(
        id: title,
        title: title,
        agentId: 'claude-code',
        syncState: ThreadSyncState.synced,
        status: ThreadStatus.active,
        createdAt: created,
        lastActivity: activity,
      );

  List<String> titles(List<Thread> list) => [for (final t in list) t.title];

  test('newest first, and unknowns sink alphabetically', () {
    final sorted = sortThreads(
      [
        thread('no date'),
        thread('old', created: DateTime(2026)),
        thread('another no date'),
        thread('new', created: DateTime(2026, 8)),
      ],
      ListSort.created,
    );

    expect(titles(sorted).take(2).toList(), ['new', 'old']);
    // The tail is ordered, not arbitrary — otherwise it churns every rebuild.
    expect(titles(sorted).skip(2).toList(), ['another no date', 'no date']);
  });

  test('status puts what wants you first, then what moved last', () {
    final waiting = thread('waiting', activity: DateTime(2026));
    final workingOld = thread('working old', activity: DateTime(2026));
    final workingNew = thread('working new', activity: DateTime(2026, 8));

    final sorted = sortThreads(
      [workingOld, workingNew, waiting],
      ListSort.status,
      statusRank: (t) => t.title.startsWith('waiting') ? 0 : 2,
    );

    expect(titles(sorted).first, 'waiting');
    // Same urgency → the one that moved last, which is what you were looking
    // at.
    expect(titles(sorted).skip(1).toList(), ['working new', 'working old']);
  });

  test('with no ranker, status falls back to activity', () {
    // The archive has no live state to rank by, and a sort that did nothing
    // would look broken rather than inapplicable.
    final sorted = sortThreads(
      [
        thread('old', activity: DateTime(2026)),
        thread('new', activity: DateTime(2026, 8)),
      ],
      ListSort.status,
    );

    expect(titles(sorted), ['new', 'old']);
  });

  test('the archive offers only what still means something there', () {
    // Archived work is finished by definition: "needs attention" and "recent
    // activity" would both sort by a value that can no longer change.
    expect(kArchiveSorts, [ListSort.created, ListSort.name]);
    expect(kArchiveSorts, isNot(contains(ListSort.status)));
    expect(kArchiveSorts, isNot(contains(ListSort.activity)));
  });

  test('a folder borrows its dates from the work inside it', () {
    // The bridge reports a path, not a history, so "created" for a folder is
    // the oldest agent in it: when you started working there.
    final group = WorkspaceGroup(
      key: '/dev/app',
      label: 'app',
      threads: [
        thread('a', created: DateTime(2026, 5), activity: DateTime(2026, 6)),
        thread('b', created: DateTime(2026), activity: DateTime(2026, 8)),
      ],
    );

    expect(workspaceCreatedAt(group), DateTime(2026));
    expect(workspaceLastActivity(group), DateTime(2026, 8));
  });

  test('a folder with no dated work has none of its own', () {
    final group = WorkspaceGroup(
      key: '/dev/app',
      label: 'app',
      threads: [thread('a')],
    );

    expect(workspaceCreatedAt(group), isNull);
    expect(workspaceLastActivity(group), isNull);
  });
}
