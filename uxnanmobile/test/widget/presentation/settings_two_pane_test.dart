import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/profile_screen.dart';
import 'package:uxnan/presentation/screens/settings/settings_screen.dart';
import 'package:uxnan/presentation/screens/shell/app_shell_screen.dart';

/// Settings is one screen shown two ways: a list you tap into on a phone, and
/// a list beside the section it opened on a wide surface.
///
/// The width that decides is **this surface's**, not the window's — inside the
/// shell's content pane a 320 dp drawer is already spent, so a 1280 dp window
/// leaves ~955 dp here. Measuring the window would split a pane that has no
/// room for two columns.
Future<void> main() async {
  Future<void> pump(WidgetTester tester, {required double width}) async {
    tester.view.physicalSize = Size(width, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          // The profile header reads the real profile store, which opens the
          // database and leaves drift timers pending in a layout test.
          phoneNameProvider.overrideWith((ref) => Stream.value('Tester')),
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: SettingsScreen(),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('a phone gets the list alone', (tester) async {
    await pump(tester, width: 390);

    expect(find.byType(TwoPaneScaffold), findsNothing);
    // Tapping still pushes a screen: there is no pane for a section to fill.
    expect(find.text('Personalization'), findsOneWidget);
  });

  testWidgets('a wide surface opens the profile beside the list',
      (tester) async {
    await pump(tester, width: 1200);

    expect(find.byType(TwoPaneScaffold), findsOneWidget);
    // Never a "pick a section" placeholder — and it is the PROFILE that opens,
    // not Personalization. It is the row the list is headed by and the one you
    // most likely came for; Personalization was first only because it happened
    // to lead the General group.
    expect(find.byType(ProfileScreen), findsOneWidget);
  });

  testWidgets('the profile behaves like the sections it sits among',
      (tester) async {
    // It is a card at the top of the same list, and it opened a whole new
    // screen while every row under it filled the pane — the row that looks
    // most like a section was the only one that did not act like one.
    await pump(tester, width: 1200);

    await tester.tap(find.text('Personalization'));
    await tester.pump();

    expect(find.byType(ProfileScreen), findsNothing);
  });

  testWidgets('a section keeps its own children inside the pane',
      (tester) async {
    // Personalization → custom themes, About → licences: sections open their
    // sub-screens with `Navigator.of(context).push`, and without a navigator
    // in the pane those resolve to the one above and take over the whole
    // window, accesses and all. The pane has its own, so left stays the
    // accesses and right becomes the child.
    await pump(tester, width: 1200);

    expect(
      find.descendant(
        of: find.byType(TwoPaneScaffold),
        matching: find.byType(Navigator),
      ),
      findsWidgets,
      reason: 'the pane has no navigator, so a child would escape it',
    );
  });

  testWidgets('picking another section starts its own stack', (tester) async {
    // A navigator per section: wander into a child, come back to a different
    // section, and it should open at its own root rather than inheriting where
    // you had got to in the last one.
    await pump(tester, width: 1200);

    final first = tester
        .widgetList<Navigator>(
          find.descendant(
            of: find.byType(TwoPaneScaffold),
            matching: find.byType(Navigator),
          ),
        )
        .map((n) => n.key)
        .whereType<GlobalKey<NavigatorState>>()
        .toList();
    expect(first, isNotEmpty);

    await tester.tap(find.text('Personalization'));
    await tester.pump();

    final second = tester
        .widgetList<Navigator>(
          find.descendant(
            of: find.byType(TwoPaneScaffold),
            matching: find.byType(Navigator),
          ),
        )
        .map((n) => n.key)
        .whereType<GlobalKey<NavigatorState>>()
        .toList();
    expect(second, isNot(first));
  });

  testWidgets("the system back returns from a section's child to the section",
      (tester) async {
    // Nothing forwards the OS back to a navigator the router does not know
    // about: back from a sub-screen used to close Settings entirely.
    await pump(tester, width: 1200);
    final pane = tester.state<NavigatorState>(
      find.descendant(
        of: find.byType(TwoPaneScaffold),
        matching: find.byType(Navigator),
      ),
    );
    unawaited(
      pane.push(
        MaterialPageRoute<void>(builder: (_) => const Text('a sub-screen')),
      ),
    );
    await tester.pump(const Duration(milliseconds: 600));
    // The pane's navigator reports it can pop after the frame; one more frame
    // lets the handler take the back gesture for it.
    await tester.pump();
    expect(find.text('a sub-screen'), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pump(const Duration(milliseconds: 600));

    expect(find.text('a sub-screen'), findsNothing);
    expect(find.byType(SettingsScreen), findsOneWidget);
  });

  testWidgets('a pane too narrow for two columns keeps one', (tester) async {
    // 800 dp is a landscape phone or a narrow pane. A 320 dp list plus a
    // section in what is left is worse than either on its own.
    await pump(tester, width: 800);

    expect(find.byType(TwoPaneScaffold), findsNothing);
  });

  testWidgets(
      "beside its pane, the list's arrow leaves Settings in one tap — even "
      'with a sub-screen open', (tester) async {
    // The arrow used to pop the route, whose pane forwards a pop to its own
    // navigator: it closed the sub-screen in the OTHER pane, and leaving took
    // two taps.
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          phoneNameProvider.overrideWith((ref) => Stream.value('Tester')),
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const SettingsScreen()),
              ),
              child: const Text('where Settings was opened from'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('where Settings was opened from'));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    final pane = tester.state<NavigatorState>(
      find.descendant(
        of: find.byType(TwoPaneScaffold),
        matching: find.byType(Navigator),
      ),
    );
    unawaited(
      pane.push(
        MaterialPageRoute<void>(builder: (_) => const Text('a sub-screen')),
      ),
    );
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();

    await tester.tap(find.byTooltip('Back').first);
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }

    expect(find.byType(SettingsScreen), findsNothing);
    expect(find.text('where Settings was opened from'), findsOneWidget);
  });
}
