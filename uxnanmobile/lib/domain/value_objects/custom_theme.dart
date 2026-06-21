import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/infrastructure/storage/appearance_preferences_store.dart'
    show AppearancePreferencesStore;

/// A user-authored Material 3 [ColorScheme] for both [Brightness.light] and
/// [Brightness.dark]. The whole theme is a flat map of M3 role → ARGB color;
/// the editor (and the JSON import/export) round-trips every public role on
/// [ColorScheme] so a custom theme can override any single tone without
/// touching the rest.
///
/// Storage shape: a JSON document with the stable shape described in
/// [toJson]. A theme's [id] is opaque to the storage layer (only
/// [AppearancePreferencesStore] keys the document by id); the editor is
/// free to rename a theme by writing a new id on save.
///
/// Versioning: the [schemaVersion] field guards the on-disk shape so a future
/// reader can refuse (or migrate) an older document. Bump it on any
/// breaking change to [toJson] / [fromJson].
@immutable
class CustomTheme extends Equatable {
  /// Creates a [CustomTheme]. The [colorScheme] and [darkColorScheme] are
  /// the source of truth — [lightColors] / [darkColors] are derived from
  /// them at construction time.
  CustomTheme({
    required this.id,
    required this.name,
    required this.colorScheme,
    this.description = '',
    this.schemaVersion = currentSchemaVersion,
  })  : _darkColorScheme = null,
        _lightColors = CustomThemeColors.fromScheme(colorScheme),
        _darkColors = CustomThemeColors.fromScheme(
          ColorScheme(
            brightness: Brightness.dark,
            primary: colorScheme.primary,
            onPrimary: colorScheme.onPrimary,
            primaryContainer: colorScheme.primaryContainer,
            onPrimaryContainer: colorScheme.onPrimaryContainer,
            primaryFixed: colorScheme.primaryFixed,
            primaryFixedDim: colorScheme.primaryFixedDim,
            onPrimaryFixed: colorScheme.onPrimaryFixed,
            onPrimaryFixedVariant: colorScheme.onPrimaryFixedVariant,
            secondary: colorScheme.secondary,
            onSecondary: colorScheme.onSecondary,
            secondaryContainer: colorScheme.secondaryContainer,
            onSecondaryContainer: colorScheme.onSecondaryContainer,
            secondaryFixed: colorScheme.secondaryFixed,
            secondaryFixedDim: colorScheme.secondaryFixedDim,
            onSecondaryFixed: colorScheme.onSecondaryFixed,
            onSecondaryFixedVariant: colorScheme.onSecondaryFixedVariant,
            tertiary: colorScheme.tertiary,
            onTertiary: colorScheme.onTertiary,
            tertiaryContainer: colorScheme.tertiaryContainer,
            onTertiaryContainer: colorScheme.onTertiaryContainer,
            tertiaryFixed: colorScheme.tertiaryFixed,
            tertiaryFixedDim: colorScheme.tertiaryFixedDim,
            onTertiaryFixed: colorScheme.onTertiaryFixed,
            onTertiaryFixedVariant: colorScheme.onTertiaryFixedVariant,
            error: colorScheme.error,
            onError: colorScheme.onError,
            errorContainer: colorScheme.errorContainer,
            onErrorContainer: colorScheme.onErrorContainer,
            surface: colorScheme.surface,
            onSurface: colorScheme.onSurface,
            surfaceDim: colorScheme.surfaceDim,
            surfaceBright: colorScheme.surfaceBright,
            surfaceContainerLowest: colorScheme.surfaceContainerLowest,
            surfaceContainerLow: colorScheme.surfaceContainerLow,
            surfaceContainer: colorScheme.surfaceContainer,
            surfaceContainerHigh: colorScheme.surfaceContainerHigh,
            surfaceContainerHighest: colorScheme.surfaceContainerHighest,
            onSurfaceVariant: colorScheme.onSurfaceVariant,
            outline: colorScheme.outline,
            outlineVariant: colorScheme.outlineVariant,
            inverseSurface: colorScheme.inverseSurface,
            onInverseSurface: colorScheme.onInverseSurface,
            inversePrimary: colorScheme.inversePrimary,
            shadow: colorScheme.shadow,
            scrim: colorScheme.scrim,
            surfaceTint: colorScheme.surfaceTint,
          ),
        );

