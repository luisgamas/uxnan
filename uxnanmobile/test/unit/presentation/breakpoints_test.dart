import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The window classes from the Neural Expressive guide §3. The cases below sit
/// ON the boundaries on purpose: an off-by-one here shows up as a tablet that
/// refuses to grow a pane at exactly 840 dp, which is the width a real device
/// reports.
void main() {
  group('UxnanBreakpoint.fromWidth', () {
    test('resolves each class at and around its boundary', () {
      expect(UxnanBreakpoint.fromWidth(0), UxnanBreakpoint.compact);
      expect(UxnanBreakpoint.fromWidth(360), UxnanBreakpoint.compact);
      expect(UxnanBreakpoint.fromWidth(599), UxnanBreakpoint.compact);

      expect(UxnanBreakpoint.fromWidth(600), UxnanBreakpoint.medium);
      expect(UxnanBreakpoint.fromWidth(839), UxnanBreakpoint.medium);

      expect(UxnanBreakpoint.fromWidth(840), UxnanBreakpoint.expanded);
      expect(UxnanBreakpoint.fromWidth(1199), UxnanBreakpoint.expanded);

      expect(UxnanBreakpoint.fromWidth(1200), UxnanBreakpoint.large);
      expect(UxnanBreakpoint.fromWidth(1599), UxnanBreakpoint.large);

      expect(UxnanBreakpoint.fromWidth(1600), UxnanBreakpoint.extraLarge);
      expect(UxnanBreakpoint.fromWidth(4000), UxnanBreakpoint.extraLarge);
    });

    test('a zero or negative width degrades to compact, never throws', () {
      expect(UxnanBreakpoint.fromWidth(-1), UxnanBreakpoint.compact);
    });
  });

  group('capabilities', () {
    test('the permanent pane starts at expanded, not at medium', () {
      expect(UxnanBreakpoint.compact.usesPermanentPane, isFalse);
      expect(UxnanBreakpoint.medium.usesPermanentPane, isFalse);
      expect(UxnanBreakpoint.expanded.usesPermanentPane, isTrue);
      expect(UxnanBreakpoint.large.usesPermanentPane, isTrue);
      expect(UxnanBreakpoint.extraLarge.usesPermanentPane, isTrue);
    });

    test('only classes with a pane carry a pane width', () {
      expect(UxnanBreakpoint.compact.sidePaneWidth, 0);
      expect(UxnanBreakpoint.medium.sidePaneWidth, 0);
      expect(UxnanBreakpoint.expanded.sidePaneWidth, UxnanSize.sidePane);
      expect(UxnanBreakpoint.large.sidePaneWidth, UxnanSize.sidePane);
      expect(
        UxnanBreakpoint.extraLarge.sidePaneWidth,
        UxnanSize.sidePaneWide,
      );
    });

    test('content margins follow the guide (16 / 24 / 24 / 32 / 32)', () {
      expect(UxnanBreakpoint.compact.contentMargin, UxnanSpacing.lg);
      expect(UxnanBreakpoint.medium.contentMargin, UxnanSpacing.xl);
      expect(UxnanBreakpoint.expanded.contentMargin, UxnanSpacing.xl);
      expect(UxnanBreakpoint.large.contentMargin, UxnanSpacing.xxl);
      expect(UxnanBreakpoint.extraLarge.contentMargin, UxnanSpacing.xxl);
    });

    test('ordering helpers agree with the enum order', () {
      expect(UxnanBreakpoint.compact.isCompact, isTrue);
      expect(UxnanBreakpoint.medium.isCompact, isFalse);
      expect(UxnanBreakpoint.compact.isAtLeastMedium, isFalse);
      expect(UxnanBreakpoint.medium.isAtLeastMedium, isTrue);
      expect(UxnanBreakpoint.medium.isAtLeastExpanded, isFalse);
      expect(UxnanBreakpoint.expanded.isAtLeastExpanded, isTrue);
    });
  });

  group('horizontalInsetFor', () {
    test('is zero below expanded, whatever the width', () {
      // The guarantee that adding `constrainContent` to an existing screen
      // cannot change a single pixel on a phone.
      expect(UxnanBreakpoint.compact.horizontalInsetFor(360), 0);
      expect(UxnanBreakpoint.compact.horizontalInsetFor(599), 0);
      expect(UxnanBreakpoint.medium.horizontalInsetFor(839), 0);
    });

    test('turns the surplus over the max width into equal margins', () {
      // 1000 dp window, 840 dp of content → 80 dp a side.
      expect(UxnanBreakpoint.expanded.horizontalInsetFor(1000), 80);
      // 1280 dp window, 1040 dp of content → 120 dp a side.
      expect(UxnanBreakpoint.large.horizontalInsetFor(1280), 120);
      // 1700 dp window, 1200 dp of content → 250 dp a side.
      expect(UxnanBreakpoint.extraLarge.horizontalInsetFor(1700), 250);
    });

    test('never goes negative when the pane is narrower than the max', () {
      // A content pane inside a shell can be narrower than its class's max —
      // a negative inset there would push content off-screen.
      expect(UxnanBreakpoint.expanded.horizontalInsetFor(700), 0);
    });
  });
}
