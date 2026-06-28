import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_upgrade_version/flutter_upgrade_version.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/infrastructure/updates/app_update_service.dart';

void main() {
  PackageInfo pkg({String version = '1.0.0'}) => PackageInfo(
        version: version,
        packageName: 'dev.luisgamas.uxnanmobile',
      );

  group('Android — Play In-App Update', () {
    test('maps an available update with its flags + version code', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        androidUpdateCheck: () async => AppUpdateInfo(
          updateAvailability: UpdateAvailability.updateAvailable,
          immediateAllowed: true,
          availableVersionCode: 42,
        ),
      );

      final status = await service.check();

      expect(status.channel, UpdateChannel.playStore);
      expect(status.updateAvailable, isTrue);
      expect(status.storeVersion, '42');
      expect(status.immediateAllowed, isTrue);
      expect(status.flexibleAllowed, isFalse);
      expect(status.localVersion, '1.0.0');
    });

    test('reports no update when Play has none', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        androidUpdateCheck: () async => AppUpdateInfo(
          updateAvailability: UpdateAvailability.updateNotAvailable,
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
        androidUpdateCheck: () async => throw Exception('not from Play'),
      );

      final status = await service.check();
      expect(status.channel, UpdateChannel.playStore);
      expect(status.updateAvailable, isFalse);
    });

    test('startPlayUpdate uses an immediate flow and returns null on success',
        () async {
      AppUpdateType? started;
      final service = AppUpdateService(
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
        androidUpdateStart: (type) async {
          started = type;
          return null;
        },
      );

      expect(await service.startPlayUpdate(), isNull);
      expect(started, AppUpdateType.immediate);
    });
  });

  group('iOS — App Store lookup', () {
    test('maps canUpdate + store link + version', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(),
        iosStoreLookup: (info, region) async => VersionInfo(
          localVersion: '1.0.0',
          storeVersion: '2.0.0',
          appStoreLink: 'https://apps.apple.com/app/id1',
        ),
      );

      final status = await service.check();
      expect(status.channel, UpdateChannel.appStore);
      expect(status.updateAvailable, isTrue);
      expect(status.storeVersion, '2.0.0');
      expect(status.storeUrl, 'https://apps.apple.com/app/id1');
    });

    test('reports no update when the store matches the local version',
        () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
        packageInfoLoader: () async => pkg(version: '2.0.0'),
        iosStoreLookup: (info, region) async => VersionInfo(
          localVersion: '2.0.0',
          storeVersion: '2.0.0',
          appStoreLink: 'https://apps.apple.com/app/id1',
        ),
      );

      expect((await service.check()).updateAvailable, isFalse);
    });

    test('startPlayUpdate is a no-op off Android', () async {
      final service = AppUpdateService(
        platformOverride: TargetPlatform.iOS,
        isWebOverride: false,
      );
      expect(await service.startPlayUpdate(), isNotNull);
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
  });

  group('openStore', () {
    test('launches a valid url', () async {
      Uri? opened;
      final service = AppUpdateService(
        urlOpener: (uri) async {
          opened = uri;
          return true;
        },
      );

      expect(
        await service.openStore('https://apps.apple.com/app/id1'),
        isTrue,
      );
      expect(opened.toString(), 'https://apps.apple.com/app/id1');
    });

    test('guards a launch failure into false', () async {
      final service = AppUpdateService(
        urlOpener: (uri) async => throw Exception('no handler'),
      );
      expect(await service.openStore('https://example.com'), isFalse);
    });
  });
}
