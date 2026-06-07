import 'package:flutter/material.dart';

/// Centralized typography tokens for the Uxnan design system.
///
/// Inter is used for UI text and JetBrains Mono for code. The font binaries are
/// bundled under `assets/fonts/` and declared in `pubspec.yaml`. See spec 02c
/// section 3.1.
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
    letterSpacing: -0.5,
  );

  /// Medium headline style.
  static const TextStyle headlineMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 20,
    fontWeight: FontWeight.w600,
  );

  /// Small title style.
  static const TextStyle titleSmall = TextStyle(
    fontFamily: fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w500,
  );

  /// Default body style.
  static const TextStyle bodyMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.5,
  );

  /// Small, muted body style.
  static const TextStyle bodySmall = TextStyle(
    fontFamily: fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.w400,
  );

  /// Monospaced body style for code blocks.
  static const TextStyle codeBody = TextStyle(
    fontFamily: monoFontFamily,
    fontSize: 13,
    fontWeight: FontWeight.w400,
    height: 1.6,
  );

  /// Small monospaced style for inline/secondary code.
  static const TextStyle codeSmall = TextStyle(
    fontFamily: monoFontFamily,
    fontSize: 11,
    fontWeight: FontWeight.w400,
  );
}