  /// A copy of this theme that delegates to a fresh
  /// `ColorScheme.fromSeed` for both brightnesses — used by the editor's
  /// *"Derive from seed"* affordance to reset one brightness from a single
  /// seed color.
  factory CustomTheme.derivedFromSeed({
    required String id,
    required String name,
    required Color seed,
    String description = '',
  }) {
    final light = ColorScheme.fromSeed(seedColor: seed);
    final dark = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.dark,
    );
    return CustomTheme.fromDualSchemes(
      id: id,
      name: name,
      description: description,
      light: light,
      dark: dark,
    );
  }

  /// Parses a [CustomTheme] from its JSON wire shape. Unknown role keys
  /// are ignored; missing roles fall back to the theme's seed-derived
  /// scheme so an older document (or a hand-edited one) still loads.
  factory CustomTheme.fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String? ?? CustomTheme.freshId();
    final name = json['name'] as String? ?? 'Custom theme';
    final description = json['description'] as String? ?? '';
    final version = (json['version'] as num?)?.toInt() ?? currentSchemaVersion;
    final lightJson =
        (json['light'] as Map?)?.cast<String, dynamic>() ?? const {};
    final darkJson =
        (json['dark'] as Map?)?.cast<String, dynamic>() ?? const {};
    final lightColors = CustomThemeColors.fromJson(lightJson);
    final darkColors = CustomThemeColors.fromJson(darkJson);
    return CustomTheme.fromDualSchemes(
      id: id,
      name: name,
      description: description,
      schemaVersion: version,
      light: lightColors.toColorScheme(Brightness.light),
      dark: darkColors.toColorScheme(Brightness.dark),
    );
  }

  /// Parses a [CustomTheme] from a JSON string. Throws [FormatException]
  /// for malformed input (the editor surfaces the message).
  factory CustomTheme.fromJsonString(String source) {
    final trimmed = source.trim();
    if (trimmed.isEmpty) {
      throw const FormatException('Empty theme JSON');
    }
    final decoded = jsonDecode(trimmed);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Theme JSON must be an object');
    }
    return CustomTheme.fromJson(decoded);
  }

  /// Creates a [CustomTheme] from two independent [ColorScheme]s (one per
  /// brightness). The editor uses this path so a light tweak never disturbs
  /// dark (and vice versa).
  CustomTheme.fromDualSchemes({
    required this.id,
    required this.name,
    required ColorScheme light,
    required ColorScheme dark,
    this.description = '',
    this.schemaVersion = currentSchemaVersion,
  })  : colorScheme = light,
        _darkColorScheme = dark,
        _lightColors = CustomThemeColors.fromScheme(light),
        _darkColors = CustomThemeColors.fromScheme(dark);

  /// A fresh id (UUID v4). The editor uses this for a brand-new theme; the
  /// storage layer keeps whatever id was on disk.
  static String freshId() => const Uuid().v4();

  /// The current on-disk schema version. Bump on breaking changes to
  /// [toJson] / [fromJson].
  static const int currentSchemaVersion = 1;

  /// Stable id (UUID v4 or stable name). Treated as opaque by storage; the
  /// editor is free to rename a theme by writing a new id on save.
  final String id;

  /// Human-readable display name (the personalization screen shows this).
  final String name;

  /// Optional, longer description (e.g. for the JSON header).
  final String description;

  /// On-disk schema version. See [currentSchemaVersion].
  final int schemaVersion;

  /// The light [ColorScheme] for this theme.
  final ColorScheme colorScheme;

  final ColorScheme? _darkColorScheme;
  final CustomThemeColors _lightColors;
  final CustomThemeColors _darkColors;

  /// The dark [ColorScheme] for this theme. Always returns a real scheme
  /// (when constructed without an explicit dark scheme, the dark scheme is
  /// derived from the light one so light/dark stay paired).
  ColorScheme get darkColorScheme =>
      _darkColorScheme ??
      ColorScheme(
        brightness: Brightness.dark,
        primary: colorScheme.primary,
        onPrimary: colorScheme.onPrimary,
        primaryContainer: colorScheme.primaryContainer,
        onPrimaryContainer: colorScheme.onPrimaryContainer,
        primaryFixed: colorScheme.primaryFixed,
        primaryFixedDim: colorScheme.primaryFixedDim,
        onPrimaryFixed: colorScheme.onPrimaryFixed,
        onPrimaryFixedVariant: colorScheme.onPrimaryFixedVariant,
        secondary: colorScheme.secondary,
        onSecondary: colorScheme.onSecondary,
        secondaryContainer: colorScheme.secondaryContainer,
        onSecondaryContainer: colorScheme.onSecondaryContainer,
        secondaryFixed: colorScheme.secondaryFixed,
        secondaryFixedDim: colorScheme.secondaryFixedDim,
        onSecondaryFixed: colorScheme.onSecondaryFixed,
        onSecondaryFixedVariant: colorScheme.onSecondaryFixedVariant,
        tertiary: colorScheme.tertiary,
        onTertiary: colorScheme.onTertiary,
        tertiaryContainer: colorScheme.tertiaryContainer,
        onTertiaryContainer: colorScheme.onTertiaryContainer,
        tertiaryFixed: colorScheme.tertiaryFixed,
        tertiaryFixedDim: colorScheme.tertiaryFixedDim,
        onTertiaryFixed: colorScheme.onTertiaryFixed,
        onTertiaryFixedVariant: colorScheme.onTertiaryFixedVariant,
        error: colorScheme.error,
        onError: colorScheme.onError,
        errorContainer: colorScheme.errorContainer,
        onErrorContainer: colorScheme.onErrorContainer,
        surface: colorScheme.surface,
        onSurface: colorScheme.onSurface,
        surfaceDim: colorScheme.surfaceDim,
        surfaceBright: colorScheme.surfaceBright,
        surfaceContainerLowest: colorScheme.surfaceContainerLowest,
        surfaceContainerLow: colorScheme.surfaceContainerLow,
        surfaceContainer: colorScheme.surfaceContainer,
        surfaceContainerHigh: colorScheme.surfaceContainerHigh,
        surfaceContainerHighest: colorScheme.surfaceContainerHighest,
        onSurfaceVariant: colorScheme.onSurfaceVariant,
        outline: colorScheme.outline,
        outlineVariant: colorScheme.outlineVariant,
        inverseSurface: colorScheme.inverseSurface,
        onInverseSurface: colorScheme.onInverseSurface,
        inversePrimary: colorScheme.inversePrimary,
        shadow: colorScheme.shadow,
        scrim: colorScheme.scrim,
        surfaceTint: colorScheme.surfaceTint,
      );

  /// The flat role map for the light scheme.
  CustomThemeColors get lightColors => _lightColors;

  /// The flat role map for the dark scheme.
  CustomThemeColors get darkColors => _darkColors;

  /// Returns a copy of this theme with [lightColors] updated.
  CustomTheme withLightColors(CustomThemeColors next) {
    return CustomTheme.fromDualSchemes(
      id: id,
      name: name,
      description: description,
      schemaVersion: schemaVersion,
      light: next.toColorScheme(Brightness.light),
      dark: darkColorScheme,
    );
  }

  /// Returns a copy of this theme with [darkColors] updated.
  CustomTheme withDarkColors(CustomThemeColors next) {
    return CustomTheme.fromDualSchemes(
      id: id,
      name: name,
      description: description,
      schemaVersion: schemaVersion,
      light: colorScheme,
      dark: next.toColorScheme(Brightness.dark),
    );
  }

  /// Returns a copy of this theme with [name] and/or [description] updated.
  CustomTheme withMetadata({String? name, String? description}) {
    return CustomTheme.fromDualSchemes(
      id: id,
      name: name ?? this.name,
      description: description ?? this.description,
      schemaVersion: schemaVersion,
      light: colorScheme,
      dark: darkColorScheme,
    );
  }

  /// The JSON wire shape. Stable across versions; guarded by [schemaVersion].
  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'name': name,
      if (description.isNotEmpty) 'description': description,
      'version': schemaVersion,
      'light': _lightColors.toJson(),
      'dark': _darkColors.toJson(),
    };
  }

  /// Serializes this theme to its pretty-printed JSON string.
  String toJsonString() => const JsonEncoder.withIndent('  ').convert(toJson());

  @override
  List<Object?> get props => [
        id,
        name,
        description,
        schemaVersion,
        _lightColors,
        _darkColors,
      ];
}

