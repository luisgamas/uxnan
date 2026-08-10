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
          profileNameProvider.overrideWith(_FixedName.new),
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
    // Keyed by section: wander into a child, come back to a different section,
    // and it should open at its own root rather than inheriting where you had
    // got to in the last one.
    await pump(tester, width: 1200);

    final first = tester
        .widgetList<Navigator>(
          find.descendant(
            of: find.byType(TwoPaneScaffold),
            matching: find.byType(Navigator),
          ),
        )
        .map((n) => n.key)
        .whereType<ValueKey<String>>()
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
        .whereType<ValueKey<String>>()
        .toList();
    expect(second, isNot(first));
  });

  testWidgets('a pane too narrow for two columns keeps one', (tester) async {
    // 800 dp is a landscape phone or a narrow pane. A 320 dp list plus a
    // section in what is left is worse than either on its own.
    await pump(tester, width: 800);

    expect(find.byType(TwoPaneScaffold), findsNothing);
  });
}

/// A profile name that needs no store behind it.
class _FixedName extends ProfileName {
  @override
  String? build() => 'Tester';
}
