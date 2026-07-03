import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/enums/update_check_interval.dart';
import 'package:uxnan/infrastructure/storage/update_preferences_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  UpdatePreferencesStore storeWith(Map<String, Object> initial) {
    SharedPreferences.setMockInitialValues(initial);
    return UpdatePreferencesStore(preferences: SharedPreferences.getInstance());
  }

  group('lastCheck', () {
    test('is null when never written', () async {
      expect(await storeWith({}).readLastCheck(), isNull);
    });

    test('round-trips a timestamp (to the millisecond)', () async {
      final store = storeWith({});
      final when = DateTime.fromMillisecondsSinceEpoch(1700000000000);
      await store.writeLastCheck(when);
      expect(await store.readLastCheck(), when);
    });
  });

  group('dismissedVersion', () {
    test('is null when never written', () async {
      expect(await storeWith({}).readDismissedVersion(), isNull);
    });

    test('round-trips a version', () async {
      final store = storeWith({});
      await store.writeDismissedVersion('42');
      expect(await store.readDismissedVersion(), '42');
    });

    test('clears on a null/empty value', () async {
      final store = storeWith({'uxnan.updates.dismissedVersion': '42'});
      await store.writeDismissedVersion(null);
      expect(await store.readDismissedVersion(), isNull);
      await store.writeDismissedVersion('7');
      await store.writeDismissedVersion('');
      expect(await store.readDismissedVersion(), isNull);
    });
  });

  group('interval', () {
    test('defaults when unset', () async {
      expect(
        await storeWith({}).readInterval(),
        UpdateCheckInterval.defaultInterval,
      );
    });

    test('defaults on an unknown stored value', () async {
      final store = storeWith({'uxnan.updates.checkInterval': 'bogus'});
      expect(await store.readInterval(), UpdateCheckInterval.defaultInterval);
    });

    test('round-trips a chosen interval', () async {
      final store = storeWith({});
      await store.writeInterval(UpdateCheckInterval.weekly);
      expect(await store.readInterval(), UpdateCheckInterval.weekly);
      await store.writeInterval(UpdateCheckInterval.everyLaunch);
      expect(await store.readInterval(), UpdateCheckInterval.everyLaunch);
    });
  });
}
