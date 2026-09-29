import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/screens/shell/app_shell.dart';
import 'package:uxnan/presentation/screens/shell/app_shell_screen.dart';
import 'package:uxnan/presentation/screens/shell/nav_drawer.dart';
import 'package:uxnan/presentation/screens/shell/shell_welcome.dart';

/// The shell decides, per window width, whether a routed screen IS the window
/// or sits beside a drawer.
///
/// Navigation tests before layout tests, because the shell wraps the router and
/// the router touches everything: the failure that costs most here is not an
/// ugly drawer, it is a phone that quietly gained a layer.
Future<void> main() async {
  /// Sizes the SURFACE, not just the MediaQuery: the shell measures its own
  /// constraints (a pane inside a pane must not read the window), so a
  /// MediaQuery alone would leave it at the 800 dp default and never widen.
  Future<void> pump(
    WidgetTester tester, {
    required double width,
    required String location,
  }) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          // Keeps the drawer's own data out of a test about layout. The
          // conversation route makes the drawer ask which PC the thread runs
          // on, which reaches the real thread stream (and its database) unless
          // it is fed here.
          trustedDevicesProvider.overrideWith((ref) => Stream.value(const [])),
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
          threadsProvider.overrideWith((ref) => Stream.value(const [])),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: AppShell(
            location: location,
            child: const Text('routed screen'),
          ),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('a phone gets the screen and nothing else', (tester) async {
    await pump(tester, width: 390, location: AppRoutes.home);

    // Literally `child` — not a hidden drawer, not a collapsed pane. The stack
    // that exists today has to keep working exactly as it does.
    expect(find.text('routed screen'), findsOneWidget);
    expect(find.byType(NavDrawer), findsNothing);
    expect(find.byType(TwoPaneScaffold), findsNothing);
  });

  testWidgets('a wide window puts the screen beside a drawer', (tester) async {
    await pump(tester, width: 1280, location: '/conversation/abc');

    expect(find.byType(TwoPaneScaffold), findsOneWidget);
    expect(find.byType(NavDrawer), findsOneWidget);
    expect(find.text('routed screen'), findsOneWidget);
  });

  testWidgets('the routed child is never removed from the tree',
      (tester) async {
    // `child` is not just the screen — it is the router's own Navigator, the
    // one carrying `shellNavigatorKey`. The root used to get `ShellWelcome`
    // here INSTEAD of `child`, which unmounted that navigator; the OS back
    // button then threw a null check inside `GoRouterDelegate.popRoute`, on a
    // tablet sitting at the overview, which is where it starts.
    //
    // What the root SHOWS is the route's business (`app_router.dart`), and
    // `shell_back_button_test.dart` pins that end of it.
    for (final location in [AppRoutes.home, '/conversation/abc']) {
      await pump(tester, width: 1280, location: location);
      expect(
        find.text('routed screen'),
        findsOneWidget,
        reason: '$location dropped the router child',
      );
      expect(find.byType(NavDrawer), findsOneWidget);
    }
  });

  testWidgets('the welcome pane is a phone screen, not a shell surface',
      (tester) async {
    // On a phone `/` IS the overview — the welcome exists only because a
    // drawer is already showing what it would otherwise say.
    await pump(tester, width: 390, location: AppRoutes.home);

    expect(find.byType(ShellWelcome), findsNothing);
    expect(find.text('routed screen'), findsOneWidget);
  });

  testWidgets('no destination ever sits beside a drawer', (tester) async {
    // Settings and profile included: with Settings splitting into its own two
    // panes, a drawer beside it is a third column showing conversations that
    // cannot change anything on that screen.
    for (final location in [
      AppRoutes.onboarding,
      AppRoutes.pairing,
      AppRoutes.settings,
      AppRoutes.profile,
    ]) {
      await pump(tester, width: 1280, location: location);
      expect(
        find.byType(TwoPaneScaffold),
        findsNothing,
        reason: '$location was wrapped in a drawer',
      );
      expect(find.text('routed screen'), findsOneWidget);
    }
  });

  test('a LayoutBuilder never wraps a ref.listen', () {
    // Found on a tablet, not here: measuring the pane with a `LayoutBuilder`
    // moved the conversation's whole build into the LAYOUT phase, and
    // `ref.listen` asserts it is called during BUILD. Opening any conversation
    // threw. Subscriptions belong in `build`; only the width comes from the
    // layout callback.
    //
    // Pinned structurally rather than by pumping the whole conversation, which
    // needs a live session: no `ConsumerStatefulWidget` in the app may call
    // `ref.listen` from inside a builder that runs during layout.
    // Synchronous on purpose: `testWidgets` runs in a fake-async zone where a
    // real I/O future never completes, and the test simply hangs.
    final source = File(
      'lib/presentation/screens/conversation/conversation_screen.dart',
    ).readAsStringSync();
    final buildIndex = source.indexOf('Widget build(BuildContext context) {');
    final layoutIndex = source.indexOf('return LayoutBuilder(builder:');
    final listenIndex = source.indexOf('ref.listen(');

    expect(buildIndex, greaterThan(-1));
    expect(layoutIndex, greaterThan(-1));
    expect(
      listenIndex,
      allOf(greaterThan(buildIndex), lessThan(layoutIndex)),
      reason: 'ref.listen moved past the LayoutBuilder — it will throw at '
          'layout time, and only on the screen that opens a conversation',
    );
  });

  testWidgets('a wide window replaces the pane instead of stacking',
      (tester) async {
    // Found by walking the app, not here: with a permanent drawer, opening a
    // conversation, walking into its git screen and then picking ANOTHER
    // conversation used to push every time. Back then retraced every screen
    // ever glanced at, in an order matching nothing on screen — a stack the
    // layout gives you no way to see.
    late BuildContext captured;
    Widget probe(double width) {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      return MaterialApp(
        home: Builder(
          builder: (context) {
            captured = context;
            return const SizedBox.expand();
          },
        ),
      );
    }

    await tester.pumpWidget(probe(1280));
    expect(captured.hasPermanentPane, isTrue);

    await tester.pumpWidget(probe(390));
    await tester.pump();
    expect(
      captured.hasPermanentPane,
      isFalse,
      reason: 'a phone must still PUSH — there back really is somewhere else',
    );
  });

  testWidgets('everything the wide layout added leaves a phone alone',
      (tester) async {
    // The whole adaptive layer is opt-in by WIDTH, so the phone's behaviour is
    // the thing most likely to regress silently: the wide rules are the ones
    // being edited, and nothing on a phone announces when one leaks in.
    late BuildContext narrow;
    tester.view.physicalSize = const Size(390, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            narrow = context;
            return const SizedBox.expand();
          },
        ),
      ),
    );

    // No pane: so `openInPane` pushes, `closePane` pops, and the shell returns
    // the screen untouched. Each of those is asserted separately elsewhere;
    // this pins the ONE condition they all hang from.
    expect(narrow.hasPermanentPane, isFalse);
  });

  testWidgets('the drawer does not move when the content pane gets a keyboard',
      (tester) async {
    // Reported from a tablet: typing in the conversation made the profile row
    // slide down. The keyboard consumes the bottom padding for the WHOLE
    // window, so the drawer's SafeArea shrank even though the keyboard was
    // over the other half. A phone never showed it because a phone has no
    // drawer beside the keyboard.
    Future<double> footerTop({required double keyboard}) async {
      tester.view.physicalSize = const Size(1280, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            trustedDevicesProvider
                .overrideWith((ref) => Stream.value(const [])),
            connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
            threadsProvider.overrideWith((ref) => Stream.value(const [])),
          ],
          child: MediaQuery(
            data: MediaQueryData(
              size: const Size(1280, 900),
              padding: const EdgeInsets.only(bottom: 24),
              viewPadding: const EdgeInsets.only(bottom: 24),
              viewInsets: EdgeInsets.only(bottom: keyboard),
            ),
            child: const MaterialApp(
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: AppShell(
                location: AppRoutes.home,
                child: Text('routed screen'),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      return tester.getTopLeft(find.byType(ListTile)).dy;
    }

    final closed = await footerTop(keyboard: 0);
    final open = await footerTop(keyboard: 320);
    expect(
      open,
      closed,
      reason: 'the drawer shifted because the OTHER pane opened a keyboard',
    );
  });

  testWidgets('a deep raw stack is cleared, not just the top of it',
      (tester) async {
    // Git nests: conversation → git → history → commit detail, each a raw
    // `Navigator.push` landing above the routed page. Popping only the top
    // would leave the rest covering the pane, so picking another conversation
    // from the drawer would still look like nothing happened — just one screen
    // further in.
    tester.view.physicalSize = const Size(1280, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final key = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(
        home: Navigator(
          key: key,
          onGenerateRoute: (_) => MaterialPageRoute<void>(
            builder: (_) => const Text('conversation'),
          ),
        ),
      ),
    );

    for (final name in ['git', 'history', 'commit']) {
      unawaited(
        key.currentState!.push(
          MaterialPageRoute<void>(builder: (_) => Text(name)),
        ),
      );
      await tester.pumpAndSettle();
    }
    expect(key.currentState!.canPop(), isTrue);

    // What `openInPane` does before it navigates.
    while (key.currentState!.canPop()) {
      key.currentState!.pop();
    }
    await tester.pumpAndSettle();

    expect(key.currentState!.canPop(), isFalse);
    expect(find.text('conversation'), findsOneWidget);
    expect(find.text('commit'), findsNothing);
    expect(find.text('git'), findsNothing);
  });

  group('back from a screen stacked over the pane', () {
    // A folder's files and source control are routes of their own, opened two
    // ways: pushed over a conversation, or straight into the pane from a
    // folder row in the drawer. Back has to mean the right thing for both.
    Future<GoRouter> pumpRouter(WidgetTester tester, double width) async {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      Widget screen(String name) => Builder(
            builder: (context) => Column(
              children: [
                Text(name),
                TextButton(
                  onPressed: context.closePane,
                  child: Text('back from $name'),
                ),
              ],
            ),
          );
      final router = GoRouter(
        routes: [
          GoRoute(path: '/', builder: (_, __) => screen('home')),
          GoRoute(path: '/chat', builder: (_, __) => screen('chat')),
          GoRoute(path: '/git', builder: (_, __) => screen('git')),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        MaterialApp.router(
          routerConfig: router,
          builder: (context, child) => Material(child: child),
        ),
      );
      return router;
    }

    testWidgets('pops back to the conversation it was opened over',
        (tester) async {
      final router = await pumpRouter(tester, 1280);
      router.go('/chat');
      await tester.pumpAndSettle();
      unawaited(router.push<void>('/git'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('back from git'));
      await tester.pumpAndSettle();
      expect(find.text('chat'), findsOneWidget);

      // The conversation is the pane's first screen: back closes the pane.
      await tester.tap(find.text('back from chat'));
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
    });

    testWidgets('closes the pane when the drawer opened it there',
        (tester) async {
      final router = await pumpRouter(tester, 1280);
      router.go('/git');
      await tester.pumpAndSettle();

      await tester.tap(find.text('back from git'));
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
    });

    testWidgets('pops on a phone, one screen at a time', (tester) async {
      final router = await pumpRouter(tester, 390);
      unawaited(router.push<void>('/chat'));
      await tester.pumpAndSettle();
      unawaited(router.push<void>('/git'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('back from git'));
      await tester.pumpAndSettle();
      expect(find.text('chat'), findsOneWidget);
      await tester.tap(find.text('back from chat'));
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
    });
  });

  test('a folder route carries its path whole', () {
    // An absolute path is not a path segment; it travels as the query, and
    // has to come back out exactly as it went in.
    const cwd = '/Users/me/My Projects/app#2';
    final files = Uri.parse(AppRoutes.workspaceFiles(cwd, threadId: 't-1'));
    expect(files.path, AppRoutes.workspaceFilesPattern);
    expect(files.queryParameters['cwd'], cwd);
    expect(files.queryParameters['thread'], 't-1');

    final git = Uri.parse(AppRoutes.workspaceGit(cwd));
    expect(git.path, AppRoutes.workspaceGitPattern);
    expect(git.queryParameters['cwd'], cwd);
    expect(git.queryParameters.containsKey('thread'), isFalse);

    // Content, not a destination: it opens beside the drawer.
    expect(AppShell.isFullScreen(git.toString()), isFalse);
  });

  test('a destination stays full-screen while its children are open', () {
    // Settings' sections and profile's sub-screens are raw `Navigator.push`
    // routes: the LOCATION never changes while they are open. So the shell
    // must keep answering "full screen" for the whole visit, or a drawer would
    // reappear underneath a pushed section — and back from there would land on
    // a layout that was not there when you left it.
    expect(AppShell.isFullScreen(AppRoutes.settings), isTrue);
    expect(AppShell.isFullScreen(AppRoutes.profile), isTrue);
    // Rotation cannot change that answer either: it is decided by the route,
    // not the width. A section open in landscape is still a section in
    // portrait, and back still pops the stack that put it there.
  });

  test('destinations own the window; content shares it with the drawer', () {
    // Nothing to navigate to yet.
    expect(AppShell.isFullScreen(AppRoutes.onboarding), isTrue);
    expect(AppShell.isFullScreen(AppRoutes.pairing), isTrue);
    expect(AppShell.isFullScreen(AppRoutes.manualPairing), isTrue);

    // Destinations, not content: you WENT to them, and the conversation list
    // has no bearing on what they show. Settings splits into its own two
    // panes, so keeping the drawer would put three columns on a tablet.
    expect(AppShell.isFullScreen(AppRoutes.settings), isTrue);
    expect(AppShell.isFullScreen(AppRoutes.profile), isTrue);

    // Content: these ARE what you opened from the list, so the list stays.
    expect(AppShell.isFullScreen(AppRoutes.home), isFalse);
    expect(AppShell.isFullScreen('/conversation/x'), isFalse);
    expect(AppShell.isFullScreen('/device/mac-1/threads'), isFalse);
  });
}
