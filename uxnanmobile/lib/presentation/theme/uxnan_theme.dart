import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Builds the Material 3 [ThemeData] for Uxnan from the centralized design
/// tokens. The same builder produces brightness-specific variants so the app
/// can follow the system theme while preserving the brand palette.
ThemeData buildUxnanTheme({Brightness brightness = Brightness.dark}) {
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
  final colorScheme = ColorScheme(
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
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
    ),
    textTheme: _buildTextTheme(colorScheme),
    fontFamily: UxnanTypography.fontFamily,
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