/// Flat role map for a single [ColorScheme]. Used by the editor (one list
/// of roles per brightness) and by [CustomTheme]'s JSON codec.
///
/// Every public role on [ColorScheme] is exposed — the editor lets the user
/// override any of them; missing roles in imported JSON fall back to the
/// seed-derived scheme.
@immutable
class CustomThemeColors extends Equatable {
  /// Creates a [CustomThemeColors] from a full role map. Roles not supplied
  /// fall back to safe defaults (full black/white); callers should prefer
  /// [CustomThemeColors.fromScheme] to keep light/dark paired.
  const CustomThemeColors({
    required this.primary,
    required this.onPrimary,
    required this.primaryContainer,
    required this.onPrimaryContainer,
    required this.primaryFixed,
    required this.primaryFixedDim,
    required this.onPrimaryFixed,
    required this.onPrimaryFixedVariant,
    required this.secondary,
    required this.onSecondary,
    required this.secondaryContainer,
    required this.onSecondaryContainer,
    required this.secondaryFixed,
    required this.secondaryFixedDim,
    required this.onSecondaryFixed,
    required this.onSecondaryFixedVariant,
    required this.tertiary,
    required this.onTertiary,
    required this.tertiaryContainer,
    required this.onTertiaryContainer,
    required this.tertiaryFixed,
    required this.tertiaryFixedDim,
    required this.onTertiaryFixed,
    required this.onTertiaryFixedVariant,
    required this.error,
    required this.onError,
    required this.errorContainer,
    required this.onErrorContainer,
    required this.surface,
    required this.onSurface,
    required this.surfaceDim,
    required this.surfaceBright,
    required this.surfaceContainerLowest,
    required this.surfaceContainerLow,
    required this.surfaceContainer,
    required this.surfaceContainerHigh,
    required this.surfaceContainerHighest,
    required this.onSurfaceVariant,
    required this.outline,
    required this.outlineVariant,
    required this.inverseSurface,
    required this.onInverseSurface,
    required this.inversePrimary,
    required this.shadow,
    required this.scrim,
    required this.surfaceTint,
  });

