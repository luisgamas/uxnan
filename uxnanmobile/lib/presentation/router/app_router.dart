import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/presentation/screens/home/home_screen.dart';
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
/// Only the routes whose screens already exist are wired here; additional
/// routes (conversation, settings, devices, projects, terminal, onboarding,
/// pairing) are added as their modules are implemented. Keeping routing in this
/// provider — never in `main.dart` — follows the project's navigation
/// convention.
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
    ],
  );
});
