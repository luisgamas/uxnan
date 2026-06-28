import 'package:equatable/equatable.dart';

/// Which platform update mechanism a check ran against.
enum UpdateChannel {
  /// Google Play In-App Updates (Android). The update is applied through
  /// Play's own flow, so no store URL is needed.
  playStore,

  /// Apple App Store version lookup (iOS). The update is applied by sending
  /// the user to the App Store listing ([AppUpdateStatus.storeUrl]).
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
    this.immediateAllowed = false,
    this.flexibleAllowed = false,
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
        immediateAllowed = false,
        flexibleAllowed = false;

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

  /// Android only: Play reports an *immediate* update flow is allowed.
  final bool immediateAllowed;

  /// Android only: Play reports a *flexible* update flow is allowed.
  final bool flexibleAllowed;

  @override
  List<Object?> get props => [
        channel,
        updateAvailable,
        localVersion,
        storeVersion,
        storeUrl,
        releaseNotes,
        immediateAllowed,
        flexibleAllowed,
      ];
}
