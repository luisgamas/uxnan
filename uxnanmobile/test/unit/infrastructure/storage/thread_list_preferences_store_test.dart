import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/infrastructure/storage/thread_list_preferences_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  ThreadListPreferencesStore storeWith(Map<String, Object> initial) {
    SharedPreferences.setMockInitialValues(initial);
    return ThreadListPreferencesStore(
      preferences: SharedPreferences.getInstance(),
    );
  }

  test('reads return null when nothing was ever stored', () async {
    final store = storeWith({});
    expect(await store.readSort('agents'), isNull);
    expect(await store.readSort('projects'), isNull);
    expect(await store.readCompact(), isNull);
  });

  test('each level keeps its own ordering', () async {
    final store = storeWith({});
    await store.writeSort('projects', 'name');
    await store.writeSort('agents', 'activity');
    expect(await store.readSort('projects'), 'name');
    expect(await store.readSort('agents'), 'activity');
    expect(await store.readSort('worktrees'), isNull);
  });

  test('write then read round-trips the compact flag', () async {
    final store = storeWith({});
    await store.writeCompact(value: true);
    expect(await store.readCompact(), isTrue);
  });

  test('reads hydrate from existing stored values', () async {
    final store = storeWith({
      'uxnan.threads.sort': 'name',
      'uxnan.threads.compact': true,
    });
    // The conversations keep the key they always had.
    expect(await store.readSort('agents'), 'name');
    expect(await store.readCompact(), isTrue);
  });
}