  /// Extracts every public role from [scheme].
  factory CustomThemeColors.fromScheme(ColorScheme scheme) {
    return CustomThemeColors(
      primary: scheme.primary,
      onPrimary: scheme.onPrimary,
      primaryContainer: scheme.primaryContainer,
      onPrimaryContainer: scheme.onPrimaryContainer,
      primaryFixed: scheme.primaryFixed,
      primaryFixedDim: scheme.primaryFixedDim,
      onPrimaryFixed: scheme.onPrimaryFixed,
      onPrimaryFixedVariant: scheme.onPrimaryFixedVariant,
      secondary: scheme.secondary,
      onSecondary: scheme.onSecondary,
      secondaryContainer: scheme.secondaryContainer,
      onSecondaryContainer: scheme.onSecondaryContainer,
      secondaryFixed: scheme.secondaryFixed,
      secondaryFixedDim: scheme.secondaryFixedDim,
      onSecondaryFixed: scheme.onSecondaryFixed,
      onSecondaryFixedVariant: scheme.onSecondaryFixedVariant,
      tertiary: scheme.tertiary,
      onTertiary: scheme.onTertiary,
      tertiaryContainer: scheme.tertiaryContainer,
      onTertiaryContainer: scheme.onTertiaryContainer,
      tertiaryFixed: scheme.tertiaryFixed,
      tertiaryFixedDim: scheme.tertiaryFixedDim,
      onTertiaryFixed: scheme.onTertiaryFixed,
      onTertiaryFixedVariant: scheme.onTertiaryFixedVariant,
      error: scheme.error,
      onError: scheme.onError,
      errorContainer: scheme.errorContainer,
      onErrorContainer: scheme.onErrorContainer,
      surface: scheme.surface,
      onSurface: scheme.onSurface,
      surfaceDim: scheme.surfaceDim,
      surfaceBright: scheme.surfaceBright,
      surfaceContainerLowest: scheme.surfaceContainerLowest,
      surfaceContainerLow: scheme.surfaceContainerLow,
      surfaceContainer: scheme.surfaceContainer,
      surfaceContainerHigh: scheme.surfaceContainerHigh,
      surfaceContainerHighest: scheme.surfaceContainerHighest,
      onSurfaceVariant: scheme.onSurfaceVariant,
      outline: scheme.outline,
      outlineVariant: scheme.outlineVariant,
      inverseSurface: scheme.inverseSurface,
      onInverseSurface: scheme.onInverseSurface,
      inversePrimary: scheme.inversePrimary,
      shadow: scheme.shadow,
      scrim: scheme.scrim,
      surfaceTint: scheme.surfaceTint,
    );
  }

