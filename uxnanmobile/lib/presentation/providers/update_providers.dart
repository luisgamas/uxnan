import 'package:equatable/equatable.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
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

  /// The last check (or an update start) failed.
  error,
}

/// Immutable state of the app-update checker.
class AppUpdateState extends Equatable {
  /// Creates an [AppUpdateState].
  const AppUpdateState({
    required this.phase,
    this.status,
    this.dismissedVersion,
    this.errorMessage,
    this.starting = false,
  });

  /// The initial, nothing-checked-yet state.
  const AppUpdateState.idle()
      : phase = AppUpdatePhase.idle,
        status = null,
        dismissedVersion = null,
        errorMessage = null,
        starting = false;

  /// The current lifecycle phase.
  final AppUpdatePhase phase;

  /// The latest check result, when one has completed.
  final AppUpdateStatus? status;

  /// The store version the user dismissed (banner suppression), if any.
  final String? dismissedVersion;

  /// A human-readable error from the last failed check / update start.
  final String? errorMessage;

  /// Whether an update launch is currently in flight.
  final bool starting;

  /// Whether a newer version is available to install.
  bool get hasUpdate =>
      phase == AppUpdatePhase.available && (status?.updateAvailable ?? false);

  /// Whether the "update available" banner should show: an update exists and
  /// the user hasn't dismissed this exact store version.
  bool get bannerVisible {
    if (!hasUpdate) return false;
    final version = status?.storeVersion;
    return version == null || version != dismissedVersion;
  }

  /// Returns a copy with the given fields overridden. [clearError] drops the
  /// error message regardless of [errorMessage].
  AppUpdateState copyWith({
    AppUpdatePhase? phase,
    AppUpdateStatus? status,
    String? dismissedVersion,
    String? errorMessage,
    bool? starting,
    bool clearError = false,
  }) =>
      AppUpdateState(
        phase: phase ?? this.phase,
        status: status ?? this.status,
        dismissedVersion: dismissedVersion ?? this.dismissedVersion,
        errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
        starting: starting ?? this.starting,
      );

  @override
  List<Object?> get props =>
      [phase, status, dismissedVersion, errorMessage, starting];
}

/// Drives the app-update checker: throttled automatic checks, manual checks,
/// per-version dismissal and the user-initiated update launch.
///
/// Enforces the *no silent install* policy — it only ever surfaces that an
/// update is available; [startUpdate] runs solely from an explicit user tap.
class AppUpdateController extends Notifier<AppUpdateState> {
  /// Minimum gap between automatic checks (manual checks ignore this).
  static const Duration minAutoCheckInterval = Duration(hours: 12);

  @override
  AppUpdateState build() => const AppUpdateState.idle();

  /// Runs an automatic check only when [minAutoCheckInterval] has elapsed
  /// since the last one. Safe to call on every launch / resume.
  Future<void> maybeCheck() async {
    final last = await ref.read(updatePreferencesStoreProvider).readLastCheck();
    if (last != null &&
        DateTime.now().difference(last) < minAutoCheckInterval) {
      return;
    }
    await check();
  }

  /// Checks the store for a newer version now, regardless of the throttle.
  Future<void> check() async {
    if (state.phase == AppUpdatePhase.checking) return;
    state = state.copyWith(phase: AppUpdatePhase.checking, clearError: true);

    final result = await ref.read(appUpdateServiceProvider).check();
    final store = ref.read(updatePreferencesStoreProvider);
    await store.writeLastCheck(DateTime.now());
    final dismissed = await store.readDismissedVersion();
    if (!ref.mounted) return;

    state = AppUpdateState(
      phase: result.updateAvailable
          ? AppUpdatePhase.available
          : AppUpdatePhase.upToDate,
      status: result,
      dismissedVersion: dismissed,
    );
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

  /// Applies the available update from an explicit user action: Android starts
  /// the Play In-App Update flow; iOS opens the App Store listing. No-op when
  /// no update is available.
  Future<void> startUpdate() async {
    final status = state.status;
    if (status == null || !status.updateAvailable || state.starting) return;

    state = state.copyWith(starting: true, clearError: true);
    final service = ref.read(appUpdateServiceProvider);
    try {
      switch (status.channel) {
        case UpdateChannel.playStore:
          final error = await service.startPlayUpdate();
          if (error != null && ref.mounted) {
            state = state.copyWith(
              phase: AppUpdatePhase.error,
              errorMessage: error,
              starting: false,
            );
            return;
          }
        case UpdateChannel.appStore:
          final url = status.storeUrl;
          if (url != null) await service.openStore(url);
        case UpdateChannel.unsupported:
          break;
      }
    } finally {
      if (ref.mounted && state.starting) {
        state = state.copyWith(starting: false);
      }
    }
  }
}

/// The app-update checker (throttled auto-check + manual check + dismissal +
/// user-initiated launch).
final appUpdateControllerProvider =
    NotifierProvider<AppUpdateController, AppUpdateState>(
  AppUpdateController.new,
);
