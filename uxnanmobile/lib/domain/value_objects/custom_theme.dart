import 'dart:convert';
import 'dart:ui' show Color;

import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

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
    final light =
        ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.light);
    final dark =
        ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark);
    return CustomTheme.fromDualSchemes(
      id: id,
      name: name,
      description: description,
      light: light,
      dark: dark,
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

  /// Parses a [CustomTheme] from an imported / stored JSON document.
  ///
  /// Tolerant of the three shapes the importer must accept (see
  /// [_extractSchemeMaps]): the Uxnan native `{light, dark}` document, a
  /// Material Theme Builder export (`{schemes: {light, dark, ...}}`), and a
  /// single flat role map whose brightness is auto-detected. A document that
  /// describes only one brightness is paired off the present side's `primary`
  /// so the result is always a complete light+dark theme.
  ///
  /// Throws [FormatException] when no color scheme can be recognized — the
  /// caller surfaces the failure instead of silently materializing the M3
  /// purple baseline.
  factory CustomTheme.fromJson(Map<String, dynamic> json) {
    final String id = json['id'] as String? ?? CustomTheme.freshId();
    final String name = json['name'] as String? ?? 'Custom theme';
    final String description = json['description'] as String? ?? '';
    final int version =
        (json['version'] as num?)?.toInt() ?? currentSchemaVersion;

    final maps = _extractSchemeMaps(json);
    var light = maps.light == null
        ? null
        : CustomThemeColors.fromJson(maps.light!, brightness: Brightness.light);
    var dark = maps.dark == null
        ? null
        : CustomThemeColors.fromJson(maps.dark!, brightness: Brightness.dark);

    if (light == null && dark == null) {
      throw const FormatException(
        'Theme JSON has no recognizable color scheme (expected "light"/"dark" '
        'keys, a "schemes" block, or a flat role map)',
      );
    }
    // Pair an absent side off the present side's primary so a single-scheme
    // import still yields a complete, coherent light+dark theme.
    light ??= CustomThemeColors.fromScheme(
      ColorScheme.fromSeed(seedColor: dark!.primary),
    );
    dark ??= CustomThemeColors.fromScheme(
      ColorScheme.fromSeed(
        seedColor: light.primary,
        brightness: Brightness.dark,
      ),
    );

    return CustomTheme.fromDualSchemes(
      id: id,
      name: name,
      description: description,
      schemaVersion: version,
      light: light.toColorScheme(Brightness.light),
      dark: dark.toColorScheme(Brightness.dark),
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

  /// Parses an imported document into its constituent sides **without**
  /// forcing a complete light+dark pair. Either [CustomThemeImport.light] or
  /// [CustomThemeImport.dark] is null when the source only described one
  /// brightness — the editor uses this to patch just the imported side and
  /// leave the other untouched (and to flip its visible tab to match).
  ///
  /// Accepts the same shapes as [CustomTheme.fromJson] (native, Material Theme
  /// Builder, flat single scheme). Throws [FormatException] for empty /
  /// non-object / scheme-less input.
  static CustomThemeImport parseImport(String source) {
    final trimmed = source.trim();
    if (trimmed.isEmpty) {
      throw const FormatException('Empty theme JSON');
    }
    final decoded = jsonDecode(trimmed);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Theme JSON must be an object');
    }
    final maps = _extractSchemeMaps(decoded);
    final light = maps.light == null
        ? null
        : CustomThemeColors.fromJson(maps.light!, brightness: Brightness.light);
    final dark = maps.dark == null
        ? null
        : CustomThemeColors.fromJson(maps.dark!, brightness: Brightness.dark);
    if (light == null && dark == null) {
      throw const FormatException(
        'Theme JSON has no recognizable color scheme',
      );
    }
    return CustomThemeImport(
      id: decoded['id'] as String?,
      name: decoded['name'] as String?,
      description: decoded['description'] as String?,
      light: light,
      dark: dark,
    );
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

  /// Parses a [CustomThemeColors] from a single-scheme JSON role map for
  /// [brightness]. Unknown role keys are ignored.
  ///
  /// Roles that are **absent** (a partial or hand-edited document, or a tool
  /// that only emits the headline roles) fall back to a Material 3 scheme
  /// **seed-derived from the document's own `primary`** (or an explicit
  /// `seed`) for the same [brightness] — never a fixed light-mode palette.
  /// This is what keeps a partial *dark* import dark instead of bleeding the
  /// old purple defaults into half the roles.
  factory CustomThemeColors.fromJson(
    Map<String, dynamic> json, {
    required Brightness brightness,
  }) {
    final tryRead = _colorReader(json);

    // Anchor the per-role fallback on the document's own primary (or an
    // explicit `seed`) so missing roles stay coherent with what the user did
    // provide; only when neither is present do we drop to the M3 baseline.
    final seed =
        tryRead('primary') ?? tryRead('seed') ?? const Color(0xFF6750A4);
    final fallback = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: brightness,
    );
    Color read(String key, Color fb) => tryRead(key) ?? fb;

    return CustomThemeColors(
      primary: read('primary', fallback.primary),
      onPrimary: read('onPrimary', fallback.onPrimary),
      primaryContainer: read('primaryContainer', fallback.primaryContainer),
      onPrimaryContainer:
          read('onPrimaryContainer', fallback.onPrimaryContainer),
      primaryFixed: read('primaryFixed', fallback.primaryFixed),
      primaryFixedDim: read('primaryFixedDim', fallback.primaryFixedDim),
      onPrimaryFixed: read('onPrimaryFixed', fallback.onPrimaryFixed),
      onPrimaryFixedVariant:
          read('onPrimaryFixedVariant', fallback.onPrimaryFixedVariant),
      secondary: read('secondary', fallback.secondary),
      onSecondary: read('onSecondary', fallback.onSecondary),
      secondaryContainer:
          read('secondaryContainer', fallback.secondaryContainer),
      onSecondaryContainer:
          read('onSecondaryContainer', fallback.onSecondaryContainer),
      secondaryFixed: read('secondaryFixed', fallback.secondaryFixed),
      secondaryFixedDim: read('secondaryFixedDim', fallback.secondaryFixedDim),
      onSecondaryFixed: read('onSecondaryFixed', fallback.onSecondaryFixed),
      onSecondaryFixedVariant:
          read('onSecondaryFixedVariant', fallback.onSecondaryFixedVariant),
      tertiary: read('tertiary', fallback.tertiary),
      onTertiary: read('onTertiary', fallback.onTertiary),
      tertiaryContainer: read('tertiaryContainer', fallback.tertiaryContainer),
      onTertiaryContainer:
          read('onTertiaryContainer', fallback.onTertiaryContainer),
      tertiaryFixed: read('tertiaryFixed', fallback.tertiaryFixed),
      tertiaryFixedDim: read('tertiaryFixedDim', fallback.tertiaryFixedDim),
      onTertiaryFixed: read('onTertiaryFixed', fallback.onTertiaryFixed),
      onTertiaryFixedVariant:
          read('onTertiaryFixedVariant', fallback.onTertiaryFixedVariant),
      error: read('error', fallback.error),
      onError: read('onError', fallback.onError),
      errorContainer: read('errorContainer', fallback.errorContainer),
      onErrorContainer: read('onErrorContainer', fallback.onErrorContainer),
      surface: read('surface', fallback.surface),
      onSurface: read('onSurface', fallback.onSurface),
      surfaceDim: read('surfaceDim', fallback.surfaceDim),
      surfaceBright: read('surfaceBright', fallback.surfaceBright),
      surfaceContainerLowest:
          read('surfaceContainerLowest', fallback.surfaceContainerLowest),
      surfaceContainerLow:
          read('surfaceContainerLow', fallback.surfaceContainerLow),
      surfaceContainer: read('surfaceContainer', fallback.surfaceContainer),
      surfaceContainerHigh:
          read('surfaceContainerHigh', fallback.surfaceContainerHigh),
      surfaceContainerHighest:
          read('surfaceContainerHighest', fallback.surfaceContainerHighest),
      onSurfaceVariant: read('onSurfaceVariant', fallback.onSurfaceVariant),
      outline: read('outline', fallback.outline),
      outlineVariant: read('outlineVariant', fallback.outlineVariant),
      inverseSurface: read('inverseSurface', fallback.inverseSurface),
      onInverseSurface: read('onInverseSurface', fallback.onInverseSurface),
      inversePrimary: read('inversePrimary', fallback.inversePrimary),
      shadow: read('shadow', fallback.shadow),
      scrim: read('scrim', fallback.scrim),
      surfaceTint: read('surfaceTint', fallback.surfaceTint),
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

/// The result of [CustomTheme.parseImport]: the light and/or dark sides found
/// in an imported document, plus any metadata. A null side means the source
/// did not describe that brightness, letting the editor patch only what
/// changed instead of overwriting both modes.
@immutable
class CustomThemeImport {
  /// Creates a [CustomThemeImport].
  const CustomThemeImport({
    this.id,
    this.name,
    this.description,
    this.light,
    this.dark,
  });

  /// The id declared in the document, if any.
  final String? id;

  /// The display name declared in the document, if any.
  final String? name;

  /// The description declared in the document, if any.
  final String? description;

  /// The parsed light scheme, or null when the source had no light side.
  final CustomThemeColors? light;

  /// The parsed dark scheme, or null when the source had no dark side.
  final CustomThemeColors? dark;

  /// Whether a light scheme was found.
  bool get hasLight => light != null;

  /// Whether a dark scheme was found.
  bool get hasDark => dark != null;

  /// Whether both sides were present (a full theme, not a single palette).
  bool get isComplete => hasLight && hasDark;
}

/// The light/dark role maps pulled out of an arbitrary imported document.
/// Either side may be null when the document only described one brightness.
typedef _SchemeMaps = ({
  Map<String, dynamic>? light,
  Map<String, dynamic>? dark,
});

/// Casts [value] to a `Map<String, dynamic>` when it is a map, else null.
Map<String, dynamic>? _asStringMap(Object? value) =>
    value is Map ? value.cast<String, dynamic>() : null;

/// Pulls the light + dark role maps out of [json], accepting the shapes the
/// importer must understand:
///
/// 1. **Uxnan native** — `{"light": {...}, "dark": {...}}`.
/// 2. **Material Theme Builder** — `{"schemes": {"light": {...}, "dark": {...},
///    "light-medium-contrast": {...}, ...}}`. The base `light`/`dark` schemes
///    are used; the contrast variants are ignored.
/// 3. **A single flat scheme** — role keys (e.g. `primary`, `surface`) at the
///    top level. Its brightness is detected (see [_detectBrightness]) and it
///    is returned as that side only.
///
/// Returns `(null, null)` when nothing scheme-shaped is found.
_SchemeMaps _extractSchemeMaps(Map<String, dynamic> json) {
  // (2) Material Theme Builder nests the schemes under "schemes".
  final schemes = _asStringMap(json['schemes']);
  if (schemes != null) {
    final light =
        _asStringMap(schemes['light']) ?? _baseScheme(schemes, 'light');
    final dark = _asStringMap(schemes['dark']) ?? _baseScheme(schemes, 'dark');
    if (light != null || dark != null) return (light: light, dark: dark);
  }

  // (1) Native top-level light/dark.
  final light = _asStringMap(json['light']);
  final dark = _asStringMap(json['dark']);
  if (light != null || dark != null) return (light: light, dark: dark);

  // (3) A single flat scheme — detect its brightness and return it as that
  // side only so the caller decides how to merge / pair it.
  if (_looksLikeScheme(json)) {
    return _detectBrightness(json) == Brightness.dark
        ? (light: null, dark: json)
        : (light: json, dark: null);
  }

  return (light: null, dark: null);
}

/// Finds the base scheme in a Material Theme Builder `schemes` block whose key
/// names the [target] brightness (`light` / `dark`) while skipping the
/// contrast variants (`*-medium-contrast`, `*-high-contrast`).
Map<String, dynamic>? _baseScheme(Map<String, dynamic> schemes, String target) {
  for (final entry in schemes.entries) {
    final key = entry.key.toLowerCase();
    if (key.contains(target) && !key.contains('contrast')) {
      final map = _asStringMap(entry.value);
      if (map != null) return map;
    }
  }
  return null;
}

/// Whether [json] looks like a flat color-role map (rather than a wrapper
/// document) — true when it carries at least one well-known M3 role key.
bool _looksLikeScheme(Map<String, dynamic> json) {
  const markers = [
    'primary',
    'surface',
    'secondary',
    'background',
    'onSurface',
  ];
  return markers.any(json.containsKey);
}

/// Detects the [Brightness] of a single flat scheme: an explicit `brightness`
/// field wins; otherwise the surface (or, failing that, the on-surface text)
/// luminance decides. Defaults to [Brightness.light] when nothing is legible.
Brightness _detectBrightness(Map<String, dynamic> scheme) {
  final explicit = scheme['brightness'];
  if (explicit is String) {
    final value = explicit.toLowerCase();
    if (value.contains('dark')) return Brightness.dark;
    if (value.contains('light')) return Brightness.light;
  }
  final surface = _tryParseColor(scheme['surface']) ??
      _tryParseColor(scheme['background']) ??
      _tryParseColor(scheme['surfaceContainer']);
  if (surface != null) {
    return surface.computeLuminance() < 0.5
        ? Brightness.dark
        : Brightness.light;
  }
  // Only the text color is known: light text implies a dark scheme.
  final onSurface = _tryParseColor(scheme['onSurface']) ??
      _tryParseColor(scheme['onBackground']);
  if (onSurface != null) {
    return onSurface.computeLuminance() < 0.5
        ? Brightness.light
        : Brightness.dark;
  }
  return Brightness.light;
}

/// Returns a reader closure that resolves a role key in [json] to a [Color]
/// (hex string or int ARGB), or null when the key is absent / unparseable.
Color? Function(String key) _colorReader(Map<String, dynamic> json) =>
    (key) => _tryParseColor(json[key]);

/// Parses a hex string or int ARGB value to a [Color], or null when the value
/// is absent / unparseable.
Color? _tryParseColor(Object? value) {
  if (value is String) {
    try {
      return _parseHex(value);
    } on Object {
      return null;
    }
  }
  if (value is int) return Color(value | 0xFF000000);
  return null;
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
