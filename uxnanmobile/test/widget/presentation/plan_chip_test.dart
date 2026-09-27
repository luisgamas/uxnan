import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/domain/value_objects/window_pace.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/composer/plan_chip.dart';

Widget _wrap(Widget child) => MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: Center(child: child)),
    );

UsageWindow _session(double used) => UsageWindow(
      id: 'session5h',
      label: 'Session (5h)',
      usedPercent: used,
      windowMinutes: 300,
      resetsAt: DateTime.now().add(const Duration(hours: 2)),
    );

void main() {
  testWidgets('shows the used share, and on tap the window and its pace',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        PlanChip(
          name: 'Claude',
          plan: (
            window: _session(72),
            pace: const WindowPace(
              elapsed: 0.6,
              runsOutIn: Duration(minutes: 70),
            ),
          ),
        ),
      ),
    );
    expect(find.text('72%'), findsOneWidget);
    await tester.tap(find.byType(PlanChip));
    await tester.pump(const Duration(milliseconds: 300));
    expect(
      find.textContaining('Claude · Session (5h) 72% used'),
      findsOneWidget,
    );
    expect(
      find.textContaining('At this pace you hit the limit in 1h 10min'),
      findsOneWidget,
    );
    await tester.pump(const Duration(seconds: 5));
  });

  test('names each plan', () {
    expect(planDisplayName(UsageProvider.claude), 'Claude');
    expect(planDisplayName(UsageProvider.codex), 'Codex');
    expect(planDisplayName(UsageProvider.grok), 'Grok');
  });
}
