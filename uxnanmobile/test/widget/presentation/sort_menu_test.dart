import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// The sort menu has to be the app's menu, and stay open.
///
/// Two things went wrong before this shape. Seventeen entries in one list ran
/// off the bottom of a phone. And the fix for that used `MenuAnchor` — the only
/// Flutter widget with a built-in cascade — which put a second menu SYSTEM in
/// the app bar: a bare overlay beside routed menus, opening and closing
/// differently, and swallowing taps between them. These pin both: short
/// panels, and the app's own `showMenu` underneath.
Future<void> main() async {
  late List<SortChoice> picked;

  Future<void> pump(
    WidgetTester tester, {
    ListSort? projectSort,
    ListSort? worktreeSort = ListSort.status,
    List<ListSort> options = kAgentSorts,
  }) async {
    picked = [];
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          appBar: AppBar(
            actions: [
              ThreadSortMenu(
                projectSort: projectSort,
                worktreeSort: worktreeSort,
                agentSort: ListSort.created,
                options: options,
                onChanged: picked.add,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.tap(find.byType(IconSurface));
    await tester.pumpAndSettle();
  }

  Finder orderings() => find.byType(CheckedPopupMenuItem<ListSort>);

  testWidgets('every panel is a routed menu, like the rest of the bar',
      (tester) async {
    await pump(tester, projectSort: ListSort.name);

    // `showMenu` pushes a route; the whole asymmetry with the other app-bar
    // menus came from a panel that was NOT one.
    expect(find.byType(PopupMenuItem<void>), findsWidgets);

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    expect(orderings(), findsWidgets);
  });

  testWidgets('the first panel lists levels, not orderings', (tester) async {
    await pump(tester, projectSort: ListSort.name);

    expect(find.text('Projects'), findsOneWidget);
    expect(find.text('Folders'), findsOneWidget);
    expect(find.text('Conversations'), findsOneWidget);
    // The twelve orderings behind them are not on screen yet.
    expect(orderings(), findsNothing);
  });

  testWidgets('each level shows what it is sorted by, unopened',
      (tester) async {
    await pump(tester, projectSort: ListSort.name);

    // The question this menu usually gets asked, answered before any tap.
    expect(find.text('Name'), findsOneWidget);
    expect(find.text('Creation date'), findsOneWidget);
  });

  testWidgets('a level row carries exactly one chevron', (tester) async {
    await pump(tester, projectSort: ListSort.name);

    // A previous build drew the app's chevron AND Material's submenu arrow on
    // the same row, because a submenu adds its own on top of whatever you
    // supply. Scoped to the rows: the trigger's own glyph is still on screen.
    expect(
      find.descendant(
        of: find.byType(PopupMenuItem<void>).first,
        matching: find.byType(UxIcon),
      ),
      findsOneWidget,
    );
  });

  testWidgets('the submenu opens WITHOUT closing the first panel',
      (tester) async {
    await pump(tester, projectSort: ListSort.name);

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();

    // The second route is pushed over the first rather than replacing it —
    // which is what makes going back, and setting a second level, possible.
    expect(orderings(), findsWidgets);
    expect(find.text('Folders'), findsOneWidget);
    expect(find.text('Conversations'), findsOneWidget);
  });

  testWidgets('picking reports the level and its ordering', (tester) async {
    await pump(tester, projectSort: ListSort.name);

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.ancestor(
        of: find.text('Recent activity'),
        matching: find.byType(CheckedPopupMenuItem<ListSort>),
      ),
    );
    await tester.pumpAndSettle();

    expect(picked, hasLength(1));
    expect(picked.single.level, SortLevel.projects);
    expect(picked.single.value, ListSort.activity);
  });

  testWidgets('a second level is reachable without reopening', (tester) async {
    await pump(tester, projectSort: ListSort.name);

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.ancestor(
        of: find.text('Recent activity'),
        matching: find.byType(CheckedPopupMenuItem<ListSort>),
      ),
    );
    await tester.pumpAndSettle();

    // Straight on to another level: the panel of levels never went away.
    expect(find.text('Folders'), findsOneWidget);
    await tester.tap(find.text('Folders'));
    await tester.pumpAndSettle();
    expect(orderings(), findsWidgets);
  });

  testWidgets('the level row updates the moment you pick', (tester) async {
    await pump(tester, projectSort: ListSort.name);
    expect(find.text('Name'), findsOneWidget);

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.ancestor(
        of: find.text('Recent activity'),
        matching: find.byType(CheckedPopupMenuItem<ListSort>),
      ),
    );
    await tester.pumpAndSettle();

    // A `showMenu` builds its items once, so without a live source the row's
    // subtitle stayed on the old ordering until the menu was closed and
    // reopened — the menu contradicting the choice you just made in it.
    expect(find.text('Recent activity'), findsOneWidget);
    expect(find.text('Name'), findsNothing);
  });

  testWidgets('reopening the submenu shows the new choice checked',
      (tester) async {
    await pump(tester, projectSort: ListSort.name);

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.ancestor(
        of: find.text('Recent activity'),
        matching: find.byType(CheckedPopupMenuItem<ListSort>),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();

    // The second panel is rebuilt from the same live source as the first, so
    // the tick has moved with the choice rather than waiting for a full close.
    final checked = tester
        .widgetList<CheckedPopupMenuItem<ListSort>>(orderings())
        .where((item) => item.checked)
        .toList();
    expect(checked, hasLength(1));
    expect(checked.single.value, ListSort.activity);
  });

  testWidgets('leaving a submenu returns to the levels', (tester) async {
    await pump(tester, projectSort: ListSort.name);

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();

    // Dismissing the second route is "back" — it costs no widget, because a
    // route stack already works this way.
    Navigator.of(tester.element(orderings().first)).pop();
    await tester.pumpAndSettle();

    expect(orderings(), findsNothing);
    expect(find.text('Folders'), findsOneWidget);
    expect(picked, isEmpty);
  });

  testWidgets('one level to order needs no cascade at all', (tester) async {
    // The archive has only agents. A submenu of one is a tap that buys
    // nothing, so its orderings ARE the menu.
    await pump(tester, worktreeSort: null, options: kArchiveSorts);

    expect(find.text('Conversations'), findsNothing);
    expect(orderings(), findsNWidgets(2));
    // And nothing that cannot apply to finished work.
    expect(find.text('Needs attention'), findsNothing);
    expect(find.text('Recent activity'), findsNothing);
  });
}
