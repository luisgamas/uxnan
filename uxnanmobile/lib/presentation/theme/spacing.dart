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

  /// Maximum width the conversation content (messages + composer) grows to
  /// before it centers, so wide screens (tablets) don't stretch the layout —
  /// extra horizontal space becomes margins instead of over-wide content.
  static const double maxContentWidth = 760;
}

/// Shared component dimensions that must remain visually synchronized across
/// otherwise different widgets.
class UxnanSize {
  const UxnanSize._();

  /// Visual height of the compact chrome above the conversation composer.
  static const double compactComposerChrome = 38;

  /// Glyph size inside compact composer-chrome icon surfaces.
  static const double compactComposerIcon = 24;

  /// Minimum interactive target required for icon-only controls.
  static const double minTouchTarget = 48;

  /// Visual diameter of an app-bar Icon Surface. The Neural Expressive guide
  /// specifies 40 dp; uxnan draws 44 — at 40 the actions read as small change
  /// beside the product mark, and the row lost its balance (guide §4.2 records
  /// the divergence).
  static const double iconSurface = 44;

  /// Glyph size inside an [iconSurface].
  static const double iconSurfaceGlyph = 22;

  /// A glyph drawn **inside content** — a row's leading mark, a folder, a
  /// chevron. The Neural Expressive guide sizes chrome (icon surfaces) and the
  /// composer, but never said anything about these, which is how they drifted
  /// between 13 and 18 dp across the app. Material's own default is 24; 20 sits
  /// just under it so a content glyph never out-weighs the text it labels.
  static const double iconContent = 20;

  /// The glyph that *identifies* a row — the folder a group of conversations
  /// lives in. Material's own default, and the one place in content where a
  /// glyph is allowed to lead rather than accompany.
  static const double iconContentLarge = 24;

  /// The subordinate glyph on the same row: a state mark beside an identity
  /// mark, a chevron beside a name. Small enough to read as secondary, large
  /// enough to still be a shape rather than a dot.
  static const double iconContentSmall = 18;

  /// The **S** step of the guide's button hierarchy (§4.5: XS 32 / S 40 /
  /// M 48 / L 56) — a row-level action that has to look pressable without
  /// out-ranking the row it sits on. Still inside a [minTouchTarget].
  static const double buttonSmall = 40;

  /// Stroke weight every [UxIcon] draws at unless it asks for another.
  ///
  /// Hugeicons authors its artwork at 1.5 on a 24-unit grid, against Material's
  /// 2 — and `UxIcon`'s optical scale then shrinks the artwork inside its box,
  /// which thins that stroke a further ~13%. Compounded, glyphs arrived about a
  /// third lighter than the Material ones this app was drawn around, and read
  /// as faint. This restores the weight without touching the sizes: 2 on the
  /// grid, drawn at ~1.74 after the optical scale — heavier than the vendor
  /// default, just under Material.
  ///
  /// `uxnandesktop` keeps the vendor's 1.5: it draws smaller glyphs on a
  /// monitor an arm and a half away, where the lighter stroke is correct.
  static const double iconStroke = 2;

  /// Diameter of the shared floating conversation/history scroll shortcut.
  static const double floatingScrollShortcut = 52;

  /// Default height of compact status badges embedded in Markdown.
  static const double inlineBadgeHeight = 20;

  /// Maximum height of an unconstrained image embedded in Markdown.
  static const double maxInlineMediaHeight = 420;

  /// Shortest slot that still fits the padded loading / broken-media
  /// placeholder (icon + optional caption). Anything shorter — an inline badge
  /// row — renders the compact single-glyph variant instead.
  static const double mediaPlaceholderMinHeight = 56;

  /// Width of the permanent side pane (navigation drawer) on expanded and
  /// large windows — the Neural Expressive guide's pinned-drawer width
  /// (`docs/neural-expressive-design.md` §4.4).
  static const double sidePane = 320;

  /// Width of the permanent side pane on extra-large windows, where the guide
  /// allows it to grow.
  static const double sidePaneWide = 360;
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

  /// 24dp radius — what a pill morphs into when it has to hold stacked content
  /// (the composer with attachments), instead of keeping its stadium ends.
  static const Radius xxl = Radius.circular(24);

  /// Fully rounded (pill) radius.
  static const Radius full = Radius.circular(999);
}
