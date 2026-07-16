import 'package:equatable/equatable.dart';
import 'package:flutter/foundation.dart';

/// Which platform update mechanism a check ran against.
enum UpdateChannel {
  /// Google Play In-App Updates (Android). The update is applied through
  /// Play's own flow, so no store URL is needed.
  playStore,

  /// Apple App Store version lookup (iOS). The update is applied by presenting
  /// the App Store product page ([AppUpdateStatus.appStoreId]) via StoreKit,
  /// or by opening [AppUpdateStatus.storeUrl] as a fallback.
  appStore,

  /// No in-app update mechanism applies on this platform (web/desktop or a
  /// build not installed from a store). Always a "no update" result.
  unsupported,
}

/// Platform-agnostic outcome of an app-update check.
///
/// The infrastructure layer ([`AppUpdateService`]) produces this from either
/// the Play In-App Update API (Android) or the iTunes App Store lookup (iOS),
/// so the presentation layer can render a banner / settings card without
/// knowing which mechanism ran. A [policy of *no silent install*] is honoured:
/// this object only ever reports that an update *is available*; applying it is
/// always a user-initiated action.
class AppUpdateStatus extends Equatable {
  /// Creates an [AppUpdateStatus].
  const AppUpdateStatus({
    required this.channel,
    required this.updateAvailable,
    this.localVersion,
    this.storeVersion,
    this.storeUrl,
    this.releaseNotes,
    this.appStoreId,
    this.flexibleAllowed = false,
    this.installStage = AppInstallStage.idle,
  });

  /// A "no update / not applicable" result for [channel]. Used as the guarded
  /// fallback whenever a check cannot run (plugin missing, offline, the build
  /// was not installed from a store, or the platform is unsupported).
  const AppUpdateStatus.none(this.channel)
      : updateAvailable = false,
        localVersion = null,
        storeVersion = null,
        storeUrl = null,
        releaseNotes = null,
        appStoreId = null,
        flexibleAllowed = false,
        installStage = AppInstallStage.idle;

  /// The mechanism this result came from.
  final UpdateChannel channel;

  /// Whether a newer version is available to install.
  final bool updateAvailable;

  /// The installed version (e.g. `0.0.1`), when the platform reports it.
  final String? localVersion;

  /// The available version: the App Store version string on iOS, or the Play
  /// available version code (as a string) on Android. Doubles as the key the
  /// user can "dismiss" so the banner stops nagging for that exact version.
  final String? storeVersion;

  /// The store deep-link to open (App Store listing on iOS). Null on Android —
  /// the Play In-App Update flow needs no URL.
  final String? storeUrl;

  /// The store's release notes for the new version, when available (iOS).
  final String? releaseNotes;

  /// iOS only: the numeric App Store id (from the iTunes lookup `trackId`),
  /// used to present the StoreKit product-page overlay. Null on Android.
  final String? appStoreId;

  /// Android only: Play reports a *flexible* update flow is allowed.
  final bool flexibleAllowed;

  /// Android only: the stage of an update this app has **already started**, as
  /// Play itself reports it (`AppUpdateInfo.installStatus`).
  ///
  /// This is what makes a flexible update survivable. Play owns the download,
  /// not us: it keeps running while the app is backgrounded or killed, so the
  /// live install-state stream can miss the transition that matters. Reading
  /// the stage back from Play on every check is the documented way to recover
  /// an update that is [AppInstallStage.downloaded] and waiting for the user's
  /// explicit install — otherwise the downloaded APK just occupies the user's
  /// storage forever, uninstallable from inside the app.
  ///
  /// [AppInstallStage.idle] whenever no update is in progress, and always off
  /// Android (the App Store applies its own updates).
  final AppInstallStage installStage;

  @override
  List<Object?> get props => [
        channel,
        updateAvailable,
        localVersion,
        storeVersion,
        storeUrl,
        releaseNotes,
        appStoreId,
        flexibleAllowed,
        installStage,
      ];
}

/// The stage of an in-progress flexible (background-download) update on
/// Android, mapped from the plugin's install-state stream.
enum AppInstallStage {
  /// No install is in progress.
  idle,

  /// The update is downloading in the background.
  downloading,

  /// The update finished downloading and is ready to install.
  downloaded,

  /// The update is being installed (the app will restart).
  installing,

  /// The update installed successfully.
  installed,

  /// The download or install failed.
  failed,

  /// The user canceled the update.
  canceled,
}

/// A snapshot of a flexible update's download/install progress.
///
/// [fraction] is the download completion in `0.0..1.0` when the platform
/// reports byte progress (the Play flexible flow does), else null.
@immutable
class AppInstallProgress {
  /// Creates an [AppInstallProgress].
  const AppInstallProgress({required this.stage, this.fraction});

  /// The current install stage.
  final AppInstallStage stage;

  /// Download completion in `0.0..1.0`, or null when byte progress is
  /// unavailable.
  final double? fraction;

  @override
  bool operator ==(Object other) =>
      other is AppInstallProgress &&
      other.stage == stage &&
      other.fraction == fraction;

  @override
  int get hashCode => Object.hash(stage, fraction);

  @override
  String toString() => 'AppInstallProgress(stage: $stage, fraction: $fraction)';
}
