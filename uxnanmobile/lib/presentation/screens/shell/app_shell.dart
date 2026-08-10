import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/presentation/providers/open_thread_provider.dart';
import 'package:uxnan/presentation/providers/shell_device_provider.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/screens/shell/app_shell_screen.dart';
import 'package:uxnan/presentation/screens/shell/nav_drawer.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';

/// What wraps every routed screen: nothing on a phone, a permanent drawer on a
/// window wide enough to hold one.
///
/// **On compact and medium it is a pass-through.** Not "a drawer that hides" —
/// literally `child`, unchanged, so the screen stack that exists today keeps
/// working exactly as it does, including its back behaviour. A phone gets no
/// new layer to go wrong.
///
/// On expanded and above the app stops being a stack of screens: the drawer
/// holds the PC and its work, and the routed screen becomes the content beside
/// it. The route table does not change — the same routes render in a different
/// place — which is what keeps deep links, push notifications and `context.go`
/// working without a second navigation model.
class AppShell extends ConsumerWidget {
  /// Creates an [AppShell] around [child].
  const AppShell({required this.child, this.location, super.key});

  /// The routed screen.
  final Widget child;

  /// The active route, for tests. In the app it comes from the router.
  final String? location;

  /// Routes that must never sit beside a drawer.
  ///
  /// Two different reasons, and both end in the same place:
  ///
  /// - **Onboarding and pairing** have nothing to navigate *to* yet. A drawer
  ///   beside them is furniture around an empty room, and in pairing's case it
  ///   would offer to switch to a PC you are in the middle of adding.
  /// - **Settings and profile are destinations, not content.** They are not
  ///   "what you opened from the list" — you went to them, and the list has no
  ///   bearing on what they show. Settings splits internally into its own two
  ///   panes, so leaving the drawer up would put THREE columns on a tablet: a
  ///   list of conversations that cannot change anything on screen, beside a
  ///   list of sections, beside a section.
  static bool isFullScreen(String location) =>
      location.startsWith(AppRoutes.onboarding) ||
      location.startsWith(AppRoutes.pairing) ||
      location.startsWith(AppRoutes.settings) ||
      location.startsWith(AppRoutes.profile);

  /// The thread being read, if the content pane is a conversation — the
  /// drawer asks it which PC to show.
  static String? threadIdOf(String location) {
    const prefix = '/conversation/';
    if (!location.startsWith(prefix)) return null;
    final rest = location.substring(prefix.length);
    final end = rest.indexOf('/');
    final id = end == -1 ? rest : rest.substring(0, end);
    return id.isEmpty ? null : id;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = this.location ?? GoRouterState.of(context).uri.path;
    if (isFullScreen(location)) return child;

    return LayoutBuilder(
      builder: (context, constraints) {
        final breakpoint = UxnanBreakpoint.fromWidth(constraints.maxWidth);
        if (!breakpoint.usesPermanentPane) {
          // Narrow, but the route may have been REPLACED while the window was
          // wide — rotate a tablet with a conversation open and the phone
          // layout inherits a stack of exactly one page. Back would leave the
          // app from a screen you reached by tapping into it, which no phone
          // does. So back walks the hierarchy the phone would have built.
          return PopScope(
            canPop: location == AppRoutes.home,
            onPopInvokedWithResult: (didPop, _) {
              if (didPop || location == AppRoutes.home) return;
              if (Navigator.of(context).canPop()) return;
              context.go(parentOf(location, context));
            },
            child: child,
          );
        }

        // Published so the drawer's list can mark the row you are reading.
        // Beside a permanent drawer the list never leaves the screen, and a
        // list that never says which row is open makes you hold the answer in
        // your head.
        final open = threadIdOf(location);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          ref.read(openThreadProvider.notifier).set(open);
        });

        return PopScope(
          // With a drawer up, back must empty the CONTENT, not the app. A deep
          // link (a push notification) arrives with nothing behind it, so the
          // route stack cannot pop — and without this the first back press on
          // a tablet closes an app that is visibly full of your work.
          canPop: location == AppRoutes.home,
          onPopInvokedWithResult: (didPop, _) {
            if (didPop || location == AppRoutes.home) return;
            context.go(AppRoutes.home);
          },
          child: TwoPaneScaffold(
            pane: NavDrawer(
              deviceId: ref.watch(shellDeviceProvider(threadIdOf(location))),
            ),
            // ALWAYS `child`, on every route and every width.
            //
            // `child` is not just the screen — it is the router's own
            // `Navigator`, the one carrying [shellNavigatorKey]. Swapping it
            // for another widget (the root used to get [ShellWelcome] here)
            // unmounts that navigator, and `GoRouterDelegate.popRoute` walks
            // every shell match dereferencing `navigatorKey.currentState!`.
            // The OS back button then threw a null-check error instead of
            // going back — on a tablet sitting at the overview, which is where
            // it starts. What the root shows is the ROUTE's business, and
            // [AppRoutes.home] answers it (see `app_router.dart`).
            detail: child,
          ),
        );
      },
    );
  }
}
