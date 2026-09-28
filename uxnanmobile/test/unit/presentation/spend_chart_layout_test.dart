import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/widgets/spend_chart.dart';

/// The spend chart's column layout — the same rule and the same cases as the
/// desktop's (`uxnandesktop/src/lib/spendColumn.test.ts`).
void main() {
  List<double> heights(ColumnLayout layout) => [
        for (final s in layout.segments)
          double.parse((s.top - s.bottom).toStringAsFixed(3)),
      ];

  test("keeps the day's height and splits it by share, with a gap", () {
    final layout = stackColumn([30, 10], 100);
    expect(layout.height, 100);
    expect(heights(layout), [73.5, 24.5]);
    expect(
      layout.segments[1].bottom - layout.segments[0].top,
      kSpendSegmentGap,
    );
    expect(layout.segments.last.top, closeTo(100, 1e-9));
  });

  test('never lets a small share vanish: it takes from the largest', () {
    final layout = stackColumn([1000, 1, 0, 1], 100);
    expect([for (final s in layout.segments) s.index], [0, 1, 3]);
    final h = heights(layout);
    expect(h[1], kSpendMinSegment);
    expect(h[2], kSpendMinSegment);
    expect(h[0] + h[1] + h[2] + 2 * kSpendSegmentGap, closeTo(100, 1e-3));
  });

  test('grows a column too short to hold every agent it has', () {
    final layout = stackColumn([5, 5, 5], 1);
    expect(layout.height, 3 * kSpendMinSegment + 2 * kSpendSegmentGap);
    expect(
      heights(layout),
      [kSpendMinSegment, kSpendMinSegment, kSpendMinSegment],
    );
  });

  test('draws nothing for a day with no spend', () {
    final layout = stackColumn([0, 0], 50);
    expect(layout.height, 0);
    expect(layout.segments, isEmpty);
  });
}
