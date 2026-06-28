import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_upgrade_version/flutter_upgrade_version.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/infrastructure/storage/update_preferences_store.dart';
import 'package:uxnan/infrastructure/updates/app_update_service.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// Android service that reports [available], counting checks + starts.
  ({AppUpdateService service, int Function() checks, int Function() starts})
      androidService({required bool available, int versionCode = 7}) {
    var checks = 0;
    var starts = 0;
    final service = AppUpdateService(
      platformOverride: TargetPlatform.android,
      isWebOverride: false,
      packageInfoLoader: () async => PackageInfo(version: '1.0.0'),
      androidUpdateCheck: () async {
        checks++;
        return AppUpdateInfo(
          updateAvailability: available
              ? UpdateAvailability.updateAvailable
              : UpdateAvailability.updateNotAvailable,
          immediateAllowed: true,
          availableVersionCode: versionCode,
        );
      },
      androidUpdateStart: (type) async {
        starts++;
        return null;
      },
    );
    return (service: service, checks: () => checks, starts: () => starts);
  }

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
    final fake = androidService(available: true);
    final container = containerWith(fake.service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.check();
    final state = container.read(appUpdateControllerProvider);

    expect(state.phase, AppUpdatePhase.available);
    expect(state.hasUpdate, isTrue);
    expect(state.bannerVisible, isTrue);
    expect(state.status?.storeVersion, '7');
  });

  test('check surfaces up-to-date when no update', () async {
    final fake = androidService(available: false);
    final container = containerWith(fake.service);

    await container.read(appUpdateControllerProvider.notifier).check();
    final state = container.read(appUpdateControllerProvider);

    expect(state.phase, AppUpdatePhase.upToDate);
    expect(state.hasUpdate, isFalse);
    expect(state.bannerVisible, isFalse);
  });

  test('maybeCheck runs a check when none ran recently', () async {
    final fake = androidService(available: true);
    final container = containerWith(fake.service);

    await container.read(appUpdateControllerProvider.notifier).maybeCheck();

    expect(fake.checks(), 1);
  });

  test('maybeCheck skips when a check ran within the interval', () async {
    final fake = androidService(available: true);
    final container = containerWith(
      fake.service,
      prefs: {
        'uxnan.updates.lastCheckMs': DateTime.now().millisecondsSinceEpoch,
      },
    );

    await container.read(appUpdateControllerProvider.notifier).maybeCheck();

    expect(fake.checks(), 0);
  });

  test('dismiss hides the banner but keeps the update known', () async {
    final fake = androidService(available: true);
    final container = containerWith(fake.service);
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

  test('a previously dismissed version is suppressed on the next check',
      () async {
    final fake = androidService(available: true);
    final container = containerWith(
      fake.service,
      prefs: {'uxnan.updates.dismissedVersion': '7'},
    );

    await container.read(appUpdateControllerProvider.notifier).check();
    final state = container.read(appUpdateControllerProvider);

    expect(state.hasUpdate, isTrue);
    expect(state.bannerVisible, isFalse);
  });

  test('startUpdate launches the Play flow for an available update', () async {
    final fake = androidService(available: true);
    final container = containerWith(fake.service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.check();
    await notifier.startUpdate();

    expect(fake.starts(), 1);
    expect(container.read(appUpdateControllerProvider).starting, isFalse);
  });

  test('startUpdate is a no-op when no update is available', () async {
    final fake = androidService(available: false);
    final container = containerWith(fake.service);
    final notifier = container.read(appUpdateControllerProvider.notifier);

    await notifier.check();
    await notifier.startUpdate();

    expect(fake.starts(), 0);
  });
}
