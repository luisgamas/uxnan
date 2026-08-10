import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';

/// The app's type scale is a **compressed** one — a 32 sp hero, not M3's 57 —
/// and it only holds if every rung is actually set.
///
/// A `TextTheme` slot left null does not go unused: it falls back to Material's
/// own value, on Material's uncompressed scale. Ten of the fifteen were null
/// once, and the ~90 call sites reaching for them were quietly following that
/// other ladder — which is why the app's density jumped between screens
/// depending on which slots each one happened to use. These tests exist so that
/// cannot come back silently.
Future<void> main() async {
  TextTheme scaleOf(Brightness brightness) => buildUxnanTheme(
        brightness: brightness,
        themeSource: ThemeSource.brand,
      ).textTheme;

  /// Every rung, largest first. The order IS the assertion.
  List<(String, TextStyle?)> ladder(TextTheme t) => [
        ('displayLarge', t.displayLarge),
        ('displayMedium', t.displayMedium),
        ('displaySmall', t.displaySmall),
        ('headlineLarge', t.headlineLarge),
        ('headlineMedium', t.headlineMedium),
        ('headlineSmall', t.headlineSmall),
        ('titleLarge', t.titleLarge),
        ('titleMedium', t.titleMedium),
        ('titleSmall', t.titleSmall),
        ('bodyMedium', t.bodyMedium),
        ('bodySmall', t.bodySmall),
        ('labelSmall', t.labelSmall),
      ];

  test('every slot is defined, in both brightnesses', () {
    for (final brightness in Brightness.values) {
      final t = scaleOf(brightness);
      for (final (name, style) in ladder(t)) {
        expect(style, isNotNull, reason: '$name is null in $brightness');
        expect(
          style!.fontSize,
          isNotNull,
          reason: '$name has no size in $brightness',
        );
        expect(
          style.fontFamily,
          UxnanTypography.fontFamily,
          reason: '$name is not in the app font in $brightness',
        );
      }
      // The three not on the descending ladder still have to exist.
      for (final (name, style) in [
        ('bodyLarge', t.bodyLarge),
        ('labelLarge', t.labelLarge),
        ('labelMedium', t.labelMedium),
      ]) {
        expect(style?.fontSize, isNotNull, reason: '$name is unset');
      }
    }
  });

  test('it descends — no rung is larger than the one above it', () {
    final rungs = ladder(scaleOf(Brightness.dark));
    for (var i = 1; i < rungs.length; i++) {
      final (above, aboveStyle) = rungs[i - 1];
      final (below, belowStyle) = rungs[i];
      expect(
        belowStyle!.fontSize,
        lessThanOrEqualTo(aboveStyle!.fontSize!),
        reason: '$below (${belowStyle.fontSize}) outgrew '
            '$above (${aboveStyle.fontSize})',
      );
    }
  });

  test('it stays compressed — a phone app, not an editorial page', () {
    final t = scaleOf(Brightness.dark);
    // M3's reference displayLarge is 57. A greeting that size would be taller
    // than the card under it; if this ever passes 40, someone has pasted the
    // reference scale over the shipped one.
    expect(t.displayLarge!.fontSize, lessThanOrEqualTo(40));
    // And the floor: nothing may drop below the smallest legible label.
    for (final (name, style) in ladder(t)) {
      expect(style!.fontSize, greaterThanOrEqualTo(11), reason: name);
    }
  });

  test('a group outranks the rows inside it', () {
    final t = scaleOf(Brightness.dark);
    // A folder over its conversations, a section over its settings rows. When
    // these were equal, a screen made of rows had no hierarchy to read at all.
    expect(t.titleMedium!.fontSize, greaterThan(t.titleSmall!.fontSize!));
    expect(
      t.titleMedium!.fontWeight!.value,
      greaterThan(t.titleSmall!.fontWeight!.value),
    );
    // And a group's supporting line outranks a row's.
    expect(t.bodyMedium!.fontSize, greaterThan(t.bodySmall!.fontSize!));
  });

  test('the bar title is pinned, not borrowed from the scale', () {
    // Six screens used to spell the bar's style as
    // `titleLarge.copyWith(fontSize: 20)`, which only rendered correctly while
    // `titleLarge` was undefined. Defining it would have emboldened every bar
    // in the app at once, so the bar carries its own reviewed style.
    expect(UxnanTypography.barTitle.fontSize, 20);
    expect(UxnanTypography.barTitle.fontWeight, FontWeight.w400);
  });
}
