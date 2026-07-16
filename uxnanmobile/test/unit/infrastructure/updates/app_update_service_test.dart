import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_update_flutter/in_app_update_flutter.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/infrastructure/updates/app_update_service.dart';

void main() {
  PackageInfo pkg({
    String version = '1.0.0',
    String packageName = 'dev.luisgamas.uxnanmobile',
  }) =>
      PackageInfo(
        appName: 'Uxnan',
        packageName: packageName,
        version: version,
        buildNumber: '1',
      );

  AppUpdateInfoAndroid androidInfo({
    required UpdateAvailabilityAndroid availability,
    int? versionCode,
    bool flexible = true,
    InstallStatusAndroid installStatus = InstallStatusAndroid.unknown,
  }) =>
      AppUpdateInfoAndroid(
        updateAvailability: availability,
        availableVersionCode: versionCode,
        updatePriority: 0,
        isImmediateUpdateAllowed: true,
        isFlexibleUpdateAllowed: flexible,
        installStatus: installStatus,
      );

  group('Android — Play In-App Update', () {
    test('maps an available update with flags + version code', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        androidCheck: () async => androidInfo(
          availability: UpdateAvailabilityAndroid.updateAvailable,
          versionCode: 42,
        ),
      );

      final status = await service.check();

      expect(status.channel, UpdateChannel.playStore);
      expect(status.updateAvailable, isTrue);
      expect(status.storeVersion, '42');
      expect(status.flexibleAllowed, isTrue);
      expect(status.localVersion, '1.0.0');
    });

    // Play stops saying `updateAvailable` the moment *we* start the flexible
    // flow: it reports `developerTriggeredUpdateInProgress` while the APK
    // downloads and while it waits, downloaded, for an install — across
    // restarts. Reading that as "no update" stranded the download: the app
    // claimed to be up to date while an installable APK sat on the device.
    test('an update we already started still reads as available', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        androidCheck: () async => androidInfo(
          availability:
              UpdateAvailabilityAndroid.developerTriggeredUpdateInProgress,
          installStatus: InstallStatusAndroid.downloaded,
        ),
      );

      final status = await service.check();

      expect(status.updateAvailable, isTrue);
      expect(status.installStage, AppInstallStage.downloaded);
    });

    test('surfaces the stage of an in-progress download', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        androidCheck: () async => androidInfo(
          availability:
              UpdateAvailabilityAndroid.developerTriggeredUpdateInProgress,
          installStatus: InstallStatusAndroid.downloading,
        ),
      );

      final status = await service.check();

      expect(status.updateAvailable, isTrue);
      expect(status.installStage, AppInstallStage.downloading);
    });

    test('a fresh update carries no install stage', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        androidCheck: () async => androidInfo(
          availability: UpdateAvailabilityAndroid.updateAvailable,
          versionCode: 42,
        ),
      );

      expect((await service.check()).installStage, AppInstallStage.idle);
    });

    test('reports no update when Play has none', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        androidCheck: () async => androidInfo(
          availability: UpdateAvailabilityAndroid.updateNotAvailable,
        ),
      );

      final status = await service.check();
      expect(status.updateAvailable, isFalse);
      expect(status.storeVersion, isNull);
    });

    test('guards a thrown check into a none result', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        androidCheck: () async => throw Exception('not from Play'),
      );

      final status = await service.check();
      expect(status.channel, UpdateChannel.playStore);
      expect(status.updateAvailable, isFalse);
    });

    test('startFlexibleDownload returns null on success', () async {
      var started = 0;
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        androidStartFlexible: () async {
          started++;
          return UpdateResultAndroid.success;
        },
      );

      expect(await service.startFlexibleDownload(), isNull);
      expect(started, 1);
    });

    test('startFlexibleDownload reports a canceled flow', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        androidStartFlexible: () async => UpdateResultAndroid.userCanceled,
      );

      expect(await service.startFlexibleDownload(), isNotNull);
    });

    test('completeFlexibleInstall returns null on success', () async {
      var completed = 0;
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        androidComplete: () async => completed++,
      );

      expect(await service.completeFlexibleInstall(), isNull);
      expect(completed, 1);
    });

    test('installProgress maps a downloading state with a fraction', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        androidInstallStates: () => Stream.fromIterable([
          const InstallStateAndroid(
            status: InstallStatusAndroid.downloading,
            bytesDownloaded: 50,
            totalBytesToDownload: 100,
          ),
          const InstallStateAndroid(
            status: InstallStatusAndroid.downloaded,
            bytesDownloaded: 100,
            totalBytesToDownload: 100,
          ),
        ]),
      );

      final events = await service.installProgress().toList();
      expect(events.first.stage, AppInstallStage.downloading);
      expect(events.first.fraction, 0.5);
      expect(events.last.stage, AppInstallStage.downloaded);
      expect(events.last.fraction, isNull);
    });
  });

  group('iOS — App Store lookup', () {
    Map<String, dynamic> lookupBody({
      required String version,
      String url = 'https://apps.apple.com/app/id1',
      String? notes = 'Bug fixes',
      int trackId = 123456,
    }) =>
        <String, dynamic>{
          'resultCount': 1,
          'results': [
            <String, dynamic>{
              'version': version,
              'trackViewUrl': url,
              'releaseNotes': notes,
              'trackId': trackId,
            },
          ],
        };

    test('maps an available update, store link, notes + appStoreId', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        iosLookup: (bundleId) async => lookupBody(version: '2.0.0'),
      );

      final status = await service.check();
      expect(status.channel, UpdateChannel.appStore);
      expect(status.updateAvailable, isTrue);
      expect(status.storeVersion, '2.0.0');
      expect(status.storeUrl, 'https://apps.apple.com/app/id1');
      expect(status.releaseNotes, 'Bug fixes');
      expect(status.appStoreId, '123456');
    });

    test('reports no update when the store matches the local version',
        () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(version: '2.0.0'),
        iosLookup: (bundleId) async => lookupBody(version: '2.0.0'),
      );

      expect((await service.check()).updateAvailable, isFalse);
    });

    test('_isNewer treats a dotted store version as newer (2.0.1 > 2.0)',
        () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(version: '2.0'),
        iosLookup: (bundleId) async => lookupBody(version: '2.0.1'),
      );

      expect((await service.check()).updateAvailable, isTrue);
    });

    test('reports no update when the lookup returns no results', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        iosLookup: (bundleId) async =>
            <String, dynamic>{'results': <dynamic>[]},
      );

      expect((await service.check()).updateAvailable, isFalse);
    });

    test('startFlexibleDownload is a no-op off Android', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
      );
      expect(await service.startFlexibleDownload(), isNotNull);
    });

    test('presentStore uses the StoreKit overlay when an id is present',
        () async {
      String? presented;
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
        iosPresent: (id) async => presented = id,
      );

      await service.presentStore(appStoreId: '999');
      expect(presented, '999');
    });

    test('presentStore falls back to the url when no id', () async {
      Uri? opened;
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
        urlOpener: (uri) async {
          opened = uri;
          return true;
        },
      );

      await service.presentStore(
        storeUrl: 'https://apps.apple.com/app/id1',
      );
      expect(opened.toString(), 'https://apps.apple.com/app/id1');
    });
  });

  test('unsupported platform reports none', () async {
    final service = AppUpdateService(
      platformOverride: TargetPlatform.linux,
      isWebOverride: false,
    );
    final status = await service.check();
    expect(status.channel, UpdateChannel.unsupported);
    expect(status.updateAvailable, isFalse);
  });

  test('web reports none even on a mobile target', () async {
    final service = AppUpdateService(
      platformOverride: TargetPlatform.android,
      isWebOverride: true,
    );
    expect((await service.check()).channel, UpdateChannel.unsupported);
    expect(await service.installProgress().toList(), isEmpty);
  });
}
