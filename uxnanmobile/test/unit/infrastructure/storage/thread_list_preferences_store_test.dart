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
    expect(await store.readSort(), isNull);
    expect(await store.readCompact(), isNull);
  });

  test('write then read round-trips the sort name', () async {
    final store = storeWith({});
    await store.writeSort('folder');
    expect(await store.readSort(), 'folder');
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
    expect(await store.readSort(), 'name');
    expect(await store.readCompact(), isTrue);
  });
}
