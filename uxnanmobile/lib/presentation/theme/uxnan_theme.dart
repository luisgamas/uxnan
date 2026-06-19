import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Builds the Material 3 [ThemeData] for Uxnan.
///
/// The builder takes a [themeSource] (the source of the colors) and, when
/// the source is [ThemeSource.custom], the user's [customTheme]. The
/// [Brightness] is selected by the host — [MaterialApp.theme] and
/// [MaterialApp.darkTheme] each pass their own brightness, so a single
/// theme rebuilds both modes.
///
/// Sources (see `architecture/02c-implementation-guide.md` §3.1 for the
/// rationale):
///
/// - [ThemeSource.brand]: the hand-tuned brand palette. The user has not
///   personalized anything; the visual baseline is identical to a fresh
///   install. This is the default — the personalization screen flips to
///   [ThemeSource.custom] only when the user authors a custom theme.
/// - [ThemeSource.custom]: a [CustomTheme] the user authored (or imported
///   from JSON). The whole [ColorScheme] for the chosen brightness comes
///   from the user's theme; nothing is derived from a seed. The editor
///   surfaces a *"Derive from seed"* affordance to repopulate a brightness
///   from a single seed, but the persisted theme stays user-controlled.
enum ThemeSource {
  /// The hand-tuned brand palette (default for first-run / unpersonalized).
  brand,

  /// A user-authored [CustomTheme] (light/dark both overridden).
  custom,
}

/// Builds the Material 3 [ThemeData] for [brightness] from [themeSource]
/// (and, when source is [ThemeSource.custom], [customTheme]).
///
/// When [customTheme] is null while [themeSource] is [ThemeSource.custom],
/// the builder silently falls back to [ThemeSource.brand] — the only way
/// to reach that state is to clear the custom theme while the source is
/// still set, which the UI never does, but it keeps the theme recoverable.
ThemeData buildUxnanTheme({
  required Brightness brightness,
  required ThemeSource themeSource,
  CustomTheme? customTheme,
}) {
  final ColorScheme colorScheme;
  if (themeSource == ThemeSource.custom && customTheme != null) {
    colorScheme = brightness == Brightness.dark
        ? customTheme.darkColorScheme
        : customTheme.colorScheme;
  } else {
    colorScheme = _buildBrandColorScheme(brightness);
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

/// The hand-tuned brand palette ([ThemeSource.brand]). Identical to a fresh
/// install — no visual regression for users that never personalize.
ColorScheme _buildBrandColorScheme(Brightness brightness) {
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
