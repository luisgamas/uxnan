import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/presentation/screens/conversation/conversation_screen.dart';
import 'package:uxnan/presentation/screens/devices/my_devices_screen.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_screen.dart';
import 'package:uxnan/presentation/screens/pairing/manual_code_screen.dart';
import 'package:uxnan/presentation/screens/pairing/qr_scanner_screen.dart';
import 'package:uxnan/presentation/screens/settings/settings_screen.dart';
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

  /// Per-device threads screen path pattern (`:deviceId`).
  static const String deviceThreadsPattern = '/device/:deviceId/threads';

  /// Builds the threads route for the PC with [deviceId].
  static String deviceThreads(String deviceId) => '/device/$deviceId/threads';

  /// Per-device archived-threads screen path pattern (`:deviceId`).
  static const String deviceArchivedPattern = '/device/:deviceId/archived';

  /// Builds the archived-threads route for the PC with [deviceId].
  static String deviceArchived(String deviceId) => '/device/$deviceId/archived';

  /// Conversation screen path pattern (`:threadId`).
  static const String conversationPattern = '/conversation/:threadId';

  /// Builds the conversation route for [threadId].
  static String conversation(String threadId) => '/conversation/$threadId';
}

/// Provides the app's [GoRouter] instance.
///
/// All screens are flat top-level routes in a single navigator, so `push`
/// builds a linear back stack (devices → threads → conversation) and both the
/// AppBar back button and the OS back gesture pop one screen consistently. A
/// shell (sidebar/chrome) will return as a `StatefulShellRoute` when those
/// surfaces land. Keeping routing in this provider — never in `main.dart` —
/// follows the project's navigation convention.
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: AppRoutes.home,
    routes: [
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => const MyDevicesScreen(),
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
        path: AppRoutes.conversationPattern,
        builder: (context, state) => ConversationScreen(
          threadId: state.pathParameters['threadId']!,
        ),
      ),
    ],
  );
});
