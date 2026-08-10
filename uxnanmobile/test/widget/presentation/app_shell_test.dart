import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
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

  testWidgets('at the root the content pane stays quiet', (tester) async {
    await pump(tester, width: 1280, location: AppRoutes.home);

    // The drawer is already showing the PCs and their work; repeating the
    // overview beside it would say the same thing twice and give the eye no
    // reason to prefer either half.
    expect(find.byType(NavDrawer), findsOneWidget);
    expect(find.byType(ShellWelcome), findsOneWidget);
    expect(find.text('routed screen'), findsNothing);
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

  test('a conversation belongs to its PC, everything else to the overview', () {
    // What "up" means with nothing to pop. Rotating a tablet with a
    // conversation open is the case that creates it: the wide layout REPLACED
    // routes, so the narrow one inherits a stack of exactly one page and both
    // the system gesture and the bar's arrow had nothing to act on. The arrow
    // simply did nothing, which reads as broken rather than as a dead end.
    expect(AppShell.threadIdOf('/conversation/abc'), 'abc');
    // The resolution itself needs a ProviderScope, so what is pinned here is
    // the rule it encodes: only a conversation has a parent worth guessing.
    expect(AppShell.threadIdOf(AppRoutes.settings), isNull);
    expect(AppShell.threadIdOf(AppRoutes.home), isNull);
  });

  test('the conversation route names the thread the drawer follows', () {
    // A push notification opens `/conversation/:id` with nothing behind it.
    // Without this the drawer has no PC to show and comes up blank — in
    // exactly the case a tablet user is most likely to meet first.
    expect(AppShell.threadIdOf('/conversation/abc123'), 'abc123');
    expect(AppShell.threadIdOf('/conversation/abc123/files'), 'abc123');
    expect(AppShell.threadIdOf('/'), isNull);
    expect(AppShell.threadIdOf('/device/mac-1/threads'), isNull);
    expect(AppShell.threadIdOf('/conversation/'), isNull);
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
