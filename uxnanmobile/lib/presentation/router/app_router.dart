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

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: AppRoutes.home,
    routes: [
      ShellRoute(
        // Keyed so the pane can be EMPTIED from outside it. The conversation
        // opens its file browser and git screens with a raw `Navigator.push`,
        // which lands on this navigator, above the routed page — so `go` alone
        // changes the route underneath and leaves the pushed screen covering
        // it. Picking another conversation from the drawer then looked like
        // nothing happened at all.
        navigatorKey: shellNavigatorKey,
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
          GoRoute(
            path: AppRoutes.deviceThreadsPattern,
            builder: (context, state) => ThreadsScreen(
              deviceId: state.pathParameters['deviceId']!,
            ),
          ),
          GoRoute(
            path: AppRoutes.deviceArchivedPattern,
            builder: (context, state) => ArchivedThreadsScreen(
              deviceId: state.pathParameters['deviceId']!,
            ),
          ),
          GoRoute(
            path: AppRoutes.deviceStatsPattern,
            builder: (context, state) => PcDetailsScreen(
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
              threadId: state.pathParameters['threadId']!,
            ),
          ),
        ],
      ),
    ],
  );
});
