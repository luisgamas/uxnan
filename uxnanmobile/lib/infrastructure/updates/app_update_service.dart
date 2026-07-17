import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:in_app_update_flutter/in_app_update_flutter.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';

/// Loads the running app's package info (name/version/build/bundle id).
typedef PackageInfoLoader = Future<PackageInfo> Function();

/// Checks Google Play for an available in-app update (Android only).
typedef AndroidUpdateCheck = Future<AppUpdateInfoAndroid> Function();

/// Starts the Play *flexible* (background-download) update flow (Android only).
typedef AndroidStartFlexible = Future<UpdateResultAndroid> Function();

/// A stream of Play flexible-update install states (Android only).
typedef AndroidInstallStates = Stream<InstallStateAndroid> Function();

/// Completes a Play flexible update, restarting the app (Android only).
typedef AndroidComplete = Future<void> Function();

/// Looks up an app's iTunes metadata by [bundleId] (iOS only). Returns the raw
/// decoded JSON body, or null on any failure.
typedef IosStoreLookup = Future<Map<String, dynamic>?> Function(
  String bundleId,
);

/// Presents the App Store product page overlay for [appStoreId] (iOS only).
typedef IosPresent = Future<void> Function(String appStoreId);

/// Opens [url] in the platform browser / store app. Returns whether it
/// launched.
typedef UrlOpener = Future<bool> Function(Uri url);

