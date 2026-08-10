import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Finds every [UxIcon] drawing [icon].
///
/// The replacement for `find.byIcon`, which takes an `IconData` and therefore
/// cannot see a Hugeicons glyph at all — the package models an icon as SVG path
/// data, not as a font code point.
///
/// Matching is by **identity**, not equality: the glyphs are `const` lists, so
/// two different constants are two different objects even when they happen to
/// hold the same paths, and identity is both cheaper and stricter than a deep
/// list comparison.
Finder findUxIcon(UxIconData icon) => find.byWidgetPredicate(
      (widget) => widget is UxIcon && identical(widget.icon, icon),
      description: 'UxIcon(<glyph>)',
    );
