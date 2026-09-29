import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/screens/conversation/conversation_screen.dart';
import 'package:uxnan/presentation/screens/devices/my_devices_screen.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_screen.dart';
import 'package:uxnan/presentation/screens/pairing/manual_code_screen.dart';
import 'package:uxnan/presentation/screens/pairing/qr_scanner_screen.dart';
import 'package:uxnan/presentation/screens/profile/pc_details_screen.dart';
import 'package:uxnan/presentation/screens/profile/profile_screen.dart';
import 'package:uxnan/presentation/screens/settings/settings_screen.dart';
import 'package:uxnan/presentation/screens/shell/app_shell.dart';
import 'package:uxnan/presentation/screens/shell/shell_welcome.dart';
import 'package:uxnan/presentation/screens/threads/archived_threads_screen.dart';
import 'package:uxnan/presentation/screens/threads/threads_screen.dart';
import 'package:uxnan/presentation/screens/workspace/files/file_browser_screen.dart';
import 'package:uxnan/presentation/screens/workspace/git/git_screen.dart';

/// Route path constants used across the app.
///
/// Centralizing the literals avoids stringly-typed navigation and keeps the
/// full route table (spec 03-technical-reference.md section 3.2) discoverable.
class AppRoutes {
  const AppRoutes._();

  /// Home: the paired-devices list (empty state until a PC is paired).
  static const String home = '/';

  /// Onboarding flow.
  static const String onboarding = '/onboarding';

  /// QR pairing flow.
  static const String pairing = '/pairing';

  /// Manual-code pairing flow (type a host + short code instead of scanning).
  static const String manualPairing = '/pairing/manual';

  /// App settings (notification preferences, …).
  static const String settings = '/settings';

  /// The user's aggregate activity profile (metrics across all PCs).
  static const String profile = '/profile';

  /// Per-device threads screen path pattern (`:deviceId`).
  static const String deviceThreadsPattern = '/device/:deviceId/threads';

  /// Builds the threads route for the PC with [deviceId].
  static String deviceThreads(String deviceId) => '/device/$deviceId/threads';

  /// Per-device archived-threads screen path pattern (`:deviceId`).
  static const String deviceArchivedPattern = '/device/:deviceId/archived';

  /// Builds the archived-threads route for the PC with [deviceId].
  static String deviceArchived(String deviceId) => '/device/$deviceId/archived';

  /// Per-device metrics ("statistics") screen path pattern (`:deviceId`).
  static const String deviceStatsPattern = '/device/:deviceId/stats';

  /// Builds the per-PC statistics route for the PC with [deviceId].
  static String deviceStats(String deviceId) => '/device/$deviceId/stats';

  /// Conversation screen path pattern (`:threadId`).
  static const String conversationPattern = '/conversation/:threadId';

  /// Builds the conversation route for [threadId].
  static String conversation(String threadId) => '/conversation/$threadId';

  /// A working folder's file browser. The folder travels as the `cwd` query
  /// parameter — an absolute path is not a path segment.
  static const String workspaceFilesPattern = '/workspace/files';

  /// A working folder's source control screen, addressed like
  /// [workspaceFilesPattern].
  static const String workspaceGitPattern = '/workspace/git';

  /// Builds the file-browser route for the folder at [cwd]. [threadId] names
  /// the conversation it was opened from, when there is one.
  static String workspaceFiles(String cwd, {String? threadId}) =>
      _workspace(workspaceFilesPattern, cwd, threadId);

  /// Builds the source-control route for the folder at [cwd]. [threadId]
  /// names the conversation it was opened from, when there is one — the git
  /// screen records its actions against it and offers removing its worktree.
  static String workspaceGit(String cwd, {String? threadId}) =>
      _workspace(workspaceGitPattern, cwd, threadId);

  static String _workspace(String path, String cwd, String? threadId) => Uri(
        path: path,
        queryParameters: {'cwd': cwd, if (threadId != null) 'thread': threadId},
      ).toString();
}

/// Provides the app's [GoRouter] instance.
///
/// The route table stays **flat**: every screen is a top-level route in one
/// navigator, so `push` builds a linear back stack (devices → threads →
/// conversation) and both the AppBar back button and the OS back gesture pop
/// one screen consistently.
///
/// A single [ShellRoute] wraps all of them in [AppShell]. That is deliberately
/// the *only* structural change for wide windows: the same routes render in the
/// same order, and the shell decides whether the screen is the whole window or
/// the pane beside a drawer. Anything else — a second navigator, a branch per
/// pane — would give tablets their own navigation model to keep in step with
/// the phone's, and every deep link and push notification would have to work in
/// both. Keeping routing in this provider — never in `main.dart` — follows the
/// project's navigation convention.
/// The navigator that holds whatever the content pane is showing.
///
/// Exposed so [PaneNavigation] can clear it: see the note on the [ShellRoute]
/// below.
final GlobalKey<NavigatorState> shellNavigatorKey =
    GlobalKey<NavigatorState>(debugLabel: 'shell');

