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

  /// The title of a **group** — a folder heading the conversations inside it,
  /// a section heading a list.
  ///
  /// The rung between [headlineMedium] (a screen's own headline) and
  /// [titleSmall] (a single row). Without it a folder and the conversations it
  /// contains were drawn identically, and a screen made of rows had no
  /// hierarchy at all: everything was 14 or 12.
  ///
  /// Material's default for this slot is 16/w500; uxnan takes the weight up a
  /// step, because here it is doing real structural work.
  static const TextStyle titleMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 16,
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

  /// Floating-menu entries. A step above [bodyMedium]: a menu is a decision
  /// surface floating over everything else, so it earns more presence than the
  /// text it was opened from.
  static const TextStyle menuItem = TextStyle(
    fontFamily: fontFamily,
    fontSize: 15,
    fontWeight: FontWeight.w500,
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
