import 'package:flutter/foundation.dart';
import 'package:flutter_upgrade_version/flutter_upgrade_version.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';

/// Loads the running app's package info (name/version/build).
typedef PackageInfoLoader = Future<PackageInfo> Function();

/// Queries Google Play for an available in-app update (Android only).
typedef AndroidUpdateCheck = Future<AppUpdateInfo?> Function();

/// Starts a Play In-App Update flow of [type] (Android only). Returns null on
/// success or a human-readable error message on failure.
typedef AndroidUpdateStart = Future<String?> Function(AppUpdateType type);

/// Looks up the App Store version for [info] (iOS only).
typedef IosStoreLookup = Future<VersionInfo> Function(
  PackageInfo info,
  String? regionCode,
);

/// Opens [url] in the platform browser / store app. Returns whether it
/// launched.
typedef UrlOpener = Future<bool> Function(Uri url);

/// Checks for, and starts, application updates.
///
/// Wraps `flutter_upgrade_version`: on Android it drives the **Play In-App
/// Update** API; on iOS it looks up the **App Store** version via the iTunes
/// lookup endpoint; everywhere else it reports "no update". The
/// *no-silent-install* policy is enforced here — the service can detect and
/// *start* an update, but never installs one without an explicit caller action.
///
/// Fully guarded, like the speech and push services: every plugin call is
/// wrapped so a missing native plugin, an offline device, or a build that was
/// not installed from a store leaves the feature simply reporting
/// [AppUpdateStatus.none] instead of throwing. The platform branch and every
/// plugin call are injectable so tests run without a real platform channel.
class AppUpdateService {
  /// Creates an [AppUpdateService]. All collaborators default to the real
  /// plugin/launcher; tests inject fakes (and may pin [platformOverride] /
  /// [isWebOverride] to exercise a specific platform branch).
  AppUpdateService({
    PackageInfoLoader? packageInfoLoader,
    AndroidUpdateCheck? androidUpdateCheck,
    AndroidUpdateStart? androidUpdateStart,
    IosStoreLookup? iosStoreLookup,
    UrlOpener? urlOpener,
    TargetPlatform? platformOverride,
    bool? isWebOverride,
  })  : _packageInfoLoader = packageInfoLoader ?? PackageManager.getPackageInfo,
        _androidUpdateCheck =
            androidUpdateCheck ?? InAppUpdateManager().checkForUpdate,
        _androidUpdateStart = androidUpdateStart ??
            ((type) => InAppUpdateManager().startAnUpdate(type: type)),
        _iosStoreLookup = iosStoreLookup ??
            ((info, region) => UpgradeVersion.getiOSStoreVersion(
                  packageInfo: info,
                  regionCode: region,
                )),
        _urlOpener = urlOpener ??
            ((uri) => launchUrl(uri, mode: LaunchMode.externalApplication)),
        _platformOverride = platformOverride,
        _isWebOverride = isWebOverride;

  final PackageInfoLoader _packageInfoLoader;
  final AndroidUpdateCheck _androidUpdateCheck;
  final AndroidUpdateStart _androidUpdateStart;
  final IosStoreLookup _iosStoreLookup;
  final UrlOpener _urlOpener;
  final TargetPlatform? _platformOverride;
  final bool? _isWebOverride;

  bool get _isWeb => _isWebOverride ?? kIsWeb;
  TargetPlatform get _platform => _platformOverride ?? defaultTargetPlatform;

  /// The update channel that applies on the current platform.
  UpdateChannel get channel {
    if (_isWeb) return UpdateChannel.unsupported;
    return switch (_platform) {
      TargetPlatform.android => UpdateChannel.playStore,
      TargetPlatform.iOS => UpdateChannel.appStore,
      _ => UpdateChannel.unsupported,
    };
  }

  /// Checks whether a newer version is available. Never throws — any failure
  /// yields an [AppUpdateStatus.none] for the current [channel].
  ///
  /// [iosRegionCode] picks the App Store storefront for the iOS lookup (ISO
  /// 3166 alpha-2, e.g. `US`); null lets the package fall back to the device /
  /// default region.
  Future<AppUpdateStatus> check({String? iosRegionCode}) async {
    final channel = this.channel;
    try {
      switch (channel) {
        case UpdateChannel.playStore:
          return await _checkAndroid();
        case UpdateChannel.appStore:
          return await _checkIos(iosRegionCode);
        case UpdateChannel.unsupported:
          return const AppUpdateStatus.none(UpdateChannel.unsupported);
      }
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Update check failed', error, stackTrace);
      return AppUpdateStatus.none(channel);
    }
  }

  Future<AppUpdateStatus> _checkAndroid() async {
    final info = await _androidUpdateCheck();
    if (info == null) {
      return const AppUpdateStatus.none(UpdateChannel.playStore);
    }
    final available =
        info.updateAvailability == UpdateAvailability.updateAvailable;
    final local = await _localVersion();
    return AppUpdateStatus(
      channel: UpdateChannel.playStore,
      updateAvailable: available,
      localVersion: local,
      storeVersion: available ? info.availableVersionCode.toString() : null,
      immediateAllowed: info.immediateAllowed,
      flexibleAllowed: info.flexibleAllowed,
    );
  }

  Future<AppUpdateStatus> _checkIos(String? regionCode) async {
    final info = await _packageInfoLoader();
    final version = await _iosStoreLookup(info, regionCode);
    return AppUpdateStatus(
      channel: UpdateChannel.appStore,
      updateAvailable: version.canUpdate,
      localVersion:
          version.localVersion.isEmpty ? info.version : version.localVersion,
      storeVersion: version.storeVersion.isEmpty ? null : version.storeVersion,
      storeUrl: version.appStoreLink.isEmpty ? null : version.appStoreLink,
      releaseNotes: version.releaseNotes.isEmpty ? null : version.releaseNotes,
    );
  }

  Future<String?> _localVersion() async {
    try {
      final info = await _packageInfoLoader();
      return info.version.isEmpty ? null : info.version;
    } on Object {
      return null;
    }
  }

  /// Starts the Play In-App Update flow (Android). Uses an *immediate* update
  /// by default — a full-screen, user-confirmed flow that Play downloads,
  /// installs and restarts itself (the package exposes no completion hook for
  /// flexible updates, so immediate is the reliable end-to-end path). Returns
  /// null on success or a human-readable error message. No-op (returns an
  /// error string) off Android.
  Future<String?> startPlayUpdate({bool immediate = true}) async {
    if (channel != UpdateChannel.playStore) {
      return 'In-app updates are only available on Android.';
    }
    try {
      return await _androidUpdateStart(
        immediate ? AppUpdateType.immediate : AppUpdateType.flexible,
      );
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Failed to start Play update', error, stackTrace);
      return error.toString();
    }
  }

  /// Opens [storeUrl] (the App Store listing, iOS) so the user can update.
  /// Returns whether the launch succeeded; never throws.
  Future<bool> openStore(String storeUrl) async {
    final uri = Uri.tryParse(storeUrl);
    if (uri == null) return false;
    try {
      return await _urlOpener(uri);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Failed to open store URL', error, stackTrace);
      return false;
    }
  }
}