/// Tells a screen in the content pane when another is pushed over it and when
/// it is back in front.
///
/// A conversation needs it: the thread manager shows ONE conversation, and a
/// conversation left underneath another (a notification's, a fork) has to
/// take it back when it returns to the front.
final RouteObserver<ModalRoute<void>> paneRouteObserver =
    RouteObserver<ModalRoute<void>>();

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: AppRoutes.home,
    routes: [
      ShellRoute(
        // Keyed so the pane can be EMPTIED from outside it. The workspace
        // screens open their own children (a file, the commit history) with a
        // raw `Navigator.push`, which lands on this navigator, above the routed
        // page — so `go` alone changes the route underneath and leaves the
        // pushed screen covering it. Picking another conversation from the
        // drawer then looked like nothing happened at all.
        navigatorKey: shellNavigatorKey,
        observers: [paneRouteObserver],
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: AppRoutes.home,
            // The root is the one route that renders differently in each
            // layout. On a phone it IS the overview. Beside a permanent drawer
            // the drawer already shows your PCs and their work, so repeating
            // the overview would say the same thing twice and give the eye no
            // reason to prefer either half — the content pane stays quiet
            // until something is opened into it.
            //
            // This lives HERE, not in the shell, because the shell must never
            // remove `child` from the tree: `child` is the navigator behind
            // [shellNavigatorKey], and unmounting it breaks the OS back button
            // for the whole app (see the note on `detail:` in `AppShell`).
            builder: (context, state) => context.hasPermanentPane
                ? const ShellWelcome()
                : const MyDevicesScreen(),
          ),
          // EVERY parameterised route below keys its screen by the parameter.
          //
          // go_router derives a page's key from the route **pattern**, not from
          // the location it matched: `pageKey: ValueKey(newMatchedPath)` where
          // `newMatchedPath` is `/conversation/:threadId`, the same string for
          // every thread. So replacing `/conversation/a` with `/conversation/b`
          // hands Flutter the same page, and the element — and with it the
          // `State` — is REUSED. `initState` never runs again.
          //
          // That is invisible while every screen is pushed, which is what a
          // phone does. Beside a permanent drawer opening REPLACES the pane
          // (`openInPane`), and the reuse showed up as the app bar changing to
          // the conversation you picked while the body kept rendering the
          // previous one — and worse, the ThreadManager was never told to
          // switch, so streaming deltas (which do not all carry a threadId)
          // kept being attributed to the thread you had left.
          //
          // A `ValueKey` on the built widget makes a different parameter a
          // different element, so the whole per-parameter setup —
          // subscriptions, the foreground marker, scroll position, drafts — is
          // rebuilt exactly as it is on a phone. Keying is deliberately
          // preferred over a `didUpdateWidget` in each screen: it needs no
          // screen to remember to re-do its own `initState`, and none to be
          // audited again when a new per-parameter field is added.
          GoRoute(
            path: AppRoutes.deviceThreadsPattern,
            builder: (context, state) => ThreadsScreen(
              key: ValueKey(state.pathParameters['deviceId']),
              deviceId: state.pathParameters['deviceId']!,
            ),
          ),
          GoRoute(
            path: AppRoutes.deviceArchivedPattern,
            builder: (context, state) => ArchivedThreadsScreen(
              key: ValueKey(state.pathParameters['deviceId']),
              deviceId: state.pathParameters['deviceId']!,
            ),
          ),
          GoRoute(
            path: AppRoutes.deviceStatsPattern,
            builder: (context, state) => PcDetailsScreen(
              key: ValueKey(state.pathParameters['deviceId']),
              deviceId: state.pathParameters['deviceId']!,
            ),
          ),
          GoRoute(
            path: AppRoutes.onboarding,
            builder: (context, state) => const OnboardingScreen(),
          ),
          GoRoute(
            path: AppRoutes.pairing,
            builder: (context, state) => const QrScannerScreen(),
          ),
          GoRoute(
            path: AppRoutes.manualPairing,
            builder: (context, state) => const ManualCodeScreen(),
          ),
          GoRoute(
            path: AppRoutes.settings,
            builder: (context, state) => const SettingsScreen(),
          ),
          GoRoute(
            path: AppRoutes.profile,
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: AppRoutes.conversationPattern,
            builder: (context, state) => ConversationScreen(
              key: ValueKey(state.pathParameters['threadId']),
              threadId: state.pathParameters['threadId']!,
            ),
          ),
          // A folder's files and source control are the FOLDER's, not a
          // conversation's: a project row opens them as readily as a thread
          // does. Routes rather than raw pushes so both callers reach them the
          // same way — pushed over a conversation, or into the pane from the
          // permanent drawer, where a raw push would land on the root
          // navigator and cover the whole window. Keyed by the query for the
          // same reason every parameterised route above is keyed.
          GoRoute(
            path: AppRoutes.workspaceFilesPattern,
            redirect: _requireCwd,
            builder: (context, state) => FileBrowserScreen(
              key: ValueKey(state.uri.query),
              cwd: state.uri.queryParameters['cwd']!,
              threadId: state.uri.queryParameters['thread'],
            ),
          ),
          GoRoute(
            path: AppRoutes.workspaceGitPattern,
            redirect: _requireCwd,
            builder: (context, state) => GitScreen(
              key: ValueKey(state.uri.query),
              cwd: state.uri.queryParameters['cwd']!,
              threadId: state.uri.queryParameters['thread'],
            ),
          ),
        ],
      ),
    ],
  );
});

/// Sends a folder route that names no folder back to the overview — nothing
/// the app builds lacks one, so only a mangled link can get here.
String? _requireCwd(BuildContext context, GoRouterState state) {
  final cwd = state.uri.queryParameters['cwd'];
  return cwd == null || cwd.isEmpty ? AppRoutes.home : null;
}
