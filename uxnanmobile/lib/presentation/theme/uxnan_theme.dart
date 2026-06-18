import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/accent_color.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Builds the Material 3 [ThemeData] for Uxnan from the centralized design
/// tokens.
///
/// The builder takes an optional user-picked [accent] (a seed color). When
/// the accent is the brand default ([AccentPalette.defaultAccent]) the
/// hand-tuned palette in [UxnanColors] is used for every role, so the
/// visual baseline is identical to a user that never opens the
/// personalization screen. When the accent is **any other** swatch, the
/// whole [ColorScheme] is derived from `ColorScheme.fromSeed(seedColor:
/// accent, brightness: …)` for both light and dark — the Material 3 HCT
/// generator guarantees every role (primary, secondary, tertiary, surface
/// containers, outline, error, …) stays harmonious, addressing the visual
/// incoherence a first cut that only overrode `primary` had (see
/// `FOR-DEV.md`).
///
/// The same builder is called for light and dark via [MaterialApp.theme] and
/// [MaterialApp.darkTheme], so passing the accent through both is enough to
/// switch the entire app.
ThemeData buildUxnanTheme({
  Brightness brightness = Brightness.dark,
  AccentColorId? accent,
}) {
  final isDefaultAccent = accent == null ||
      accent.id == AccentPalette.defaultAccent.id ||
      accent.seed == AccentPalette.defaultAccent.seed;

  final ColorScheme colorScheme;
  if (isDefaultAccent) {
    colorScheme = _buildHandTunedColorScheme(brightness);
  } else {
    colorScheme = _buildDynamicColorScheme(accent.seed, brightness);
  }

  return ThemeData(
    useMaterial3: true,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: colorScheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: colorScheme.surface,
      foregroundColor: colorScheme.onSurface,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      color: colorScheme.surfaceContainerHighest,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colorScheme.surfaceContainerHigh,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
    ),
    // Neural Expressive floating menus: rounded, on the same neutral surface as
    // the Icon Surfaces, never the narrow squared-off default.
    popupMenuTheme: PopupMenuThemeData(
      color: colorScheme.surfaceContainerHigh,
      elevation: 3,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
    ),
    textTheme: _buildTextTheme(colorScheme),
    fontFamily: UxnanTypography.fontFamily,
  );
}

/// Hand-tuned brand palette (the default accent). Uses the static tokens in
/// [UxnanColors] so the visual baseline is exactly what shipped before the
/// accent picker landed — no regression for users that never personalize.
ColorScheme _buildHandTunedColorScheme(Brightness brightness) {
  final surface = UxnanColors.surfaceFor(brightness);
  final surfaceVariant = UxnanColors.surfaceVariantFor(brightness);
  final surfaceElevated = UxnanColors.surfaceElevatedFor(brightness);
  final primary = UxnanColors.primaryFor(brightness);
  final primaryContainer = UxnanColors.primaryContainerFor(brightness);
  final secondary = UxnanColors.secondaryFor(brightness);
  final secondaryContainer = UxnanColors.secondaryContainerFor(brightness);
  final error = UxnanColors.errorFor(brightness);
  final onSurface = UxnanColors.onSurfaceFor(brightness);
  final onSurfaceVariant = UxnanColors.onSurfaceMutedFor(brightness);
  final outline = UxnanColors.outlineFor(brightness);
  return ColorScheme(
    brightness: brightness,
    primary: primary,
    onPrimary: brightness == Brightness.dark
        ? UxnanColors.onPrimary
        : UxnanColors.lightOnPrimary,
    primaryContainer: primaryContainer,
    onPrimaryContainer: onSurface,
    secondary: secondary,
    onSecondary: brightness == Brightness.dark
        ? UxnanColors.onSecondary
        : UxnanColors.lightOnSecondary,
    secondaryContainer: secondaryContainer,
    onSecondaryContainer: onSurface,
    error: error,
    onError: Colors.white,
    surface: surface,
    onSurface: onSurface,
    onSurfaceVariant: onSurfaceVariant,
    surfaceContainerHighest: surfaceVariant,
    surfaceContainerHigh: surfaceElevated,
    outline: outline,
    outlineVariant:
        outline.withValues(alpha: brightness == Brightness.dark ? 0.5 : 0.35),
  );
}

/// Dynamic palette derived from a user-picked accent. Delegates to Flutter's
/// `ColorScheme.fromSeed`, which fills every M3 role from the seed via the
/// HCT color space — guaranteeing light/dark coherence for any accent.
ColorScheme _buildDynamicColorScheme(Color seed, Brightness brightness) {
  return ColorScheme.fromSeed(
    seedColor: seed,
    brightness: brightness,
  );
}

TextTheme _buildTextTheme(ColorScheme colorScheme) {
  return TextTheme(
    displayLarge:
        UxnanTypography.displayLarge.copyWith(color: colorScheme.onSurface),
    headlineMedium:
        UxnanTypography.headlineMedium.copyWith(color: colorScheme.onSurface),
    titleSmall:
        UxnanTypography.titleSmall.copyWith(color: colorScheme.onSurface),
    bodyMedium:
        UxnanTypography.bodyMedium.copyWith(color: colorScheme.onSurface),
    bodySmall:
        UxnanTypography.bodySmall.copyWith(color: colorScheme.onSurfaceVariant),
  );
}
