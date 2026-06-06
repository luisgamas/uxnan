import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/presentation/screens/home/home_screen.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_screen.dart';
import 'package:uxnan/presentation/screens/pairing/qr_scanner_screen.dart';
import 'package:uxnan/presentation/screens/shell/app_shell_screen.dart';

/// Route path constants used across the app.
///
/// Centralizing the literals avoids stringly-typed navigation and keeps the
/// full route table (spec 03-technical-reference.md section 3.2) discoverable.
class AppRoutes {
  const AppRoutes._();

  /// Home / empty-state route.
  static const String home = '/';

  /// Onboarding flow.
  static const String onboarding = '/onboarding';

  /// QR pairing flow.
  static const String pairing = '/pairing';
}

/// Provides the app's [GoRouter] instance.
///
/// The onboarding and pairing flows live outside the app shell; in-app screens
/// (conversation, settings, devices, projects, terminal) are added as their
/// modules are implemented. Keeping routing in this provider — never in
/// `main.dart` — follows the project's navigation convention.
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: AppRoutes.home,
    routes: [
      ShellRoute(
        builder: (context, state, child) => AppShellScreen(child: child),
        routes: [
          GoRoute(
            path: AppRoutes.home,
            builder: (context, state) => const HomeScreen(),
          ),
        ],
      ),
      GoRoute(
        path: AppRoutes.onboarding,
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: AppRoutes.pairing,
        builder: (context, state) => const QrScannerScreen(),
      ),
    ],
  );
});
