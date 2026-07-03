import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/enums/update_check_interval.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/infrastructure/storage/update_preferences_store.dart';
import 'package:uxnan/infrastructure/updates/app_update_service.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';

/// A controllable [AppUpdateService] for the controller tests: returns a
/// scripted [check] result, emits scripted install progress, and counts the
/// download/install calls.
class _FakeUpdateService extends AppUpdateService {
  _FakeUpdateService({required this.result})
      : super(
          platformOverride: TargetPlatform.android,
          isWebOverride: false,
        );

  final AppUpdateStatus result;
  final StreamController<AppInstallProgress> progress =
      StreamController<AppInstallProgress>.broadcast();
  int checks = 0;
  int downloads = 0;
  int installs = 0;

  @override
  Future<AppUpdateStatus> check({String? iosRegionCode}) async {
    checks++;
    return result;
  }

  @override
  Stream<AppInstallProgress> installProgress() => progress.stream;

  @override
  Future<String?> startFlexibleDownload() async {
    downloads++;
    return null;
  }

  @override
  Future<String?> completeFlexibleInstall() async {
    installs++;
    return null;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  AppUpdateStatus available({int versionCode = 7}) => AppUpdateStatus(
        channel: UpdateChannel.playStore,
        updateAvailable: true,
        localVersion: '1.0.0',
        storeVersion: '$versionCode',
        flexibleAllowed: true,
      );

  const upToDate = AppUpdateStatus(
    channel: UpdateChannel.playStore,
    updateAvailable: false,
    localVersion: '1.0.0',
  );

  ProviderContainer containerWith(
    AppUpdateService service, {
    Map<String, Object> prefs = const {},
  }) {
    SharedPreferences.setMockInitialValues(prefs);
    final container = ProviderContainer(
      overrides: [
        appUpdateServiceProvider.overrideWithValue(service),
        updatePreferencesStoreProvider.overrideWithValue(
          UpdatePreferencesStore(preferences: SharedPreferences.getInstance()),
        ),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('check surfaces an available update', () async {
    final service = _FakeUpdateService(result: available());
    final container = containerWith(service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.check();
    final state = container.read(appUpdateControllerProvider);

    expect(state.phase, AppUpdatePhase.available);
    expect(state.hasUpdate, isTrue);
    expect(state.bannerVisible, isTrue);
    expect(state.status?.storeVersion, '7');
  });

  test('check surfaces up-to-date when no update', () async {
    final service = _FakeUpdateService(result: upToDate);
    final container = containerWith(service);

    await container.read(appUpdateControllerProvider.notifier).check();
    final state = container.read(appUpdateControllerProvider);

    expect(state.phase, AppUpdatePhase.upToDate);
    expect(state.hasUpdate, isFalse);
    expect(state.bannerVisible, isFalse);
  });

  test('maybeCheck always checks on everyLaunch, even within the gap',
      () async {
    final service = _FakeUpdateService(result: available());
    final container = containerWith(
      service,
      prefs: {
        'uxnan.updates.checkInterval': UpdateCheckInterval.everyLaunch.name,
        'uxnan.updates.lastCheckMs': DateTime.now().millisecondsSinceEpoch,
      },
    );

    await container.read(appUpdateControllerProvider.notifier).maybeCheck();
    expect(service.checks, 1);
  });

  test('maybeCheck skips within a long interval gap', () async {
    final service = _FakeUpdateService(result: available());
    final container = containerWith(
      service,
      prefs: {
        'uxnan.updates.checkInterval': UpdateCheckInterval.weekly.name,
        'uxnan.updates.lastCheckMs': DateTime.now().millisecondsSinceEpoch,
      },
    );

    await container.read(appUpdateControllerProvider.notifier).maybeCheck();
    expect(service.checks, 0);
  });

  test('maybeCheck runs when the gap has elapsed', () async {
    final service = _FakeUpdateService(result: available());
    final old = DateTime.now().subtract(const Duration(days: 2));
    final container = containerWith(
      service,
      prefs: {
        'uxnan.updates.checkInterval': UpdateCheckInterval.every24h.name,
        'uxnan.updates.lastCheckMs': old.millisecondsSinceEpoch,
      },
    );

    await container.read(appUpdateControllerProvider.notifier).maybeCheck();
    expect(service.checks, 1);
  });

  test('setInterval persists and updates state', () async {
    final service = _FakeUpdateService(result: upToDate);
    final container = containerWith(service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.setInterval(UpdateCheckInterval.every6h);

    expect(
      container.read(appUpdateControllerProvider).interval,
      UpdateCheckInterval.every6h,
    );
    expect(
      await container.read(updatePreferencesStoreProvider).readInterval(),
      UpdateCheckInterval.every6h,
    );
  });

  test('download → downloaded → install phase transitions', () async {
    final service = _FakeUpdateService(result: available());
    final container = containerWith(service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.check();
    await notifier.download();
    expect(service.downloads, 1);
    AppUpdateState read() => container.read(appUpdateControllerProvider);
    expect(read().phase, AppUpdatePhase.downloading);

    service.progress.add(
      const AppInstallProgress(
        stage: AppInstallStage.downloading,
        fraction: 0.5,
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(read().install?.fraction, 0.5);

    service.progress
        .add(const AppInstallProgress(stage: AppInstallStage.downloaded));
    await Future<void>.delayed(Duration.zero);
    expect(read().phase, AppUpdatePhase.downloaded);
    expect(read().bannerVisible, isTrue);

    await notifier.install();
    expect(service.installs, 1);
    expect(read().phase, AppUpdatePhase.installing);
  });

  test('a failed install-state moves to the error phase', () async {
    final service = _FakeUpdateService(result: available());
    final container = containerWith(service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.check();
    await notifier.download();
    service.progress
        .add(const AppInstallProgress(stage: AppInstallStage.failed));
    await Future<void>.delayed(Duration.zero);

    expect(
      container.read(appUpdateControllerProvider).phase,
      AppUpdatePhase.error,
    );
  });

  test('dismiss hides the banner but keeps the update known', () async {
    final service = _FakeUpdateService(result: available());
    final container = containerWith(service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.check();
    await notifier.dismiss();
    final state = container.read(appUpdateControllerProvider);

    expect(state.bannerVisible, isFalse);
    expect(state.hasUpdate, isTrue);
    expect(
      await container
          .read(updatePreferencesStoreProvider)
          .readDismissedVersion(),
      '7',
    );
  });

  test('startUpdate dispatches download when available', () async {
    final service = _FakeUpdateService(result: available());
    final container = containerWith(service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.check();
    await notifier.startUpdate();
    expect(service.downloads, 1);
  });
}
