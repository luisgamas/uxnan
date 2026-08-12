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

    // The system-back answer wraps EVERY route — including the full-screen
    // ones, which used to return `child` bare. See [_SystemBack]: on Android
    // that bare return is what told the OS the app does not handle back at
    // all, and the OS then closed it instead of popping Settings.
    return _SystemBack(
      location: location,
      child: isFullScreen(location) ? child : _layout(context, ref, location),
    );
  }

  /// The routed screen, alone on a phone and beside the drawer on a window
  /// wide enough to hold one.
  Widget _layout(BuildContext context, WidgetRef ref, String location) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final breakpoint = UxnanBreakpoint.fromWidth(constraints.maxWidth);
        if (!breakpoint.usesPermanentPane) return child;

        // Published so the drawer's list can mark the row you are reading.
        // Beside a permanent drawer the list never leaves the screen, and a
        // list that never says which row is open makes you hold the answer in
        // your head.
        final open = threadIdOf(location);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          ref.read(openThreadProvider.notifier).set(open);
        });

        return TwoPaneScaffold(
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
        );
      },
    );
  }
}

/// The app's single answer to the OS back button and the back gesture.
///
/// It has to be a single one, and it has to be here, because of where the
/// router's own `Navigator` sits: [AppShell] wraps it, so this widget's
/// [PopScope] registers on the route **above** that navigator — the shell's
/// page in the root navigator. Two consequences drove every line below, and
/// both of them shipped as bugs.
///
/// **Android decides before it ever asks.** Predictive back reads
/// `SystemNavigator.setFrameworkHandlesBack`, which Flutter derives from the
/// last [NavigationNotification] to reach `WidgetsApp`. A route only emits one
/// when its pop entries change — and removing this [PopScope] (what the
/// full-screen routes did by returning `child` bare) emits `false`. From then
/// on the OS took back for itself: opening Settings from the overview and
/// pressing back CLOSED THE APP, while the app bar's own arrow — which pops
/// the navigator directly, never consulting the OS — kept working. Reaching
/// Settings from anywhere deeper hid it, because pushing onto an already-deep
/// stack changes nothing here and leaves the last notification saying `true`.
/// So the scope is now mounted on every route, at one fixed spot in the tree.
///
/// **The navigator underneath can contradict it.** It emits its own
/// notification on every history change, from below this widget, so it is
/// dispatched past the [PopScope] rather than through it — an ordinary
/// `Navigator` upgrades a `false` from its subtree to `true` when it can pop,
/// but nothing upgrades one that comes from a navigator *below* the route
/// answering for it. A pane opened with `go` leaves exactly one page, that one
/// page says "nothing to pop", and the tablet's own back handling was
/// overruled the same way. The listener here does what `Navigator` does with
/// its subtree: while back is ours to answer, a `false` from below is replaced
/// with the truth on its way up.
class _SystemBack extends StatelessWidget {
  const _SystemBack({required this.location, required this.child});

  /// The active route.
  final String location;

  final Widget child;

  /// Whether back is this app's to answer rather than the OS's.
  ///
  /// Everywhere except the overview: either there is a screen to pop, or
  /// there is a pane to empty / a parent to walk up to. At the overview there
  /// is genuinely nothing left, and back must leave the app like it does in
  /// every other Android app.
  bool get _ours => location != AppRoutes.home;

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_ours,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop || !_ours) return;
        // Reached only when the router chose the ROOT navigator, i.e. the
        // shell's stack had nothing to pop. Guarded anyway: a pop that IS
        // available is always the right answer, and never this fallback.
        final nested = shellNavigatorKey.currentState;
        if (nested != null && nested.canPop()) {
          nested.pop();
          return;
        }
        // Nothing was left behind. With a permanent drawer back CLOSES what is
        // open (the drawer, which never moved, is what remains); on a phone —
        // rotate a tablet with a conversation open and this is exactly where
        // you land — it walks the hierarchy the phone would have built.
        context.go(
          context.hasPermanentPane
              ? AppRoutes.home
              : parentOf(location, context),
        );
      },
      child: NotificationListener<NavigationNotification>(
        onNotification: (notification) {
          // Same rule `Navigator` applies to its own subtree: a subtree that
          // can handle a pop, or a state we are not answering for, passes
          // through untouched.
          if (notification.canHandlePop || !_ours) return false;
          // Dispatched from THIS context — above the listener, so it does not
          // come back around — exactly as `Navigator` re-dispatches.
          const NavigationNotification(canHandlePop: true).dispatch(context);
          return true;
        },
        child: child,
      ),
    );
  }
}
