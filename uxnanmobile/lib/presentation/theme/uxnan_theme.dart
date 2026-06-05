import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Builds the Material 3 [ThemeData] for Uxnan from the centralized design
/// tokens. Dark is the primary brightness; the same builder produces a light
/// variant when requested. See spec 02c section 3.1.
ThemeData buildUxnanTheme({Brightness brightness = Brightness.dark}) {
  final colorScheme = ColorScheme(
    brightness: brightness,
    primary: UxnanColors.primary,
    onPrimary: UxnanColors.onPrimary,
    primaryContainer: UxnanColors.primaryContainer,
    onPrimaryContainer: UxnanColors.onSurface,
    secondary: UxnanColors.secondary,
    onSecondary: UxnanColors.onSecondary,
    secondaryContainer: UxnanColors.secondaryContainer,
    onSecondaryContainer: UxnanColors.onSurface,
    error: UxnanColors.error,
    onError: Colors.white,
    surface: UxnanColors.surface,
    onSurface: UxnanColors.onSurface,
    surfaceContainerHighest: UxnanColors.surfaceVariant,
    surfaceContainerHigh: UxnanColors.surfaceElevated,
    outline: UxnanColors.outline,
    outlineVariant: UxnanColors.outline.withValues(alpha: 0.5),
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
    textTheme: _buildTextTheme(),
    fontFamily: UxnanTypography.fontFamily,
  );
}

TextTheme _buildTextTheme() {
  return const TextTheme(
    displayLarge: UxnanTypography.displayLarge,
    headlineMedium: UxnanTypography.headlineMedium,
    titleSmall: UxnanTypography.titleSmall,
    bodyMedium: UxnanTypography.bodyMedium,
    bodySmall: UxnanTypography.bodySmall,
  );
}