  /// Parses a [CustomThemeColors] from JSON. Unknown role keys are ignored;
  /// missing roles fall back to safe defaults so a partial document still
  /// loads.
  factory CustomThemeColors.fromJson(Map<String, dynamic> json) {
    Color read(String key, Color fallback) {
      final value = json[key];
      if (value is String) {
        try {
          return _parseHex(value);
        } on Object {
          return fallback;
        }
      }
      if (value is int) return Color(value | 0xFF000000);
      return fallback;
    }

    return CustomThemeColors(
      primary: read('primary', const Color(0xFF6750A4)),
      onPrimary: read('onPrimary', const Color(0xFFFFFFFF)),
      primaryContainer: read('primaryContainer', const Color(0xFFEADDFF)),
      onPrimaryContainer: read('onPrimaryContainer', const Color(0xFF21005D)),
      primaryFixed: read('primaryFixed', const Color(0xFFEADDFF)),
      primaryFixedDim: read('primaryFixedDim', const Color(0xFFD0BCFF)),
      onPrimaryFixed: read('onPrimaryFixed', const Color(0xFF21005D)),
      onPrimaryFixedVariant:
          read('onPrimaryFixedVariant', const Color(0xFF4F378B)),
      secondary: read('secondary', const Color(0xFF625B71)),
      onSecondary: read('onSecondary', const Color(0xFFFFFFFF)),
      secondaryContainer: read('secondaryContainer', const Color(0xFFE8DEF8)),
      onSecondaryContainer:
          read('onSecondaryContainer', const Color(0xFF1D192B)),
      secondaryFixed: read('secondaryFixed', const Color(0xFFE8DEF8)),
      secondaryFixedDim: read('secondaryFixedDim', const Color(0xFFCCC2DC)),
      onSecondaryFixed: read('onSecondaryFixed', const Color(0xFF1D192B)),
      onSecondaryFixedVariant:
          read('onSecondaryFixedVariant', const Color(0xFF4A4458)),
      tertiary: read('tertiary', const Color(0xFF7D5260)),
      onTertiary: read('onTertiary', const Color(0xFFFFFFFF)),
      tertiaryContainer: read('tertiaryContainer', const Color(0xFFFFD8E4)),
      onTertiaryContainer: read('onTertiaryContainer', const Color(0xFF31111D)),
      tertiaryFixed: read('tertiaryFixed', const Color(0xFFFFD8E4)),
      tertiaryFixedDim: read('tertiaryFixedDim', const Color(0xFFEFB8C8)),
      onTertiaryFixed: read('onTertiaryFixed', const Color(0xFF31111D)),
      onTertiaryFixedVariant:
          read('onTertiaryFixedVariant', const Color(0xFF633B48)),
      error: read('error', const Color(0xFFB3261E)),
      onError: read('onError', const Color(0xFFFFFFFF)),
      errorContainer: read('errorContainer', const Color(0xFFF9DEDC)),
      onErrorContainer: read('onErrorContainer', const Color(0xFF410E0B)),
      surface: read('surface', const Color(0xFFFEF7FF)),
      onSurface: read('onSurface', const Color(0xFF1D1B20)),
      surfaceDim: read('surfaceDim', const Color(0xFFDED8E1)),
      surfaceBright: read('surfaceBright', const Color(0xFFFEF7FF)),
      surfaceContainerLowest:
          read('surfaceContainerLowest', const Color(0xFFFFFFFF)),
      surfaceContainerLow: read('surfaceContainerLow', const Color(0xFFF7F2FA)),
      surfaceContainer: read('surfaceContainer', const Color(0xFFF3EDF7)),
      surfaceContainerHigh:
          read('surfaceContainerHigh', const Color(0xFFECE6F0)),
      surfaceContainerHighest:
          read('surfaceContainerHighest', const Color(0xFFE6E0E9)),
      onSurfaceVariant: read('onSurfaceVariant', const Color(0xFF49454F)),
      outline: read('outline', const Color(0xFF79747E)),
      outlineVariant: read('outlineVariant', const Color(0xFFCAC4D0)),
      inverseSurface: read('inverseSurface', const Color(0xFF322F35)),
      onInverseSurface: read('onInverseSurface', const Color(0xFFF5EFF7)),
      inversePrimary: read('inversePrimary', const Color(0xFFD0BCFF)),
      shadow: read('shadow', const Color(0xFF000000)),
      scrim: read('scrim', const Color(0xFF000000)),
      surfaceTint: read('surfaceTint', const Color(0xFF6750A4)),
    );
  }

