import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/infrastructure/storage/appearance_preferences_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('AppearancePreferencesStore — accent id', () {
    test('readAccentId returns null when nothing is stored', () async {
      final store = AppearancePreferencesStore();
      expect(await store.readAccentId(), isNull);
    });

    test('writeAccentId persists a value that readAccentId returns', () async {
      final store = AppearancePreferencesStore();
      await store.writeAccentId('purple');
      expect(await store.readAccentId(), 'purple');
    });

    test('writeAccentId(null) clears the stored value', () async {
      final store = AppearancePreferencesStore();
      await store.writeAccentId('teal');
      expect(await store.readAccentId(), 'teal');
      await store.writeAccentId(null);
      expect(await store.readAccentId(), isNull);
    });

    test('writeAccentId with an empty string also clears the value', () async {
      final store = AppearancePreferencesStore();
      await store.writeAccentId('orange');
      await store.writeAccentId('');
      expect(await store.readAccentId(), isNull);
    });

    test('an empty stored value is treated as unset (null)', () async {
      // Some platforms / older builds may persist a blank value; read
      // should normalize it to null so the picker falls back to the
      // brand default.
      SharedPreferences.setMockInitialValues({
        'uxnan.appearance.accentId': '',
      });
      final store = AppearancePreferencesStore();
      expect(await store.readAccentId(), isNull);
    });

    test('the accent key is namespaced under uxnan.appearance.accentId',
        () async {
      // Guard against an accidental rename of the on-device key — a
      // rename would silently break the persistence contract for every
      // user that has ever picked an accent.
      final store = AppearancePreferencesStore();
      await store.writeAccentId('green');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('uxnan.appearance.accentId'), 'green');
      expect(prefs.containsKey('uxnan.appearance.themeMode'), isFalse);
      expect(prefs.containsKey('uxnan.appearance.localeTag'), isFalse);
    });

    test('writing the accent does not disturb the other appearance keys',
        () async {
      final store = AppearancePreferencesStore();
      await store.writeThemeMode('dark');
      await store.writeLocaleTag('es');
      await store.writeAccentId('pink');
      expect(await store.readThemeMode(), 'dark');
      expect(await store.readLocaleTag(), 'es');
      expect(await store.readAccentId(), 'pink');
    });
  });
}
