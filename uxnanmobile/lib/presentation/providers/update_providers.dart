import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/update_check_interval.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/infrastructure/storage/update_preferences_store.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';

/// Where the update checker is in its lifecycle.
enum AppUpdatePhase {
  /// No check has run yet this session.
  idle,

  /// A store check is in flight.
  checking,

  /// The last check found no newer version.
  upToDate,

  /// A newer version is available to install.
  available,

  /// A flexible update is downloading in the background (Android).
  downloading,

  /// A flexible update finished downloading and is ready to install (Android).
  downloaded,

  /// A flexible update is being installed (Android; the app will restart).
  installing,

  /// The last check (or an update start) failed.
  error,
}

/// Immutable state of the app-update checker.
class AppUpdateState extends Equatable {
  /// Creates an [AppUpdateState].
  const AppUpdateState({
    required this.phase,
    this.status,
    this.install,
    this.dismissedVersion,
    this.errorMessage,
    this.interval = UpdateCheckInterval.defaultInterval,
    this.starting = false,
  });

  /// The initial, nothing-checked-yet state.
  const AppUpdateState.idle()
      : phase = AppUpdatePhase.idle,
        status = null,
        install = null,
        dismissedVersion = null,
        errorMessage = null,
        interval = UpdateCheckInterval.defaultInterval,
        starting = false;

  /// The current lifecycle phase.
  final AppUpdatePhase phase;

  /// The latest check result, when one has completed.
  final AppUpdateStatus? status;

  /// The latest download/install progress (Android flexible flow), if any.
  final AppInstallProgress? install;

  /// The store version the user dismissed (banner suppression), if any.
  final String? dismissedVersion;

  /// A human-readable error from the last failed check / update start.
  final String? errorMessage;

  /// The chosen automatic check interval.
  final UpdateCheckInterval interval;

  /// Whether an update launch is currently in flight.
  final bool starting;

  /// Whether a newer version is available (available, or already
  /// downloading/downloaded/installing an accepted update).
  bool get hasUpdate {
    switch (phase) {
      case AppUpdatePhase.available:
      case AppUpdatePhase.downloading:
      case AppUpdatePhase.downloaded:
      case AppUpdatePhase.installing:
        return status?.updateAvailable ?? false;
      case AppUpdatePhase.idle:
      case AppUpdatePhase.checking:
      case AppUpdatePhase.upToDate:
      case AppUpdatePhase.error:
        return false;
    }
  }

  /// Whether the update banner should show. An available update is hidden once
  /// the user dismisses its exact store version; a download the user opted into
  /// (downloading/downloaded/installing) always shows.
  bool get bannerVisible {
    if (!hasUpdate) return false;
    if (phase != AppUpdatePhase.available) return true;
    final version = status?.storeVersion;
    return version == null || version != dismissedVersion;
  }

  /// Returns a copy with the given fields overridden. [clearError] drops the
  /// error message regardless of [errorMessage]; [clearInstall] drops the
  /// install progress.
  AppUpdateState copyWith({
    AppUpdatePhase? phase,
    AppUpdateStatus? status,
    AppInstallProgress? install,
    String? dismissedVersion,
    String? errorMessage,
    UpdateCheckInterval? interval,
    bool? starting,
    bool clearError = false,
    bool clearInstall = false,
  }) =>
      AppUpdateState(
        phase: phase ?? this.phase,
        status: status ?? this.status,
        install: clearInstall ? null : (install ?? this.install),
        dismissedVersion: dismissedVersion ?? this.dismissedVersion,
        errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
        interval: interval ?? this.interval,
        starting: starting ?? this.starting,
      );

  @override
  List<Object?> get props => [
        phase,
        status,
        install,
        dismissedVersion,
        errorMessage,
        interval,
        starting,
      ];
}

/// Drives the app-update checker: interval-throttled automatic checks, manual
/// checks, per-version dismissal, and the user-initiated download → install
/// flow (Play flexible on Android, App Store on iOS).
///
/// Enforces the *no silent install* policy — it only ever surfaces that an
/// update is available and applies one solely from an explicit user tap
/// ([startUpdate] / [download] / [install]).
class AppUpdateController extends Notifier<AppUpdateState> {
  StreamSubscription<AppInstallProgress>? _installSub;

  @override
  AppUpdateState build() {
    ref.onDispose(() {
      unawaited(_installSub?.cancel());
      _installSub = null;
    });
    unawaited(_loadInterval());
    return const AppUpdateState.idle();
  }

  Future<void> _loadInterval() async {
    final interval =
        await ref.read(updatePreferencesStoreProvider).readInterval();
    if (!ref.mounted || state.interval == interval) return;
    state = state.copyWith(interval: interval);
  }

