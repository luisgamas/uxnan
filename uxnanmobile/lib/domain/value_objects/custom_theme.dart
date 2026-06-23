import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

/// A user-authored Material 3 theme. A theme authors **at least one**
/// brightness side ([Brightness.light] and/or [Brightness.dark]); when the
/// opposite side is needed for rendering it is derived from the authored side's
/// key colors via Material 3's multi-seed generator ([_deriveSide]). A theme
/// with both sides authored is **dual** ([isDual]); with one, **single**
/// ([isSingle]). Each authored side is a flat map of M3 role → ARGB color
/// ([CustomThemeColors]), so the editor and the JSON import/export round-trip
/// every public role.
///
/// Storage shape: a JSON document with the stable shape described in [toJson]
/// — a single theme serializes only its authored side, a dual theme both. A
/// theme's [id] is opaque to storage (only [AppearancePreferencesStore] keys
/// the document by id); the editor may rename by writing a new id on save.
///
/// Versioning: the [schemaVersion] field guards the on-disk shape. v2 added
/// single-brightness themes; v1 documents always carried both sides and load
/// as dual. Bump it on any breaking change to [toJson] / [fromJson].
@immutable
class CustomTheme extends Equatable {
  /// Creates a **dual** theme from a single light [colorScheme]; the dark side
  /// is generated from its key colors (primary/secondary/tertiary/error) via
  /// Material 3's multi-seed generator. Built-in themes / templates use this so
  /// they need only specify the light side — there is no second hand-maintained
  /// dark palette.
  CustomTheme({
    required this.id,
    required this.name,
    required ColorScheme colorScheme,
    this.description = '',
    this.schemaVersion = currentSchemaVersion,
  })  : _lightColors = CustomThemeColors.fromScheme(colorScheme),
        _darkColors = CustomThemeColors.fromScheme(
          _seededScheme(
            brightness: Brightness.dark,
            primary: colorScheme.primary,
            secondary: colorScheme.secondary,
            tertiary: colorScheme.tertiary,
            error: colorScheme.error,
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

  /// Parses a [CustomTheme] from an imported / stored JSON document.
  ///
  /// Tolerant of the three shapes the importer must accept (see
  /// [_extractSchemeMaps]): the Uxnan native `{light, dark}` document, a
  /// Material Theme Builder export (`{schemes: {light, dark, ...}}`), and a
  /// single flat role map whose brightness is auto-detected. A document that
  /// describes only **one** brightness loads as a **single**-brightness theme;
  /// the missing side is derived on demand (never persisted). A document with
  /// both sides loads as **dual**.
  ///
  /// Throws [FormatException] when no color scheme can be recognized — the
  /// caller surfaces the failure instead of silently materializing the M3
  /// purple baseline.
  factory CustomTheme.fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String? ?? CustomTheme.freshId();
    final name = json['name'] as String? ?? 'Custom theme';
    final description = json['description'] as String? ?? '';
    final version = (json['version'] as num?)?.toInt() ?? currentSchemaVersion;

    final maps = _extractSchemeMaps(json);
    final light = maps.light == null
        ? null
        : CustomThemeColors.fromJson(maps.light!, brightness: Brightness.light);
    final dark = maps.dark == null
        ? null
        : CustomThemeColors.fromJson(maps.dark!, brightness: Brightness.dark);

    if (light == null && dark == null) {
      throw const FormatException(
        'Theme JSON has no recognizable color scheme (expected "light"/"dark" '
        'keys, a "schemes" block, or a flat role map)',
      );
    }
    // Keep the document's cardinality: a one-sided document stays single.
    return CustomTheme._raw(
      id: id,
      name: name,
      description: description,
      schemaVersion: version,
      light: light,
      dark: dark,
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

  /// Creates a **dual** theme from two independent authored [ColorScheme]s (one
  /// per brightness). The editor uses this so a light tweak never disturbs
  /// dark.
  CustomTheme.fromDualSchemes({
    required this.id,
    required this.name,
    required ColorScheme light,
    required ColorScheme dark,
    this.description = '',
    this.schemaVersion = currentSchemaVersion,
  })  : _lightColors = CustomThemeColors.fromScheme(light),
        _darkColors = CustomThemeColors.fromScheme(dark);

  /// Creates a **single**-brightness theme: only [brightness] is authored; the
  /// opposite side is derived on demand (and is never persisted or exported).
  CustomTheme.single({
    required this.id,
    required this.name,
    required ColorScheme scheme,
    required Brightness brightness,
    this.description = '',
    this.schemaVersion = currentSchemaVersion,
  })  : _lightColors = brightness == Brightness.light
            ? CustomThemeColors.fromScheme(scheme)
            : null,
        _darkColors = brightness == Brightness.dark
            ? CustomThemeColors.fromScheme(scheme)
            : null;

  /// Raw constructor over the two authored-side maps. At least one must be
  /// non-null; the codecs and copy-with helpers build through this so they can
  /// preserve single-vs-dual cardinality.
  const CustomTheme._raw({
    required this.id,
    required this.name,
    required this.description,
    required this.schemaVersion,
    required CustomThemeColors? light,
    required CustomThemeColors? dark,
  })  : assert(
          light != null || dark != null,
          'A CustomTheme must author at least one brightness side',
        ),
        _lightColors = light,
        _darkColors = dark;

  /// A fresh id (UUID v4). The editor uses this for a brand-new theme; the
  /// storage layer keeps whatever id was on disk.
  static String freshId() => const Uuid().v4();

  /// The current on-disk schema version. Bump on breaking changes to
  /// [toJson] / [fromJson]. v2 introduced single-brightness themes (a document
  /// may carry only `light` or only `dark`); v1 documents always carried both
  /// and load as dual.
  static const int currentSchemaVersion = 2;

  /// Stable id (UUID v4 or stable name). Treated as opaque by storage; the
  /// editor is free to rename a theme by writing a new id on save.
  final String id;

  /// Human-readable display name (the personalization screen shows this).
  final String name;

  /// Optional, longer description (e.g. for the JSON header).
  final String description;

  /// On-disk schema version. See [currentSchemaVersion].
  final int schemaVersion;

  /// The authored sides. At least one is non-null. A null side is **derived on
  /// demand** from the authored side's key colors (it is never persisted).
  final CustomThemeColors? _lightColors;
  final CustomThemeColors? _darkColors;

  /// The brightness sides the user actually authored (never empty).
  Set<Brightness> get authoredBrightnesses => {
        if (_lightColors != null) Brightness.light,
        if (_darkColors != null) Brightness.dark,
      };

  /// Whether both brightness sides are authored.
  bool get isDual => _lightColors != null && _darkColors != null;

  /// Whether only one brightness side is authored.
  bool get isSingle => !isDual;

  /// The single authored [Brightness]. Only valid when [isSingle].
  Brightness get brightness {
    assert(isSingle, 'brightness is only defined for single-brightness themes');
    return _lightColors != null ? Brightness.light : Brightness.dark;
  }

  /// The flat role map for the light side — the authored one, or, for a
  /// single-dark theme, the side derived from the dark key colors.
  CustomThemeColors get lightColors =>
      _lightColors ?? _deriveSide(Brightness.light);

  /// The flat role map for the dark side — the authored one, or, for a
  /// single-light theme, the side derived from the light key colors.
  CustomThemeColors get darkColors =>
      _darkColors ?? _deriveSide(Brightness.dark);

  /// The light [ColorScheme] (authored or derived).
  ColorScheme get colorScheme => lightColors.toColorScheme(Brightness.light);

  /// The dark [ColorScheme] (authored or derived).
  ColorScheme get darkColorScheme => darkColors.toColorScheme(Brightness.dark);

  /// Derives the missing [target] side from the authored side's KEY colors
  /// (primary/secondary/tertiary/error) via Material 3's multi-seed generator.
  /// Multi-seed — not a single `fromSeed` — preserves the distinct
  /// secondary/tertiary/error hues the user chose instead of collapsing them
  /// onto one tonal palette.
  CustomThemeColors _deriveSide(Brightness target) {
    final source = _lightColors ?? _darkColors!;
    return CustomThemeColors.fromScheme(
      _seededScheme(
        brightness: target,
        primary: source.primary,
        secondary: source.secondary,
        tertiary: source.tertiary,
        error: source.error,
      ),
    );
  }

  /// Builds a [brightness] [ColorScheme] from four key colors via Material 3's
  /// tonal generator, preserving each color's own hue.
  ///
  /// Flutter's `ColorScheme.fromSeed` derives the whole scheme from a *single*
  /// seed, which would collapse the user's distinct secondary/tertiary/error
  /// hues onto the primary's tonal palette. Instead we seed each key color on
  /// its own and splice the generated primary roles into the matching
  /// secondary/tertiary/error slots — so blue/brown/green chosen for light
  /// become the tone-correct blue/brown/green for dark (and vice versa).
  static ColorScheme _seededScheme({
    required Brightness brightness,
    required Color primary,
    required Color secondary,
    required Color tertiary,
    required Color error,
  }) {
    ColorScheme seed(Color c) =>
        ColorScheme.fromSeed(seedColor: c, brightness: brightness);
    final p = seed(primary);
    final s = seed(secondary);
    final t = seed(tertiary);
    final e = seed(error);
    return p.copyWith(
      secondary: s.primary,
      onSecondary: s.onPrimary,
      secondaryContainer: s.primaryContainer,
      onSecondaryContainer: s.onPrimaryContainer,
      secondaryFixed: s.primaryFixed,
      secondaryFixedDim: s.primaryFixedDim,
      onSecondaryFixed: s.onPrimaryFixed,
      onSecondaryFixedVariant: s.onPrimaryFixedVariant,
      tertiary: t.primary,
      onTertiary: t.onPrimary,
      tertiaryContainer: t.primaryContainer,
      onTertiaryContainer: t.onPrimaryContainer,
      tertiaryFixed: t.primaryFixed,
      tertiaryFixedDim: t.primaryFixedDim,
      onTertiaryFixed: t.onPrimaryFixed,
      onTertiaryFixedVariant: t.onPrimaryFixedVariant,
      error: e.primary,
      onError: e.onPrimary,
      errorContainer: e.primaryContainer,
      onErrorContainer: e.onPrimaryContainer,
    );
  }

  /// Copy-with that PRESERVES cardinality: passing only the authored side keeps
  /// the theme single; passing the opposite side promotes it to dual.
  CustomTheme _copyWith({
    CustomThemeColors? light,
    CustomThemeColors? dark,
    String? name,
    String? description,
  }) {
    return CustomTheme._raw(
      id: id,
      name: name ?? this.name,
      description: description ?? this.description,
      schemaVersion: schemaVersion,
      light: light ?? _lightColors,
      dark: dark ?? _darkColors,
    );
  }

  /// Returns a copy with the light side set. Promotes a single-dark theme to
  /// dual (an explicit edit of the other side = the user wants it authored).
  CustomTheme withLightColors(CustomThemeColors next) => _copyWith(light: next);

  /// Returns a copy with the dark side set. Promotes a single-light theme to
  /// dual.
  CustomTheme withDarkColors(CustomThemeColors next) => _copyWith(dark: next);

  /// Returns a copy with [name]/[description] updated; cardinality preserved.
  CustomTheme withMetadata({String? name, String? description}) =>
      _copyWith(name: name, description: description);

  /// Returns a copy under a fresh [newId]; cardinality preserved. Used when an
  /// import would otherwise clash with an existing library id.
  CustomTheme withId(String newId) => CustomTheme._raw(
        id: newId,
        name: name,
        description: description,
        schemaVersion: schemaVersion,
        light: _lightColors,
        dark: _darkColors,
      );

  /// Materializes the currently-derived opposite side as an authored side,
  /// turning a single-brightness theme into a dual one. No-op when already
  /// dual. Used by the editor's *"Add the other side"* affordance.
  CustomTheme withOtherSideDerived() {
    if (isDual) return this;
    return CustomTheme._raw(
      id: id,
      name: name,
      description: description,
      schemaVersion: schemaVersion,
      light: lightColors,
      dark: darkColors,
    );
  }

  /// The JSON wire shape. Stable across versions; guarded by [schemaVersion].
  /// Only **authored** sides are serialized: a single-brightness theme emits
  /// just its side, a dual theme emits both. The derived side is never written.
  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'name': name,
      if (description.isNotEmpty) 'description': description,
      'version': schemaVersion,
      if (_lightColors != null) 'light': _lightColors.toJson(),
      if (_darkColors != null) 'dark': _darkColors.toJson(),
    };
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
