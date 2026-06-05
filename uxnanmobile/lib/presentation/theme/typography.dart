import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/colors.dart';

/// Centralized typography tokens for the Uxnan design system.
///
/// Inter is used for UI text and JetBrains Mono for code. Until the font
/// binaries are bundled, Flutter falls back to the platform default for these
/// family names. See spec 02c section 3.1.
///
/// FOR-HUMAN: add the Inter and JetBrains Mono `.ttf` files under
/// `assets/fonts/` and uncomment the `fonts:` block in `pubspec.yaml`. Full
/// instructions and the exact file list are in `uxnanmobile/FOR-HUMAN.md`.
class UxnanTypography {
  const UxnanTypography._();

  /// Font family used for UI text.
  static const String fontFamily = 'Inter';

  /// Font family used for code and monospaced content.
  static const String monoFontFamily = 'JetBrainsMono';

  /// Large display style.
  static const TextStyle displayLarge = TextStyle(
    fontFamily: fontFamily,
    fontSize: 32,
    fontWeight: FontWeight.w700,
    color: UxnanColors.onSurface,
    letterSpacing: -0.5,
  );

  /// Medium headline style.
  static const TextStyle headlineMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 20,
    fontWeight: FontWeight.w600,
    color: UxnanColors.onSurface,
  );

  /// Small title style.
  static const TextStyle titleSmall = TextStyle(
    fontFamily: fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w500,
    color: UxnanColors.onSurface,
  );

  /// Default body style.
  static const TextStyle bodyMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: UxnanColors.onSurface,
    height: 1.5,
  );

  /// Small, muted body style.
  static const TextStyle bodySmall = TextStyle(
    fontFamily: fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.w400,
    color: UxnanColors.onSurfaceMuted,
  );

  /// Monospaced body style for code blocks.
  static const TextStyle codeBody = TextStyle(
    fontFamily: monoFontFamily,
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: UxnanColors.onSurface,
    height: 1.6,
  );

  /// Small monospaced style for inline/secondary code.
  static const TextStyle codeSmall = TextStyle(
    fontFamily: monoFontFamily,
    fontSize: 11,
    fontWeight: FontWeight.w400,
    color: UxnanColors.onSurfaceMuted,
  );
}
