import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/accent_color.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';

void main() {
  group('buildUxnanTheme — default (hand-tuned brand palette)', () {
    test('returns a light color scheme from UxnanColors', () {
      final theme = buildUxnanTheme(brightness: Brightness.light);

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

    test('returns a dark color scheme from UxnanColors', () {
      final theme = buildUxnanTheme();

      expect(theme.brightness, Brightness.dark);
      expect(theme.colorScheme.surface, UxnanColors.surface);
      expect(theme.colorScheme.onSurface, UxnanColors.onSurface);
      expect(theme.colorScheme.primary, UxnanColors.primary);
      expect(theme.colorScheme.secondary, UxnanColors.secondary);
      expect(theme.colorScheme.onSurfaceVariant, UxnanColors.onSurfaceMuted);
    });

    test(
        'passing the brand blue accent explicitly behaves the same as '
        'no accent (the hand-tuned palette is preserved)', () {
      final none = buildUxnanTheme(brightness: Brightness.light);
      final explicit = buildUxnanTheme(
        brightness: Brightness.light,
        accent: AccentPalette.defaultAccent,
      );
      expect(explicit.colorScheme.primary, none.colorScheme.primary);
      expect(explicit.colorScheme.surface, none.colorScheme.surface);
      expect(explicit.colorScheme.secondary, none.colorScheme.secondary);
    });
  });

  group('buildUxnanTheme — user-picked accent (dynamic ColorScheme)', () {
    test('a non-default accent produces a non-brand primary in light mode', () {
      final theme = buildUxnanTheme(
        brightness: Brightness.light,
        accent: AccentPalette.purple,
      );
      // The whole scheme is generated from the seed, so primary is the
      // purple-derived role — it must NOT be the brand blue anymore.
      expect(theme.colorScheme.primary, isNot(UxnanColors.lightPrimary));
      expect(theme.brightness, Brightness.light);
    });

    test('a non-default accent produces a non-brand primary in dark mode', () {
      final theme = buildUxnanTheme(accent: AccentPalette.teal);
      expect(theme.colorScheme.primary, isNot(UxnanColors.primary));
      expect(theme.brightness, Brightness.dark);
    });

    test('every non-default swatch is distinct from the brand primary', () {
      // No matter which swatch the user picks, the primary is no longer
      // the brand blue — a misconfiguration (or a future palette change
      // that introduces a brand-blue seed) must always change the look.
      for (final accent in AccentPalette.all) {
        if (accent.id == AccentPalette.defaultAccent.id) continue;
        final light = buildUxnanTheme(
          brightness: Brightness.light,
          accent: accent,
        );
        final dark = buildUxnanTheme(accent: accent);
        expect(
          light.colorScheme.primary,
          isNot(UxnanColors.lightPrimary),
          reason: 'accent ${accent.id} should change light primary',
        );
        expect(
          dark.colorScheme.primary,
          isNot(UxnanColors.primary),
          reason: 'accent ${accent.id} should change dark primary',
        );
      }
    });

    test('light and dark schemes share a seed but differ in brightness', () {
      final light = buildUxnanTheme(
        brightness: Brightness.light,
        accent: AccentPalette.pink,
      );
      final dark = buildUxnanTheme(accent: AccentPalette.pink);
      // Brightness is propagated.
      expect(light.colorScheme.brightness, Brightness.light);
      expect(dark.colorScheme.brightness, Brightness.dark);
      // The surface tones must differ between light and dark — guards
      // against an accidental shortcut that builds a single scheme and
      // returns it for both.
      expect(light.colorScheme.surface, isNot(dark.colorScheme.surface));
      expect(light.colorScheme.onSurface, isNot(dark.colorScheme.onSurface));
    });

    test('two calls with the same accent produce identical themes', () {
      final a = buildUxnanTheme(accent: AccentPalette.green);
      final b = buildUxnanTheme(accent: AccentPalette.green);
      expect(a.colorScheme.primary, b.colorScheme.primary);
      expect(a.colorScheme.surface, b.colorScheme.surface);
      expect(a.colorScheme.secondary, b.colorScheme.secondary);
      expect(a.colorScheme.tertiary, b.colorScheme.tertiary);
    });

    test('two different accents produce two different schemes', () {
      final a = buildUxnanTheme(accent: AccentPalette.orange);
      final b = buildUxnanTheme(accent: AccentPalette.purple);
      expect(a.colorScheme.primary, isNot(b.colorScheme.primary));
    });
  });
}