  /// Runs an automatic check only when the chosen interval's gap has elapsed
  /// since the last one ([UpdateCheckInterval.everyLaunch] always checks). Safe
  /// to call on every launch / resume.
  ///
  /// An update that was already started bypasses the throttle entirely — see
  /// [_hasPendingUpdate].
  Future<void> maybeCheck() async {
    final store = ref.read(updatePreferencesStoreProvider);
    final interval = await store.readInterval();
    if (ref.mounted && state.interval != interval) {
      state = state.copyWith(interval: interval);
    }
    if (await _hasPendingUpdate(store)) {
      await check();
      return;
    }
    final gap = interval.minGap;
    if (gap > Duration.zero) {
      final last = await store.readLastCheck();
      if (last != null && DateTime.now().difference(last) < gap) return;
    }
    await check();
  }

  /// Whether an update this app already started may still be waiting in the
  /// store — live in this session, or recorded before the process restarted.
  ///
  /// Such an update must be re-read on **every** foreground, whatever the
  /// interval says: Play's contract is that a downloaded update is surfaced for
  /// install whenever the user brings the app forward, or its data just keeps
  /// occupying their storage. The interval governs how often we go looking for
  /// a *new* version — not whether we finish one the user already accepted.
  Future<bool> _hasPendingUpdate(UpdatePreferencesStore store) async {
    switch (state.phase) {
      case AppUpdatePhase.downloading:
      case AppUpdatePhase.downloaded:
      case AppUpdatePhase.installing:
        return true;
      case AppUpdatePhase.idle:
      case AppUpdatePhase.checking:
      case AppUpdatePhase.upToDate:
      case AppUpdatePhase.available:
      case AppUpdatePhase.error:
        return store.readUpdateStarted();
    }
  }

  /// Checks the store for a newer version now, regardless of the throttle.
  ///
  /// Doubles as the *resume* path for an update already in flight: Play, not
  /// this app, owns a flexible download, so a check re-reads its real stage and
  /// picks the flow back up wherever it actually is (see [_phaseFor]).
  Future<void> check() async {
    if (state.phase == AppUpdatePhase.checking) return;
    state = state.copyWith(phase: AppUpdatePhase.checking, clearError: true);

    final result = await ref.read(appUpdateServiceProvider).check();
    final store = ref.read(updatePreferencesStoreProvider);
    await store.writeLastCheck(DateTime.now());
    final dismissed = await store.readDismissedVersion();

    final phase = _phaseFor(result);
    final pending = phase == AppUpdatePhase.downloading ||
        phase == AppUpdatePhase.downloaded ||
        phase == AppUpdatePhase.installing;
    // Self-healing: the flag lives exactly as long as the store still reports
    // an update in progress, so a finished (or vanished) one stops bypassing
    // the interval on its own.
    await store.writeUpdateStarted(started: pending);
    if (!ref.mounted) return;

    // An update we already started lives in Play, not in this state object, so
    // re-attach to its progress: this process may never have seen the stream
    // (a relaunch), or may have missed the transition while backgrounded.
    if (pending) _listenInstallProgress();
    state = state.copyWith(
      phase: phase,
      status: result,
      dismissedVersion: dismissed,
      clearError: true,
      // Keep the download percentage across a mid-download re-check; anything
      // else starts from Play's own stage with no stale progress attached.
      clearInstall: phase != AppUpdatePhase.downloading,
    );
  }

  /// The phase a fresh [result] implies.
  ///
  /// A Play update can come back mid-flight — still downloading, or downloaded
  /// and waiting for the user's explicit install — because the download
  /// outlives the app that started it. Resuming it here is what keeps the flow
  /// finishable: dropping it to [AppUpdatePhase.available] would restart Play's
  /// flow instead of completing it, and reporting [AppUpdatePhase.upToDate]
  /// would strand a downloaded update with no way to install it from the app.
  static AppUpdatePhase _phaseFor(AppUpdateStatus result) {
    if (!result.updateAvailable) return AppUpdatePhase.upToDate;
    return switch (result.installStage) {
      AppInstallStage.downloading => AppUpdatePhase.downloading,
      AppInstallStage.downloaded => AppUpdatePhase.downloaded,
      AppInstallStage.installing => AppUpdatePhase.installing,
      // `failed`/`canceled` are offerable again from scratch; `installed` with
      // an update still outstanding, and `idle`, are a plain fresh update.
      AppInstallStage.failed ||
      AppInstallStage.canceled ||
      AppInstallStage.installed ||
      AppInstallStage.idle =>
        AppUpdatePhase.available,
    };
  }

  /// Dismisses the current update's store version so the banner stops showing
  /// for it (the settings card still reports it). A newer version re-surfaces.
  Future<void> dismiss() async {
    final version = state.status?.storeVersion;
    if (version == null) return;
    await ref
        .read(updatePreferencesStoreProvider)
        .writeDismissedVersion(version);
    if (!ref.mounted) return;
    state = state.copyWith(dismissedVersion: version);
  }

