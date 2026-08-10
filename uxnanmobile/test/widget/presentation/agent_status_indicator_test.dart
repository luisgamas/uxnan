import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/agent_run_state_provider.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/agent_status_indicator.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

import '../../support/ux_icon_finder.dart';

void main() {
  Future<void> pump(WidgetTester tester, AgentRunStatus status) {
    return tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: AgentStatusIndicator(status: status)),
      ),
    );
  }

  AgentRunStatus status(
    AgentRunState state, {
    bool errored = false,
    bool stale = false,
  }) =>
      (state: state, errored: errored, stale: stale);

  testWidgets('every state draws a DIFFERENT shape, not just a colour',
      (tester) async {
    // Colour alone is not a channel every reader has, and this mark is often
    // the only thing telling two identical-looking rows apart.
    await pump(tester, status(AgentRunState.working));
    expect(find.byType(PolygonLoader), findsOneWidget);

    await pump(tester, status(AgentRunState.waiting));
    expect(findUxIcon(UxIcons.agentWaiting), findsOneWidget);

    await pump(tester, status(AgentRunState.blocked));
    expect(findUxIcon(UxIcons.agentBlocked), findsOneWidget);

    await pump(tester, status(AgentRunState.done));
    expect(findUxIcon(UxIcons.agentDone), findsOneWidget);
  });

  testWidgets('idle stays a plain dot — a glyph there would be constant noise',
      (tester) async {
    await pump(tester, status(AgentRunState.idle));

    expect(find.byType(UxIcon), findsNothing);
    expect(find.byType(PolygonLoader), findsNothing);
  });

  testWidgets('an error re-tints the state instead of replacing it',
      (tester) async {
    // "The last turn failed" and "it is working again" are both true; the row
    // does not have to choose.
    await pump(tester, status(AgentRunState.working, errored: true));

    expect(find.byType(PolygonLoader), findsOneWidget);
    expect(
      tester.widget<PolygonLoader>(find.byType(PolygonLoader)).color,
      isNot(Theme.of(tester.element(find.byType(PolygonLoader))).primaryColor),
    );
  });

  testWidgets('a stale claim is dimmed, not dropped', (tester) async {
    await pump(tester, status(AgentRunState.working, stale: true));

    final opacity = tester.widget<Opacity>(
      find.ancestor(
        of: find.byType(PolygonLoader),
        matching: find.byType(Opacity),
      ),
    );
    expect(opacity.opacity, lessThan(1));
    expect(find.byType(PolygonLoader), findsOneWidget);
  });

  testWidgets('every state announces itself to a screen reader',
      (tester) async {
    final handle = tester.ensureSemantics();
    for (final state in AgentRunState.values) {
      await pump(tester, status(state));
      expect(
        find.bySemanticsLabel(RegExp('.+')),
        findsWidgets,
        reason: '$state must carry a label; the glyph alone says nothing',
      );
    }
    handle.dispose();
  });

  testWidgets('keeps one footprint so a list never shifts as agents settle',
      (tester) async {
    for (final state in AgentRunState.values) {
      await pump(tester, status(state));
      expect(
        tester.getSize(find.byType(AgentStatusIndicator)),
        const Size(14, 14),
        reason: '$state changed the row height',
      );
    }
  });
}