  final Color primary;
  final Color onPrimary;
  final Color primaryContainer;
  final Color onPrimaryContainer;
  final Color primaryFixed;
  final Color primaryFixedDim;
  final Color onPrimaryFixed;
  final Color onPrimaryFixedVariant;
  final Color secondary;
  final Color onSecondary;
  final Color secondaryContainer;
  final Color onSecondaryContainer;
  final Color secondaryFixed;
  final Color secondaryFixedDim;
  final Color onSecondaryFixed;
  final Color onSecondaryFixedVariant;
  final Color tertiary;
  final Color onTertiary;
  final Color tertiaryContainer;
  final Color onTertiaryContainer;
  final Color tertiaryFixed;
  final Color tertiaryFixedDim;
  final Color onTertiaryFixed;
  final Color onTertiaryFixedVariant;
  final Color error;
  final Color onError;
  final Color errorContainer;
  final Color onErrorContainer;
  final Color surface;
  final Color onSurface;
  final Color surfaceDim;
  final Color surfaceBright;
  final Color surfaceContainerLowest;
  final Color surfaceContainerLow;
  final Color surfaceContainer;
  final Color surfaceContainerHigh;
  final Color surfaceContainerHighest;
  final Color onSurfaceVariant;
  final Color outline;
  final Color outlineVariant;
  final Color inverseSurface;
  final Color onInverseSurface;
  final Color inversePrimary;
  final Color shadow;
  final Color scrim;
  final Color surfaceTint;

