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

  // ── Display: one hero per screen, never two ─────────────────────────────
  // 32 down to 24, all w700. M3's reference display sizes (57/45/36) are for
  // an editorial page; a phone app that used them would have a greeting taller
  // than the card under it. This ladder is deliberately compressed.

  /// The single headline a screen is allowed — the home greeting.
  static const TextStyle displayLarge = TextStyle(
    fontFamily: fontFamily,
    fontSize: 32,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.5,
  );

  /// A hero on a surface that is not a whole screen (a full-width empty state,
  /// an onboarding page).
  static const TextStyle displayMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 28,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.5,
  );

  /// The quietest hero: a number or short phrase that carries a whole card.
  static const TextStyle displaySmall = TextStyle(
    fontFamily: fontFamily,
    fontSize: 24,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.25,
  );

  // ── Headline: what a screen or a major region is about ──────────────────

  /// The top of a screen that has no display hero.
  static const TextStyle headlineLarge = TextStyle(
    fontFamily: fontFamily,
    fontSize: 22,
    fontWeight: FontWeight.w600,
  );

  /// A screen's own title; the quiet half of a two-line greeting.
  static const TextStyle headlineMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 20,
    fontWeight: FontWeight.w600,
  );

  /// A major region inside a screen — a settings group, a sheet's title.
  static const TextStyle headlineSmall = TextStyle(
    fontFamily: fontFamily,
    fontSize: 18,
    fontWeight: FontWeight.w600,
  );

  // ── Title: the name of a thing you can act on ───────────────────────────
  //
  // Headline says what a REGION is about; title names an OBJECT — a card, a
  // folder, a row. [titleLarge] and [headlineSmall] share metrics on purpose:
  // they sit at the same level of the page and differ in role, not in size.

  /// A card or panel that owns its area of the screen.
  static const TextStyle titleLarge = TextStyle(
    fontFamily: fontFamily,
    fontSize: 18,
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

  /// Long-form reading: the body of an agent's answer.
  static const TextStyle bodyLarge = TextStyle(
    fontFamily: fontFamily,
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.5,
  );

  // ── Label: text that lives ON a control, not in the page ────────────────
  //
  // A label is read as part of the thing it is printed on, so it is a step
  // heavier than body at the same size — that weight is what stops a button's
  // text from looking like a sentence that happens to sit inside a shape.

  /// Button and pill text.
  static const TextStyle labelLarge = TextStyle(
    fontFamily: fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w500,
  );

  /// Chips, badges, tabs.
  static const TextStyle labelMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.w500,
  );

  /// The smallest legible label: an overline, a counter on a glyph.
  static const TextStyle labelSmall = TextStyle(
    fontFamily: fontFamily,
    fontSize: 11,
    fontWeight: FontWeight.w500,
  );

  /// A top bar's title.
  ///
  /// Its own style, not a rung of the scale. Six screens used to spell it as
  /// `titleLarge.copyWith(fontSize: 20)` — which worked only because
  /// `titleLarge` was undefined and resolved to Material's regular weight.
  /// Completing the scale would have emboldened all six at once, so the bar
  /// keeps the size and weight it was reviewed at, in one place.
  static const TextStyle barTitle = TextStyle(
    fontFamily: fontFamily,
    fontSize: 20,
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
