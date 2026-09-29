import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_menu_button.dart';

/// The sort control is a nested menu, built the way Material nests them.
///
/// The first version stepped the submenu down and in from the parent menu's
/// corner, which laid it OVER the parent menu instead of beside the row that
/// opened it. These pin the nesting: levels first, each opening its
/// orderings NEXT TO its row (never on top of it), the row marked active while
/// its submenu is open, and the parent menu staying up across choices.
Future<void> main() async {
  late List<SortChoice> picked;

  Future<void> pump(
    WidgetTester tester,
    Map<SortLevel, ListSort> levels, {
    double width = 1280,
  }) async {
    picked = [];
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          appBar: AppBar(
            actions: [ThreadSortMenu(levels: levels, onChanged: picked.add)],
          ),
        ),
      ),
    );
    await tester.tap(find.byType(IconSurface));
    await tester.pumpAndSettle();
  }

  const threeLevels = {
    SortLevel.projects: ListSort.status,
    SortLevel.worktrees: ListSort.status,
    SortLevel.agents: ListSort.created,
  };

  Finder orderings() => find.byType(CheckedPopupMenuItem<ListSort>);

  testWidgets('the first menu lists levels, each with what it is sorted by',
      (tester) async {
    await pump(tester, threeLevels);

    expect(find.byType(NeSubmenuRow<ListSort>), findsNWidgets(3));
    expect(orderings(), findsNothing);
    expect(find.text('Projects'), findsOneWidget);
    expect(find.text('Needs attention'), findsNWidgets(2));
    expect(find.text('Creation date'), findsOneWidget);
  });

  for (final width in [1280.0, 411.0]) {
    testWidgets(
        'a submenu opens beside its row, never on top of it '
        '(${width.toInt()} dp)', (tester) async {
      await pump(tester, threeLevels, width: width);
      final row = find.byType(NeSubmenuRow<ListSort>).first;
      final rowRect = tester.getRect(row);

      await tester.tap(row);
      await tester.pumpAndSettle();

      expect(orderings(), findsNWidgets(4));
      final submenu = tester.getRect(
        find
            .ancestor(of: orderings().first, matching: find.byType(Material))
            .first,
      );
      final beside = submenu.left >= rowRect.right - 0.5 ||
          submenu.right <= rowRect.left + 0.5;
      final below = submenu.top >= rowRect.bottom - 0.5;
      expect(
        beside || below,
        isTrue,
        reason: 'submenu $submenu covers its row $rowRect',
      );
    });
  }

  testWidgets('a choice reports its level and the parent menu stays up',
      (tester) async {
    await pump(tester, threeLevels);

    await tester.tap(find.byType(NeSubmenuRow<ListSort>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Name'));
    await tester.pumpAndSettle();

    expect(picked.single.level, SortLevel.projects);
    expect(picked.single.value, ListSort.name);
    // Back on the levels, the row already says what it is now sorted by.
    expect(find.byType(NeSubmenuRow<ListSort>), findsNWidgets(3));
    expect(find.text('Name'), findsOneWidget);
  });

  testWidgets('one level to order is its orderings, with nothing nested',
      (tester) async {
    await pump(tester, const {SortLevel.archive: ListSort.created});

    expect(find.byType(NeSubmenuRow<ListSort>), findsNothing);
    expect(orderings(), findsNWidgets(kArchiveSorts.length));
  });
}
