import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';

/// The sort menu has to stay a menu.
///
/// Three levels × four orderings, plus headers and dividers, was seventeen
/// entries — a list that ran off the bottom of a phone. These pin the shape
/// that replaced it: a short first step, and a short second one.
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
  }

  int menuItems(WidgetTester tester) =>
      find.byType(PopupMenuItem<Object?>).evaluate().length;

  testWidgets('the first step lists levels, not orderings', (tester) async {
    await pump(tester, projectSort: ListSort.name);
    await tester.tap(find.byType(IconSurface));
    await tester.pumpAndSettle();

    // Three levels — and crucially NOT the twelve orderings behind them.
    expect(find.text('Projects'), findsOneWidget);
    expect(find.text('Folders'), findsOneWidget);
    expect(find.text('Conversations'), findsOneWidget);
    expect(
      menuItems(tester),
      lessThanOrEqualTo(4),
      reason: 'the first step grew back into a long list',
    );
  });

  testWidgets('each level shows what it is sorted by, before drilling in',
      (tester) async {
    await pump(tester, projectSort: ListSort.name);
    await tester.tap(find.byType(IconSurface));
    await tester.pumpAndSettle();

    // The question this menu usually gets asked, answered on the way past.
    expect(find.text('Name'), findsOneWidget);
    expect(find.text('Creation date'), findsOneWidget);
  });

  testWidgets('picking a level then an ordering reports both', (tester) async {
    await pump(tester, projectSort: ListSort.name);
    await tester.tap(find.byType(IconSurface));
    await tester.pumpAndSettle();

    await tester.tap(
      find.ancestor(
        of: find.text('Projects'),
        matching: find.byType(PopupMenuItem<(SortLevel, String, ListSort)>),
      ),
    );
    await tester.pumpAndSettle();

    // Second step: only this level's orderings.
    expect(menuItems(tester), lessThanOrEqualTo(4));
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

  testWidgets('one level to order skips the choosing step', (tester) async {
    // The archive has only agents. A menu of one is not a choice.
    await pump(
      tester,
      worktreeSort: null,
      options: kArchiveSorts,
    );
    await tester.tap(find.byType(IconSurface));
    await tester.pumpAndSettle();

    expect(find.text('Conversations'), findsNothing);
    expect(find.text('Creation date'), findsOneWidget);
    expect(find.text('Name'), findsOneWidget);
    // And nothing that cannot apply to finished work.
    expect(find.text('Needs attention'), findsNothing);
    expect(find.text('Recent activity'), findsNothing);
  });
}
