import 'package:flutter/widgets.dart';

/// Spacing scale for the Uxnan design system (see spec 02c section 3.1).
///
/// All gaps, paddings and margins must reference these tokens rather than magic
/// numbers, per the design-token rule in the project conventions.
class UxnanSpacing {
  const UxnanSpacing._();

  /// 4dp.
  static const double xs = 4;

  /// 8dp.
  static const double sm = 8;

  /// 12dp.
  static const double md = 12;

  /// 16dp.
  static const double lg = 16;

  /// 24dp.
  static const double xl = 24;

  /// 32dp.
  static const double xxl = 32;

  /// 48dp.
  static const double xxxl = 48;
}

/// Corner-radius scale for the Uxnan design system.
class UxnanRadius {
  const UxnanRadius._();

  /// 4dp radius.
  static const Radius sm = Radius.circular(4);

  /// 8dp radius.
  static const Radius md = Radius.circular(8);

  /// 12dp radius.
  static const Radius lg = Radius.circular(12);

  /// 16dp radius.
  static const Radius xl = Radius.circular(16);

  /// Fully rounded (pill) radius.
  static const Radius full = Radius.circular(999);
}
