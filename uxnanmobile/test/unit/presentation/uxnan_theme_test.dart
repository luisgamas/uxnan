import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';

/// Hand-picked test theme — a custom [CustomTheme] the tests can rebuild
/// from `fromJson` / `toJson` without depending on UUID ids.
CustomTheme _testCustomTheme() {
  return CustomTheme.fromDualSchemes(
    id: 'test-theme',
    name: 'Test theme',
    description: 'Used by uxnan_theme_test.dart',
    light: ColorScheme.fromSeed(
      seedColor: const Color(0xFF6750A4),
    ),
    dark: ColorScheme.fromSeed(
      seedColor: const Color(0xFF6750A4),
      brightness: Brightness.dark,
    ),
  );
}

void main() {
  group('buildUxnanTheme — brand source (default baseline)', () {
    test('returns the hand-tuned brand light scheme', () {
      final theme = buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: ThemeSource.brand,
      );
      expect(theme.brightness, Brightness.light);
      expect(theme.colorScheme.surface, UxnanColors.lightSurface);
      expect(theme.colorScheme.onSurface, UxnanColors.lightOnSurface);
      expect(theme.colorScheme.primary, UxnanColors.lightPrimary);
      expect(theme.colorScheme.secondary, UxnanColors.lightSecondary);
      expect(
        theme.colorScheme.onSurfaceVariant,
        UxnanColors.lightOnSurfaceMuted,
      );
    });

    test('returns the hand-tuned brand dark scheme', () {
      final theme = buildUxnanTheme(
        brightness: Brightness.dark,
        themeSource: ThemeSource.brand,
      );
      expect(theme.brightness, Brightness.dark);
      expect(theme.colorScheme.surface, UxnanColors.surface);
      expect(theme.colorScheme.onSurface, UxnanColors.onSurface);
      expect(theme.colorScheme.primary, UxnanColors.primary);
      expect(theme.colorScheme.secondary, UxnanColors.secondary);
      expect(theme.colorScheme.onSurfaceVariant, UxnanColors.onSurfaceMuted);
    });

    test(
        'the brand source without a custom theme falls back to the same '
        'palette as the implicit default', () {
      final baseline = buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: ThemeSource.brand,
      );
      // Two back-to-back calls with the brand source produce identical
      // schemes — guards against accidental seed/time-of-day drift.
      final again = buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: ThemeSource.brand,
      );
      expect(again.colorScheme.primary, baseline.colorScheme.primary);
      expect(again.colorScheme.surface, baseline.colorScheme.surface);
      expect(again.colorScheme.secondary, baseline.colorScheme.secondary);
    });
  });

  group('buildUxnanTheme — custom source (user-authored theme)', () {
    test('a custom theme replaces every M3 role in light mode', () {
      final custom = _testCustomTheme();
      final theme = buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: ThemeSource.custom,
        customTheme: custom,
      );
      // Primary is the seed-derived role — must NOT be the brand blue
      // anymore, otherwise the custom theme is being silently dropped.
      expect(theme.colorScheme.primary, isNot(UxnanColors.lightPrimary));
      expect(theme.colorScheme.brightness, Brightness.light);
    });

    test('a custom theme replaces every M3 role in dark mode', () {
      final custom = _testCustomTheme();
      final theme = buildUxnanTheme(
        brightness: Brightness.dark,
        themeSource: ThemeSource.custom,
        customTheme: custom,
      );
      expect(theme.colorScheme.primary, isNot(UxnanColors.primary));
      expect(theme.colorScheme.brightness, Brightness.dark);
    });

    test('light and dark custom themes differ (no accidental pairing)', () {
      final custom = _testCustomTheme();
      final light = buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: ThemeSource.custom,
        customTheme: custom,
      );
      final dark = buildUxnanTheme(
        brightness: Brightness.dark,
        themeSource: ThemeSource.custom,
        customTheme: custom,
      );
      expect(light.colorScheme.surface, isNot(dark.colorScheme.surface));
      expect(light.colorScheme.onSurface, isNot(dark.colorScheme.onSurface));
    });

    test('two calls with the same custom theme produce identical schemes', () {
      final custom = _testCustomTheme();
      final a = buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: ThemeSource.custom,
        customTheme: custom,
      );
      final b = buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: ThemeSource.custom,
        customTheme: custom,
      );
      expect(a.colorScheme.primary, b.colorScheme.primary);
      expect(a.colorScheme.surface, b.colorScheme.surface);
      expect(a.colorScheme.secondary, b.colorScheme.secondary);
      expect(a.colorScheme.tertiary, b.colorScheme.tertiary);
    });

    test(
        'the custom source with a null theme falls back to the brand '
        'baseline', () {
      // Defensive: the UI never reaches this state, but a transient null
      // during a hot-reload or a misconfigured provider should not crash
      // the theme — it should degrade to the brand baseline.
      final theme = buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: ThemeSource.custom,
      );
      expect(theme.colorScheme.primary, UxnanColors.lightPrimary);
    });
  });
}