/// Checks for, downloads and installs application updates.
///
/// Wraps `in_app_update_flutter`: on Android it drives the **Play In-App
/// Update** API (flexible flow — background download + user-triggered install);
/// on iOS it looks up the **App Store** version via the iTunes lookup endpoint
/// (`dio`) and presents the App Store product page via StoreKit; everywhere
/// else it reports "no update". The *no-silent-install* policy is enforced
/// here — the service can detect, download and *offer* an install, but never
/// installs one without an explicit caller action.
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
    AndroidUpdateCheck? androidCheck,
    AndroidStartFlexible? androidStartFlexible,
    AndroidInstallStates? androidInstallStates,
    AndroidComplete? androidComplete,
    IosStoreLookup? iosLookup,
    IosPresent? iosPresent,
    UrlOpener? urlOpener,
    TargetPlatform? platformOverride,
    bool? isWebOverride,
  })  : _packageInfoLoader = packageInfoLoader ?? PackageInfo.fromPlatform,
        _androidCheck = androidCheck ?? InAppUpdateFlutter().checkUpdateAndroid,
        _androidStartFlexible = androidStartFlexible ??
            InAppUpdateFlutter().startFlexibleUpdateAndroid,
        _androidInstallStates = androidInstallStates ??
            (() => InAppUpdateFlutter().installStateStreamAndroid),
        _androidComplete =
            androidComplete ?? InAppUpdateFlutter().completeUpdateAndroid,
        _iosLookup = iosLookup ?? _defaultIosLookup,
        _iosPresent = iosPresent ??
            ((id) => InAppUpdateFlutter().showUpdateForIos(appStoreId: id)),
        _urlOpener = urlOpener ??
            ((uri) => launchUrl(uri, mode: LaunchMode.externalApplication)),
        _platformOverride = platformOverride,
        _isWebOverride = isWebOverride;

  final PackageInfoLoader _packageInfoLoader;
  final AndroidUpdateCheck _androidCheck;
  final AndroidStartFlexible _androidStartFlexible;
  final AndroidInstallStates _androidInstallStates;
  final AndroidComplete _androidComplete;
  final IosStoreLookup _iosLookup;
  final IosPresent _iosPresent;
  final UrlOpener _urlOpener;
  final TargetPlatform? _platformOverride;
  final bool? _isWebOverride;

  bool get _isWeb => _isWebOverride ?? kIsWeb;
  TargetPlatform get _platform => _platformOverride ?? defaultTargetPlatform;

  static Future<Map<String, dynamic>?> _defaultIosLookup(
    String bundleId,
  ) async {
    try {
      final response = await Dio().get<Map<String, dynamic>>(
        'https://itunes.apple.com/lookup',
        queryParameters: <String, dynamic>{'bundleId': bundleId},
      );
      return response.data;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('iTunes lookup failed', error, stackTrace);
      return null;
    }
  }

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
  /// [iosRegionCode] is accepted for API compatibility; the iTunes
  /// `bundleId` lookup already resolves the correct storefront, so it is
  /// unused by the default implementation.
  Future<AppUpdateStatus> check({String? iosRegionCode}) async {
    final channel = this.channel;
    try {
      switch (channel) {
        case UpdateChannel.playStore:
          return await _checkAndroid();
        case UpdateChannel.appStore:
          return await _checkIos();
        case UpdateChannel.unsupported:
          return const AppUpdateStatus.none(UpdateChannel.unsupported);
      }
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Update check failed', error, stackTrace);
      return AppUpdateStatus.none(channel);
    }
  }

  Future<AppUpdateStatus> _checkAndroid() async {
    final info = await _androidCheck();
    // Play reports `updateAvailable` only for an update we have *not* started
    // yet. The moment the flexible flow is triggered it flips to
    // `developerTriggeredUpdateInProgress` and stays there while the APK
    // downloads and while it sits downloaded-but-not-installed — across app
    // restarts, until the install actually completes. (Play's own contract
    // gives this away: `installStatus` is "defined only if updateAvailability
    // returns DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS".)
    //
    // Both values mean the same thing to a user: the newer version is not
    // installed yet. Counting only the first as available made a half-applied
    // update report "up to date" forever, hiding the very banner that offers
    // the install and stranding the downloaded APK on the device.
    final availability = info.updateAvailability;
    final available =
        availability == UpdateAvailabilityAndroid.updateAvailable ||
            availability ==
                UpdateAvailabilityAndroid.developerTriggeredUpdateInProgress;
    final local = await _localVersion();
    return AppUpdateStatus(
      channel: UpdateChannel.playStore,
      updateAvailable: available,
      localVersion: local,
      // Play defines the version code while an update is available or in
      // progress, and returns "an arbitrary value" when none is — so it is
      // only read when an update is really in play. The plugin narrows this
      // further and only forwards it for `updateAvailable`, so a resumed
      // in-progress update legitimately has no version to show; the UI already
      // falls back to a version-less message.
      storeVersion: available ? info.availableVersionCode?.toString() : null,
      flexibleAllowed: info.isFlexibleUpdateAllowed,
      installStage: _mapInstallStatus(info.installStatus),
    );
  }

  Future<AppUpdateStatus> _checkIos() async {
    final info = await _packageInfoLoader();
    final bundleId = info.packageName;
    final body = await _iosLookup(bundleId);
    final results = body?['results'];
    if (results is! List || results.isEmpty) {
      return AppUpdateStatus(
        channel: UpdateChannel.appStore,
        updateAvailable: false,
        localVersion: info.version.isEmpty ? null : info.version,
      );
    }
    final first = results.first;
    if (first is! Map) {
      return AppUpdateStatus(
        channel: UpdateChannel.appStore,
        updateAvailable: false,
        localVersion: info.version.isEmpty ? null : info.version,
      );
    }
    final storeVersion = first['version']?.toString();
    final trackViewUrl = first['trackViewUrl']?.toString();
    final releaseNotes = first['releaseNotes']?.toString();
    final trackId = first['trackId']?.toString();
    final local = info.version.isEmpty ? null : info.version;
    final available =
        storeVersion != null && local != null && _isNewer(storeVersion, local);
    return AppUpdateStatus(
      channel: UpdateChannel.appStore,
      updateAvailable: available,
      localVersion: local,
      storeVersion: storeVersion,
      storeUrl: trackViewUrl,
      releaseNotes: releaseNotes,
      appStoreId: trackId,
    );
  }

  /// Whether the dotted-numeric [store] version is newer than [local].
  /// Splits on '.', compares each segment numerically, and pads the shorter
  /// with zeros (so `2.1` reads as `2.1.0`). Non-numeric segments count as 0.
  static bool _isNewer(String store, String local) {
    final s = store.split('.');
    final l = local.split('.');
    final len = s.length > l.length ? s.length : l.length;
    for (var i = 0; i < len; i++) {
      final sv = i < s.length ? int.tryParse(s[i]) ?? 0 : 0;
      final lv = i < l.length ? int.tryParse(l[i]) ?? 0 : 0;
      if (sv != lv) return sv > lv;
    }
    return false;
  }

  Future<String?> _localVersion() async {
    try {
      final info = await _packageInfoLoader();
      return info.version.isEmpty ? null : info.version;
    } on Object {
      return null;
    }
  }

  /// Streams the Play flexible-update download/install progress (Android). Off
  /// Android, an empty stream. Never throws — a plugin error ends the stream.
  Stream<AppInstallProgress> installProgress() {
    if (channel != UpdateChannel.playStore) {
      return const Stream<AppInstallProgress>.empty();
    }
    return _androidInstallStates()
        .map(_mapInstallState)
        .handleError((Object error, StackTrace stackTrace) {
      AppLogger.warn('Install-state stream error', error, stackTrace);
    });
  }

  AppInstallProgress _mapInstallState(InstallStateAndroid state) {
    final total = state.totalBytesToDownload;
    final fraction = total > 0 ? state.bytesDownloaded / total : null;
    final stage = _mapInstallStatus(state.status);
    return AppInstallProgress(
      stage: stage,
      fraction: stage == AppInstallStage.downloading ? fraction : null,
    );
  }

  /// Maps a Play install status onto the platform-agnostic [AppInstallStage].
  ///
  /// Shared by the live install-state stream and the `appUpdateInfo` snapshot
  /// read on every check, so a resumed update and a streamed one describe
  /// themselves identically. `pending` folds into [AppInstallStage.downloading]
  /// (Play has accepted the update and will fetch it shortly — to the user it
  /// is the same wait).
  static AppInstallStage _mapInstallStatus(InstallStatusAndroid status) =>
      switch (status) {
        InstallStatusAndroid.pending => AppInstallStage.downloading,
        InstallStatusAndroid.downloading => AppInstallStage.downloading,
        InstallStatusAndroid.downloaded => AppInstallStage.downloaded,
        InstallStatusAndroid.installing => AppInstallStage.installing,
        InstallStatusAndroid.installed => AppInstallStage.installed,
        InstallStatusAndroid.failed => AppInstallStage.failed,
        InstallStatusAndroid.canceled => AppInstallStage.canceled,
        InstallStatusAndroid.unknown => AppInstallStage.idle,
      };

  /// Starts the Play flexible (background-download) update flow (Android).
  /// Returns null on success or a human-readable error string on failure.
  /// Off Android returns an error string.
  Future<String?> startFlexibleDownload() async {
    if (channel != UpdateChannel.playStore) {
      return 'In-app updates are only available on Android.';
    }
    try {
      final result = await _androidStartFlexible();
      return switch (result) {
        UpdateResultAndroid.success => null,
        UpdateResultAndroid.userCanceled => 'Update canceled.',
        UpdateResultAndroid.inAppUpdateFailed => 'The update flow failed.',
      };
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Failed to start Play update', error, stackTrace);
      return error.toString();
    }
  }

  /// Completes a downloaded Play flexible update, restarting the app (Android).
  /// Returns null on success or a human-readable error string. Off Android
  /// returns an error string.
  Future<String?> completeFlexibleInstall() async {
    if (channel != UpdateChannel.playStore) {
      return 'In-app updates are only available on Android.';
    }
    try {
      await _androidComplete();
      return null;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Failed to complete Play update', error, stackTrace);
      return error.toString();
    }
  }

  /// Presents the App Store product page (iOS) so the user can update:
  /// StoreKit overlay when [appStoreId] is known, else a best-effort launch of
  /// [storeUrl]. Guarded; never throws.
  Future<void> presentStore({String? appStoreId, String? storeUrl}) async {
    try {
      if (appStoreId != null && appStoreId.isNotEmpty) {
        await _iosPresent(appStoreId);
        return;
      }
      if (storeUrl != null && storeUrl.isNotEmpty) {
        final uri = Uri.tryParse(storeUrl);
        if (uri != null) await _urlOpener(uri);
      }
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Failed to present the store', error, stackTrace);
    }
  }
}
