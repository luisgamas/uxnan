import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/push_registrar.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';
import 'package:uxnan/presentation/widgets/uxnan_splash.dart';

/// Root widget of the Uxnan app.
///
/// Wires Material 3, the adaptive light/dark theme, the GoRouter instance and
/// localization. Theme and routing live in dedicated modules — never in
/// `main.dart` — per the project conventions. See spec 03 section 3.2.
class UxnanApp extends ConsumerStatefulWidget {
  /// Creates the root app widget.
  const UxnanApp({super.key});

  @override
  ConsumerState<UxnanApp> createState() => _UxnanAppState();
}

class _UxnanAppState extends ConsumerState<UxnanApp> {
  /// Completes once the first frame after the router is mounted has been
  /// rendered — drives the in-Flutter splash overlay dismissal (see
  /// [UxnanSplash]).
  final Completer<void> _firstFrame = Completer<void>();

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);
    // Effective mode: the user's choice for brand/dual themes, but forced to a
    // single-brightness custom theme's own side so it can't be hidden behind a
    // mismatched System/OS brightness.
    final themeMode = ref.watch(effectiveThemeModeProvider);
    final locale = ref.watch(localeSettingProvider);
    final themeSource = ref.watch(themeSourceSettingProvider);
    final customTheme = ref.watch(customThemeSettingProvider);

    return MaterialApp.router(
      title: 'Uxnan',
      debugShowCheckedModeBanner: false,
      theme: buildUxnanTheme(
        brightness: Brightness.light,
        themeSource: themeSource,
        customTheme: customTheme,
      ),
      darkTheme: buildUxnanTheme(
        brightness: Brightness.dark,
        themeSource: themeSource,
        customTheme: customTheme,
      ),
      themeMode: themeMode,
      locale: locale,
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => _AppShell(
        firstFrame: _firstFrame,
        child: child ?? const SizedBox(),
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    // After the first frame is laid out (router mounted, themes applied), the
    // in-Flutter splash overlay can dismiss and hand off to the real UI.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_firstFrame.isCompleted) _firstFrame.complete();
    });
  }
}

/// Composes the router output with [_PushHost] (which keeps the push
/// registrar alive + handles notification deep-links) and the brand splash
/// overlay ([UxnanSplash]). The overlay is mounted on top of everything via
/// a [Stack] and removes itself once the first frame has rendered, so it
/// adds zero interaction surface once dismissed.
class _AppShell extends ConsumerWidget {
  const _AppShell({required this.child, required this.firstFrame});

  final Widget child;
  final Completer<void> firstFrame;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Stack(
      children: [
        _PushHost(child: child),
        // The splash is the brand's hand-off from the native launch screen;
        // it lives above the router output and removes itself once dismissed.
        UxnanSplash(
          assetPath: 'assets/images/logo_nb.svg',
          onReady: () async {
            await firstFrame.future;
          },
        ),
      ],
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
      if (mounted && threadId != null) _openThread(threadId);
      // Reconnect to the last-used PC so reopening the app (incl. after an
      // unexpected close) restores the bridge session + history automatically.
      unawaited(_autoConnectLastDevice());
      // Throttled check for a newer app version (Play In-App Update / App
      // Store). Best-effort and guarded — no-op off a real store.
      unawaited(ref.read(appUpdateControllerProvider.notifier).maybeCheck());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    // The user may have signed an agent in/out on the PC while we were away;
    // re-query auth/status on resume so a stale "not signed in" state clears.
    ref.read(authStatusRefreshProvider.notifier).bump();
    // The OS may have suspended/dropped the bridge socket while backgrounded.
    // Ensure the connection is healthy again (reconnect now if it dropped or a
    // backoff was pending) and re-sync the open conversation so messages that
    // landed while away appear without leaving + re-entering it.
    unawaited(ref.read(sessionCoordinatorProvider).resume());
    unawaited(ref.read(threadManagerProvider).resyncActive());
    // A store release may have shipped while we were backgrounded; re-check
    // (throttled, so frequent resumes don't spam the store).
    unawaited(ref.read(appUpdateControllerProvider.notifier).maybeCheck());
  }

  /// Best-effort cold-start reconnect to the most-recently-connected trusted PC
  /// (by `lastSeen`, falling back to pairing time). No-op when there are no
  /// paired devices or a session is already active (e.g. a deep link beat us).
  Future<void> _autoConnectLastDevice() async {
    final coordinator = ref.read(sessionCoordinatorProvider);
    if (coordinator.activeMac != null || coordinator.connectedDevice != null) {
      return;
    }
    final devices =
        await ref.read(trustedDeviceRepositoryProvider).getDevices();
    if (devices.isEmpty) return;
    final device = devices.reduce(
      (a, b) => _recency(a).isAfter(_recency(b)) ? a : b,
    );
    coordinator.setActiveDevice(device);
    try {
      await coordinator.connect();
    } on Object catch (error, stackTrace) {
      // First attempt failed (PC asleep / off-network) — hand off to the
      // backoff reconnect loop instead of leaving it stuck.
      AppLogger.warn('cold-start auto-connect failed', error, stackTrace);
      unawaited(coordinator.handleReconnect());
    }
  }

  /// Recency key for picking the last-used device.
  DateTime _recency(TrustedDevice device) => device.lastSeen ?? device.pairedAt;

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
    // Keep the bridge-owned metrics controller alive from startup. It watches
    // connectedDeviceProvider, so every successful (re)connection immediately
    // rehydrates and persists that PC's complete ledger snapshot even when the
    // user has not opened Profile yet.
    ref.watch(metricsSnapshotsProvider);
    final l10n = AppLocalizations.of(context);
    registrar.strings = PushNotificationStrings(
      turnCompletedBody: l10n.pushTurnCompletedBody,
      turnErrorBody: l10n.pushTurnErrorBody,
      fallbackTitle: l10n.pushFallbackTitle,
    );
    return widget.child;
  }
}
