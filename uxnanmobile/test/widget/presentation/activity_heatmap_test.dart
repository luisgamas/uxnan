import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/widgets/activity_heatmap.dart';

/// The real ~/.uxnan activity days (bridge sends UTC-midnight epochs).
Map<DateTime, int> _realCounts() {
  MetricsActivityDay day(int m, int d, {int c = 0, int msg = 0}) =>
      MetricsActivityDay(
        day: DateTime.utc(2026, m, d).millisecondsSinceEpoch,
        conversations: c,
        messages: msg,
        work: 0,
      );
  final snapshot = MetricsSnapshot(
    deviceId: 'pc-1',
    conversations: 23,
    agentsUsed: 6,
    modelsUsed: 4,
    messages: 44,
    gitActions: 0,
    sessions: 5,
    totalConnectedMs: 0,
    longestSessionMs: 0,
    relaySessions: 0,
    directSessions: 5,
    byAgent: const [],
    activity: [
      day(7, 3, c: 1),
      day(7, 6, c: 4, msg: 8),
      day(7, 9, c: 3, msg: 6),
      day(7, 13, c: 1, msg: 6),
      day(7, 14, c: 11, msg: 14),
      day(7, 15, c: 3, msg: 10),
    ],
    byAgentDay: const [],
  );
  return aggregateActivity(
    [snapshot],
    year: 2026,
    metric: ActivityMetric.combined,
  );
}

int _paintedCells(WidgetTester tester, ColorScheme scheme) {
  final empty = scheme.surfaceContainerHigh;
  return tester.widgetList<Container>(find.byType(Container)).where((c) {
    final d = c.decoration;
    return d is BoxDecoration && d.border != null && d.color != empty;
  }).length;
}

int _dayCells(WidgetTester tester) =>
    tester.widgetList<Container>(find.byType(Container)).where((c) {
      final d = c.decoration;
      return d is BoxDecoration && d.border != null;
    }).length;

Widget _harness(
  ColorScheme scheme,
  Map<DateTime, int> counts,
  DateTime today,
) =>
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: ThemeData(colorScheme: scheme, useMaterial3: true),
      home: Scaffold(
        body: SingleChildScrollView(
          child: ActivityHeatmap(year: 2026, countsByDay: counts, today: today),
        ),
      ),
    );

void main() {
  final scheme = ColorScheme.fromSeed(seedColor: Colors.indigo);

  testWidgets('paints a cell for each active day (real bridge snapshot data)',
      (tester) async {
    final counts = _realCounts();
    expect(counts.length, 6, reason: 'six active days derived');

    // A completed year (today past Dec 31) renders every day; each of the six
    // active July days must paint a colored cell — proving the UTC keys match.
    await tester.pumpWidget(_harness(scheme, counts, DateTime.utc(2027)));
    await tester.pumpAndSettle();

    expect(
      _paintedCells(tester, scheme),
      6,
      reason: 'each of the six active days paints a colored cell',
    );
  });

  testWidgets('the in-progress year stops at today, not Dec 31',
      (tester) async {
    final counts = _realCounts();

    // Full 2026 grid (year already elapsed): every calendar day is a cell.
    await tester.pumpWidget(_harness(scheme, counts, DateTime.utc(2027)));
    await tester.pumpAndSettle();
    final full = _dayCells(tester);
    expect(full, greaterThan(360), reason: 'a complete year renders every day');

    // Mid-July "today": future weeks (Aug–Dec) are trimmed, so the grid opens
    // (scrolled to its trailing edge) on the current week instead of empty
    // future months — the bug that hid the July activity off-screen.
    final midYear = DateTime.utc(2026, 7, 16);
    await tester.pumpWidget(_harness(scheme, counts, midYear));
    await tester.pumpAndSettle();
    final trimmed = _dayCells(tester);
    expect(
      trimmed,
      lessThan(full),
      reason: 'future weeks are trimmed for the in-progress year',
    );
    // The six active days are all on/before Jul 16, so they still paint.
    expect(_paintedCells(tester, scheme), 6);
  });
}
