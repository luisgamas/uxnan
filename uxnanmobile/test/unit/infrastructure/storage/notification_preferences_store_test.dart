import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';
import 'package:uxnan/infrastructure/storage/notification_preferences_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  NotificationPreferencesStore storeWith(Map<String, Object> initial) {
    SharedPreferences.setMockInitialValues(initial);
    return NotificationPreferencesStore(
      preferences: SharedPreferences.getInstance(),
    );
  }

  test('read returns null when nothing was ever stored', () async {
    final store = storeWith({});
    expect(await store.read(), isNull);
  });

  test('write then read round-trips the preferences', () async {
    final store = storeWith({});
    const prefs = NotificationPreferences(turnCompleted: false);
    await store.write(prefs);
    expect(await store.read(), prefs);
  });

  test('read hydrates from existing stored values', () async {
    final store = storeWith({
      'uxnan.notifications.turnCompleted': true,
      'uxnan.notifications.turnError': false,
    });
    expect(
      await store.read(),
      const NotificationPreferences(turnError: false),
    );
  });
}