  /// Materializes a [ColorScheme] for [brightness].
  ColorScheme toColorScheme(Brightness brightness) {
    return ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: onPrimary,
      primaryContainer: primaryContainer,
      onPrimaryContainer: onPrimaryContainer,
      primaryFixed: primaryFixed,
      primaryFixedDim: primaryFixedDim,
      onPrimaryFixed: onPrimaryFixed,
      onPrimaryFixedVariant: onPrimaryFixedVariant,
      secondary: secondary,
      onSecondary: onSecondary,
      secondaryContainer: secondaryContainer,
      onSecondaryContainer: onSecondaryContainer,
      secondaryFixed: secondaryFixed,
      secondaryFixedDim: secondaryFixedDim,
      onSecondaryFixed: onSecondaryFixed,
      onSecondaryFixedVariant: onSecondaryFixedVariant,
      tertiary: tertiary,
      onTertiary: onTertiary,
      tertiaryContainer: tertiaryContainer,
      onTertiaryContainer: onTertiaryContainer,
      tertiaryFixed: tertiaryFixed,
      tertiaryFixedDim: tertiaryFixedDim,
      onTertiaryFixed: onTertiaryFixed,
      onTertiaryFixedVariant: onTertiaryFixedVariant,
      error: error,
      onError: onError,
      errorContainer: errorContainer,
      onErrorContainer: onErrorContainer,
      surface: surface,
      onSurface: onSurface,
      surfaceDim: surfaceDim,
      surfaceBright: surfaceBright,
      surfaceContainerLowest: surfaceContainerLowest,
      surfaceContainerLow: surfaceContainerLow,
      surfaceContainer: surfaceContainer,
      surfaceContainerHigh: surfaceContainerHigh,
      surfaceContainerHighest: surfaceContainerHighest,
      onSurfaceVariant: onSurfaceVariant,
      outline: outline,
      outlineVariant: outlineVariant,
      inverseSurface: inverseSurface,
      onInverseSurface: onInverseSurface,
      inversePrimary: inversePrimary,
      shadow: shadow,
      scrim: scrim,
      surfaceTint: surfaceTint,
    );
  }

  /// Serializes to the JSON role map.
  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'primary': _hex(primary),
      'onPrimary': _hex(onPrimary),
      'primaryContainer': _hex(primaryContainer),
      'onPrimaryContainer': _hex(onPrimaryContainer),
      'primaryFixed': _hex(primaryFixed),
      'primaryFixedDim': _hex(primaryFixedDim),
      'onPrimaryFixed': _hex(onPrimaryFixed),
      'onPrimaryFixedVariant': _hex(onPrimaryFixedVariant),
      'secondary': _hex(secondary),
      'onSecondary': _hex(onSecondary),
      'secondaryContainer': _hex(secondaryContainer),
      'onSecondaryContainer': _hex(onSecondaryContainer),
      'secondaryFixed': _hex(secondaryFixed),
      'secondaryFixedDim': _hex(secondaryFixedDim),
      'onSecondaryFixed': _hex(onSecondaryFixed),
      'onSecondaryFixedVariant': _hex(onSecondaryFixedVariant),
      'tertiary': _hex(tertiary),
      'onTertiary': _hex(onTertiary),
      'tertiaryContainer': _hex(tertiaryContainer),
      'onTertiaryContainer': _hex(onTertiaryContainer),
      'tertiaryFixed': _hex(tertiaryFixed),
      'tertiaryFixedDim': _hex(tertiaryFixedDim),
      'onTertiaryFixed': _hex(onTertiaryFixed),
      'onTertiaryFixedVariant': _hex(onTertiaryFixedVariant),
      'error': _hex(error),
      'onError': _hex(onError),
      'errorContainer': _hex(errorContainer),
      'onErrorContainer': _hex(onErrorContainer),
      'surface': _hex(surface),
      'onSurface': _hex(onSurface),
      'surfaceDim': _hex(surfaceDim),
      'surfaceBright': _hex(surfaceBright),
      'surfaceContainerLowest': _hex(surfaceContainerLowest),
      'surfaceContainerLow': _hex(surfaceContainerLow),
      'surfaceContainer': _hex(surfaceContainer),
      'surfaceContainerHigh': _hex(surfaceContainerHigh),
      'surfaceContainerHighest': _hex(surfaceContainerHighest),
      'onSurfaceVariant': _hex(onSurfaceVariant),
      'outline': _hex(outline),
      'outlineVariant': _hex(outlineVariant),
      'inverseSurface': _hex(inverseSurface),
      'onInverseSurface': _hex(onInverseSurface),
      'inversePrimary': _hex(inversePrimary),
      'shadow': _hex(shadow),
      'scrim': _hex(scrim),
      'surfaceTint': _hex(surfaceTint),
    };
  }

  @override
  List<Object?> get props => [
        primary,
        onPrimary,
        primaryContainer,
        onPrimaryContainer,
        primaryFixed,
        primaryFixedDim,
        onPrimaryFixed,
        onPrimaryFixedVariant,
        secondary,
        onSecondary,
        secondaryContainer,
        onSecondaryContainer,
        secondaryFixed,
        secondaryFixedDim,
        onSecondaryFixed,
        onSecondaryFixedVariant,
        tertiary,
        onTertiary,
        tertiaryContainer,
        onTertiaryContainer,
        tertiaryFixed,
        tertiaryFixedDim,
        onTertiaryFixed,
        onTertiaryFixedVariant,
        error,
        onError,
        errorContainer,
        onErrorContainer,
        surface,
        onSurface,
        surfaceDim,
        surfaceBright,
        surfaceContainerLowest,
        surfaceContainerLow,
        surfaceContainer,
        surfaceContainerHigh,
        surfaceContainerHighest,
        onSurfaceVariant,
        outline,
        outlineVariant,
        inverseSurface,
        onInverseSurface,
        inversePrimary,
        shadow,
        scrim,
        surfaceTint,
      ];
}