  /// Persists and applies the chosen automatic check [interval].
  Future<void> setInterval(UpdateCheckInterval interval) async {
    await ref.read(updatePreferencesStoreProvider).writeInterval(interval);
    if (!ref.mounted) return;
    state = state.copyWith(interval: interval);
  }

  /// Applies the primary action for the current phase from an explicit user
  /// tap: Android starts the flexible download (available) or install
  /// (downloaded); iOS presents the App Store page. Kept so existing callers
  /// keep working; UIs may also call [download] / [install] directly.
  Future<void> startUpdate() async {
    if (state.phase == AppUpdatePhase.downloaded) {
      await install();
      return;
    }
    await download();
  }

  /// Begins applying the available update. Android (flexible allowed): starts
  /// the background download and tracks its progress. iOS: presents the App
  /// Store product page. No-op when no update is available.
  Future<void> download() async {
    final status = state.status;
    if (status == null || !status.updateAvailable || state.starting) return;
    if (state.phase == AppUpdatePhase.downloading ||
        state.phase == AppUpdatePhase.downloaded ||
        state.phase == AppUpdatePhase.installing) {
      return;
    }

    final service = ref.read(appUpdateServiceProvider);
    switch (status.channel) {
      case UpdateChannel.playStore:
        if (!status.flexibleAllowed) return;
        state = state.copyWith(starting: true, clearError: true);
        _listenInstallProgress();
        state = state.copyWith(
          phase: AppUpdatePhase.downloading,
          starting: false,
        );
        final error = await service.startFlexibleDownload();
        if (error != null) {
          if (ref.mounted) {
            state = state.copyWith(
              phase: AppUpdatePhase.error,
              errorMessage: error,
              starting: false,
            );
          }
          return;
        }
        if (!ref.mounted) return;
        // Play accepted the download, and it now outlives this process — record
        // it before anything else can go wrong, so the next launch re-reads its
        // stage even if the app never sees the stream finish.
        await ref
            .read(updatePreferencesStoreProvider)
            .writeUpdateStarted(started: true);
      case UpdateChannel.appStore:
        state = state.copyWith(starting: true, clearError: true);
        await service.presentStore(
          appStoreId: status.appStoreId,
          storeUrl: status.storeUrl,
        );
        if (ref.mounted) state = state.copyWith(starting: false);
      case UpdateChannel.unsupported:
        break;
    }
  }

  /// Completes a downloaded update from an explicit user tap. Android: triggers
  /// the Play install (the app restarts). iOS: presents the App Store page.
  Future<void> install() async {
    final status = state.status;
    if (status == null) return;
    switch (status.channel) {
      case UpdateChannel.playStore:
        if (state.phase != AppUpdatePhase.downloaded) return;
        state = state.copyWith(
          phase: AppUpdatePhase.installing,
          clearError: true,
        );
        final error =
            await ref.read(appUpdateServiceProvider).completeFlexibleInstall();
        if (error != null && ref.mounted) {
          state = state.copyWith(
            phase: AppUpdatePhase.error,
            errorMessage: error,
          );
        }
      case UpdateChannel.appStore:
        await ref.read(appUpdateServiceProvider).presentStore(
              appStoreId: status.appStoreId,
              storeUrl: status.storeUrl,
            );
      case UpdateChannel.unsupported:
        break;
    }
  }

  /// Subscribes to Play's live install-state stream, once. Idempotent: a check
  /// re-attaches on every resume, and dropping/re-adding the underlying Play
  /// listener each time would risk missing the transition in between.
  void _listenInstallProgress() {
    if (_installSub != null) return;
    _installSub =
        ref.read(appUpdateServiceProvider).installProgress().listen((progress) {
      if (!ref.mounted) return;
      final phase = switch (progress.stage) {
        AppInstallStage.downloading => AppUpdatePhase.downloading,
        AppInstallStage.downloaded => AppUpdatePhase.downloaded,
        AppInstallStage.installing => AppUpdatePhase.installing,
        AppInstallStage.failed => AppUpdatePhase.error,
        AppInstallStage.canceled => AppUpdatePhase.error,
        AppInstallStage.installed => state.phase,
        AppInstallStage.idle => state.phase,
      };
      state = state.copyWith(phase: phase, install: progress);
    })
          ..onDone(() => _installSub = null);
  }
}

/// The app-update checker (interval-throttled auto-check + manual check +
/// dismissal + user-initiated download/install).
final appUpdateControllerProvider =
    NotifierProvider<AppUpdateController, AppUpdateState>(
  AppUpdateController.new,
);
