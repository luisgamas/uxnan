import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/push_registrar.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';

/// Root widget of the Uxnan app.
///
/// Wires Material 3, the adaptive light/dark theme, the GoRouter instance and
/// localization. Theme and routing live in dedicated modules — never in
/// `main.dart` — per the project conventions. See spec 03 section 3.2.
class UxnanApp extends ConsumerWidget {
  /// Creates the root app widget.
  const UxnanApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: 'Uxnan',
      debugShowCheckedModeBanner: false,
      theme: buildUxnanTheme(brightness: Brightness.light),
      darkTheme: buildUxnanTheme(),
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => _PushHost(child: child ?? const SizedBox()),
    );
  }
}

/// Keeps the [PushRegistrar] alive for the whole app lifetime, feeds it
/// localized notification copy, and deep-links notification taps to the
/// matching conversation.
///
/// Mounted under `MaterialApp` (via its `builder`) so a localized
/// [AppLocalizations] context is available. Push init is best-effort and
/// non-blocking; this widget only renders [child].
class _PushHost extends ConsumerStatefulWidget {
  const _PushHost({required this.child});

  final Widget child;

  @override
  ConsumerState<_PushHost> createState() => _PushHostState();
}

class _PushHostState extends ConsumerState<_PushHost>
    with WidgetsBindingObserver {
  StreamSubscription<String>? _tapSub;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Eager-load the saved notification preferences at startup so they're
    // hydrated from disk well before any PC connection — the registrar then
    // sends the user's choices (not the defaults) on the first
    // `notifications/register`.
    ref.read(notificationPreferencesProvider);
    final registrar = ref.read(pushRegistrarProvider);
    // Taps while the app is alive or resumed from the background.
    _tapSub = registrar.onNotificationTap.listen(_openThread);
    // Cold start: if a tapped notification launched the app, deep-link once the
    // first frame is laid out (so the router is mounted).
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final threadId = await registrar.initialThreadId();
      if (!mounted || threadId == null) return;
      _openThread(threadId);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The user may have signed an agent in/out on the PC while we were away;
    // re-query auth/status on resume so a stale "not signed in" state clears.
    if (state == AppLifecycleState.resumed) {
      ref.read(authStatusRefreshProvider.notifier).bump();
    }
  }

  void _openThread(String threadId) {
    if (threadId.isEmpty) return;
    unawaited(
      ref.read(appRouterProvider).push(AppRoutes.conversation(threadId)),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tapSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Instantiate and keep the registrar alive for the app's lifetime.
    final registrar = ref.watch(pushRegistrarProvider);
    final l10n = AppLocalizations.of(context);
    registrar.strings = PushNotificationStrings(
      turnCompletedBody: l10n.pushTurnCompletedBody,
      turnErrorBody: l10n.pushTurnErrorBody,
      fallbackTitle: l10n.pushFallbackTitle,
    );
    return widget.child;
  }
}