/// Parses a CSS-style `#RRGGBB` or `#AARRGGBB` hex string into a [Color].
Color _parseHex(String input) {
  var hex = input.trim();
  if (hex.startsWith('#')) hex = hex.substring(1);
  if (hex.length == 6) hex = 'FF$hex';
  if (hex.length != 8) {
    throw FormatException('Invalid hex color "$input"');
  }
  final value = int.tryParse(hex, radix: 16);
  if (value == null) {
    throw FormatException('Invalid hex color "$input"');
  }
  return Color(value);
}

/// Serializes a [Color] as an 8-char uppercase `#AARRGGBB` hex string.
/// Always includes the alpha channel so the round-trip is unambiguous across
/// Flutter versions (the deprecated `.value` getter is premultiplied for
/// partial alpha; this form is always the literal ARGB value).
String _hex(Color color) {
  final a = (color.a * 255.0).round() & 0xFF;
  final r = (color.r * 255.0).round() & 0xFF;
  final g = (color.g * 255.0).round() & 0xFF;
  final b = (color.b * 255.0).round() & 0xFF;
  return '#${a.toRadixString(16).padLeft(2, '0').toUpperCase()}'
      '${r.toRadixString(16).padLeft(2, '0').toUpperCase()}'
      '${g.toRadixString(16).padLeft(2, '0').toUpperCase()}'
      '${b.toRadixString(16).padLeft(2, '0').toUpperCase()}';
}
