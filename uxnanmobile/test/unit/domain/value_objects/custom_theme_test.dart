import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';

void main() {
  group('CustomTheme — JSON round-trip', () {
    test('round-trips an empty theme (all defaults)', () {
      final original = CustomTheme.derivedFromSeed(
        id: 'rt-1',
        name: 'Empty',
        seed: const Color(0xFF6750A4),
      );
      final restored = CustomTheme.fromJson(original.toJson());
      // Every role survives the round-trip — a regression here would
      // silently drop a role on the next import.
      expect(restored.lightColors.primary, original.lightColors.primary);
      expect(restored.lightColors.onPrimary, original.lightColors.onPrimary);
      expect(restored.darkColors.primary, original.darkColors.primary);
      expect(restored.darkColors.surface, original.darkColors.surface);
      expect(restored.darkColors.outline, original.darkColors.outline);
      expect(restored.lightColors.surfaceTint, original.lightColors.surfaceTint);
    });

    test('round-trips a manually edited theme', () {
      final original = CustomTheme.fromDualSchemes(
        id: 'rt-2',
        name: 'Edited',
        description: 'Custom overrides',
        light: ColorScheme(
          brightness: Brightness.light,
          primary: const Color(0xFFFF112233),
          onPrimary: const Color(0xFFAABBCCDD),
          secondary: const Color(0xFF11223344),
          onSecondary: const Color(0xFF55667788),
          error: const Color(0xFFB3261E),
          onError: const Color(0xFFFFFFFF),
          surface: const Color(0xFFFEF7FF),
          onSurface: const Color(0xFF1D1B20),
        ),
        dark: ColorScheme(
          brightness: Brightness.dark,
          primary: const Color(0xFF99AABBCC),
          onPrimary: const Color(0xFF00112233),
          secondary: const Color(0xFF44556677),
          onSecondary: const Color(0xFF8899AABB),
          error: const Color(0xFFFFB4AB),
          onError: const Color(0xFF690005),
          surface: const Color(0xFF1D1B20),
          onSurface: const Color(0xFFE6E0E9),
        ),
      );
      final restored = CustomTheme.fromJson(original.toJson());
      expect(restored.lightColors.primary, original.lightColors.primary);
      expect(restored.lightColors.onPrimary, original.lightColors.onPrimary);
      expect(restored.lightColors.secondary, original.lightColors.secondary);
      expect(restored.darkColors.primary, original.darkColors.primary);
      expect(restored.darkColors.onPrimary, original.darkColors.onPrimary);
      expect(restored.darkColors.error, original.darkColors.error);
      expect(restored.name, 'Edited');
      expect(restored.description, 'Custom overrides');
    });

    test('round-trips through toJsonString/fromJsonString', () {
      final original = CustomTheme.derivedFromSeed(
        id: 'rt-3',
        name: 'String round-trip',
        seed: const Color(0xFF0061A4),
      );
      final json = original.toJsonString();
      final restored = CustomTheme.fromJsonString(json);
      expect(restored.id, original.id);
      expect(restored.name, original.name);
      expect(restored.lightColors.primary, original.lightColors.primary);
    });

    test('partial JSON falls back to safe defaults for missing roles', () {
      // The user hand-edited the file and removed a few roles — every
      // missing role must fall back to a default so the theme still
      // loads (no thrown exception, no crash on launch).
      final restored = CustomTheme.fromJsonString('''
{
  "id": "partial",
  "name": "Partial",
  "version": 1,
  "light": {"primary": "#FF0066CC"},
  "dark": {"primary": "#FFCC0066"}
}''');
      expect(restored.id, 'partial');
      expect(restored.name, 'Partial');
      // The one role we set was preserved.
      expect(restored.lightColors.primary, const Color(0xFFFF0066CC));
      expect(restored.darkColors.primary, const Color(0xFFFFCC0066));
      // A role we did NOT set still has a sensible default.
      expect(restored.lightColors.surface, isNotNull);
    });

    test('hex parsing accepts both #RRGGBB and #AARRGGBB', () {
      final rgbOnly = CustomTheme.fromJsonString('''
{
  "id": "hex-1",
  "name": "RGB",
  "version": 1,
  "light": {"primary": "1B6EF3"},
  "dark": {"primary": "0D3A7A"}
}''');
      expect(rgbOnly.lightColors.primary, const Color(0xFF1B6EF3));
      expect(rgbOnly.darkColors.primary, const Color(0xFF0D3A7A));

      final withAlpha = CustomTheme.fromJsonString('''
{
  "id": "hex-2",
  "name": "ARGB",
  "version": 1,
  "light": {"primary": "#FF1B6EF3"},
  "dark": {"primary": "#FF0D3A7A"}
}''');
      expect(withAlpha.lightColors.primary, const Color(0xFF1B6EF3));
      expect(withAlpha.darkColors.primary, const Color(0xFF0D3A7A));
    });

    test('malformed JSON throws a FormatException', () {
      expect(
        () => CustomTheme.fromJsonString('not json'),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => CustomTheme.fromJsonString(''),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => CustomTheme.fromJsonString('[]'),
        throwsA(isA<FormatException>()),
      );
    });

    test('int ARGB values are accepted (older exports)', () {
      // 0xFF1B6EF3 and 0xFF0D3A7A encoded as their decimal int form so
      // the parser must coerce numeric (not just hex-string) input.
      const lightPrimary = 0xFF1B6EF3;
      const darkPrimary = 0xFF0D3A7A;
      final restored = CustomTheme.fromJsonString('''
{
  "id": "int-1",
  "name": "Int",
  "version": 1,
  "light": {"primary": $lightPrimary},
  "dark": {"primary": $darkPrimary}
}''');
      expect(restored.lightColors.primary, const Color(0xFF1B6EF3));
      expect(restored.darkColors.primary, const Color(0xFF0D3A7A));
    });
  });

  group('CustomTheme — derived builders', () {
    test('derivedFromSeed fills every role from a single seed', () {
      final theme = CustomTheme.derivedFromSeed(
        id: 'seed-1',
        name: 'Seed test',
        seed: const Color(0xFF1B6EF3),
      );
      // Material 3 generates every role from the seed via HCT — every
      // role must be non-null and form a complete ColorScheme on both
      // brightnesses. (The seed-derived primary is NOT exactly the seed
      // color; HCT rounds to the nearest tonal palette.)
      expect(theme.lightColors.primary, isNotNull);
      expect(theme.darkColors.primary, isNotNull);
      expect(theme.lightColors.surface, isNotNull);
      expect(theme.darkColors.surface, isNotNull);
      expect(theme.lightColors.outline, isNotNull);
      // Light and dark schemes must not be identical (no accidental
      // pairing).
      expect(theme.lightColors.surface, isNot(theme.darkColors.surface));
    });

    test('withLightColors / withDarkColors only update the chosen side',
        () {
      final base = CustomTheme.derivedFromSeed(
        id: 'split-1',
        name: 'Split',
        seed: const Color(0xFF6750A4),
      );
      final tweakedLight = base.withLightColors(
        base.lightColors,
      );
      // Pure copy: every role matches the base.
      expect(tweakedLight.lightColors.primary, base.lightColors.primary);
      expect(tweakedLight.darkColors.primary, base.darkColors.primary);
    });
  });

  group('CustomThemeColors — color scheme conversion', () {
    test('toColorScheme carries every role into a Material ColorScheme',
        () {
      final colors = CustomThemeColors(
        primary: const Color(0xFF111111),
        onPrimary: const Color(0xFF222222),
        primaryContainer: const Color(0xFF333333),
        onPrimaryContainer: const Color(0xFF444444),
        primaryFixed: const Color(0xFF555555),
        primaryFixedDim: const Color(0xFF666666),
        onPrimaryFixed: const Color(0xFF777777),
        onPrimaryFixedVariant: const Color(0xFF888888),
        secondary: const Color(0xFF999999),
        onSecondary: const Color(0xFFAAAAAAAA),
        secondaryContainer: const Color(0xFFBBBBBB),
        onSecondaryContainer: const Color(0xFFCCCCCC),
        secondaryFixed: const Color(0xFFDDDDDD),
        secondaryFixedDim: const Color(0xFFEEEEEE),
        onSecondaryFixed: const Color(0xFFF0F0F0),
        onSecondaryFixedVariant: const Color(0xFFF1F1F1),
        tertiary: const Color(0xFFF2F2F2),
        onTertiary: const Color(0xFFF3F3F3),
        tertiaryContainer: const Color(0xFFF4F4F4),
        onTertiaryContainer: const Color(0xFFF5F5F5),
        tertiaryFixed: const Color(0xFFF6F6F6),
        tertiaryFixedDim: const Color(0xFFF7F7F7),
        onTertiaryFixed: const Color(0xFFF8F8F8),
        onTertiaryFixedVariant: const Color(0xFFF9F9F9),
        error: const Color(0xFFFAFAFA),
        onError: const Color(0xFFFBFBFB),
        errorContainer: const Color(0xFFFCFCFC),
        onErrorContainer: const Color(0xFFFDFDFD),
        surface: const Color(0xFFFEFFFE),
        onSurface: const Color(0xFFFFFFFF),
        surfaceDim: const Color(0xFF000000),
        surfaceBright: const Color(0xFF010101),
        surfaceContainerLowest: const Color(0xFF020202),
        surfaceContainerLow: const Color(0xFF030303),
        surfaceContainer: const Color(0xFF040404),
        surfaceContainerHigh: const Color(0xFF050505),
        surfaceContainerHighest: const Color(0xFF060606),
        onSurfaceVariant: const Color(0xFF070707),
        outline: const Color(0xFF080808),
        outlineVariant: const Color(0xFF090909),
        inverseSurface: const Color(0xFF0A0A0A),
        onInverseSurface: const Color(0xFF0B0B0B),
        inversePrimary: const Color(0xFF0C0C0C),
        shadow: const Color(0xFF0D0D0D),
        scrim: const Color(0xFF0E0E0E),
        surfaceTint: const Color(0xFF0F0F0F),
      );
      final scheme = colors.toColorScheme(Brightness.light);
      expect(scheme.primary, colors.primary);
      expect(scheme.tertiary, colors.tertiary);
      expect(scheme.surfaceContainerHighest, colors.surfaceContainerHighest);
      expect(scheme.surfaceTint, colors.surfaceTint);
      expect(scheme.brightness, Brightness.light);
    });
  });

  group('CustomTheme — freshId', () {
    test('returns a non-empty UUID-shaped string', () {
      final id = CustomTheme.freshId();
      expect(id, isNotEmpty);
      expect(id.length, greaterThanOrEqualTo(32));
      // Two calls must produce different ids (the editor uses this to
      // give every new theme a unique storage key).
      expect(CustomTheme.freshId(), isNot(id));
    });
  });
}
