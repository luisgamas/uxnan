import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/infrastructure/storage/appearance_preferences_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('AppearancePreferencesStore — custom theme', () {
    test('readCustomTheme returns null when nothing is stored', () async {
      final store = AppearancePreferencesStore();
      expect(await store.readCustomTheme(), isNull);
    });

    test('writeCustomTheme persists a value that readCustomTheme returns',
        () async {
      final store = AppearancePreferencesStore();
      final theme = CustomTheme.derivedFromSeed(
        id: 'persist-1',
        name: 'Persisted',
        seed: const Color(0xFF6750A4),
      );
      await store.writeCustomTheme(theme);
      final stored = await store.readCustomTheme();
      expect(stored, isNotNull);
      expect(stored!.id, 'persist-1');
      expect(stored.name, 'Persisted');
    });

    test('writeCustomTheme(null) clears the stored value', () async {
      final store = AppearancePreferencesStore();
      await store.writeCustomTheme(
        CustomTheme.derivedFromSeed(
          id: 'tmp',
          name: 'tmp',
          seed: const Color(0xFF000000),
        ),
      );
      expect(await store.readCustomTheme(), isNotNull);
      await store.writeCustomTheme(null);
      expect(await store.readCustomTheme(), isNull);
    });

    test('an unparseable stored value is treated as unset (null)', () async {
      // A previous version of the app stored a malformed document (or
      // the user hand-edited it to garbage). The store must degrade to
      // null rather than throwing — the UI falls back to the brand
      // baseline in that case.
      SharedPreferences.setMockInitialValues({
        'uxnan.appearance.customTheme': 'not json',
      });
      final store = AppearancePreferencesStore();
      expect(await store.readCustomTheme(), isNull);
    });

    test(
        'the custom theme key is namespaced under uxnan.appearance.customTheme',
        () async {
      final store = AppearancePreferencesStore();
      await store.writeCustomTheme(
        CustomTheme.derivedFromSeed(
          id: 'ns-1',
          name: 'ns-1',
          seed: const Color(0xFF0066CC),
        ),
      );
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getString('uxnan.appearance.customTheme'),
        isNotNull,
      );
      expect(prefs.containsKey('uxnan.appearance.themeMode'), isFalse);
      expect(prefs.containsKey('uxnan.appearance.localeTag'), isFalse);
    });

    test('writing the custom theme does not disturb the other keys', () async {
      final store = AppearancePreferencesStore();
      await store.writeThemeMode('dark');
      await store.writeLocaleTag('es');
      await store.writeCustomTheme(
        CustomTheme.derivedFromSeed(
          id: 'iso-1',
          name: 'iso',
          seed: const Color(0xFF0066CC),
        ),
      );
      expect(await store.readThemeMode(), 'dark');
      expect(await store.readLocaleTag(), 'es');
      expect(await store.readCustomTheme(), isNotNull);
    });

    test('round-trip preserves every role in the persisted theme', () async {
      final store = AppearancePreferencesStore();
      final original = CustomTheme.fromDualSchemes(
        id: 'round-1',
        name: 'Round-trip',
        light: const ColorScheme(
          brightness: Brightness.light,
          primary: Color(0xFF112233),
          onPrimary: Color(0xFF445566),
          secondary: Color(0xFF778899),
          onSecondary: Color(0xFFAABBCC),
          error: Color(0xFFDDEEFF),
          onError: Color(0xFF001122),
          surface: Color(0xFF334455),
          onSurface: Color(0xFF667788),
        ),
        dark: const ColorScheme(
          brightness: Brightness.dark,
          primary: Color(0xFF99AABB),
          onPrimary: Color(0xFFCCDD11),
          secondary: Color(0xFFFF1122),
          onSecondary: Color(0xFF334455),
          error: Color(0xFF667788),
          onError: Color(0xFF99AABB),
          surface: Color(0xFFCCDD11),
          onSurface: Color(0xFFFF1122),
        ),
      );
      await store.writeCustomTheme(original);
      final restored = await store.readCustomTheme();
      expect(restored, isNotNull);
      expect(restored!.lightColors.primary, original.lightColors.primary);
      expect(restored.lightColors.surface, original.lightColors.surface);
      expect(restored.darkColors.primary, original.darkColors.primary);
      expect(restored.darkColors.error, original.darkColors.error);
    });
  });
}
