import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/shell_device_provider.dart';
import 'package:uxnan/presentation/router/app_router.dart';

/// Which PC the permanent drawer lists — and the focus that decides it when
/// the route names none.
///
/// Every case here shipped wrong: the drawer only read a PC from
/// `/conversation/`, so a PC's archive or stats, or a folder opened from one
/// of its conversations, fell back to whichever list was tapped last; a newly
/// paired PC lost to the old one; and a removed PC left the drawer saying
/// "no devices" while others were still paired.
void main() {
  TrustedDevice pc(String id) => TrustedDevice(
        macDeviceId: id,
        displayName: id,
        macIdentityPublicKey: Uint8List(32),
        relayUrl: 'wss://relay.test',
        sessionId: 's-$id',
        pairedAt: DateTime(2026),
      );

  Thread thread(String id, String deviceId) => Thread(
        id: id,
        title: id,
        agentId: 'codex',
        syncState: ThreadSyncState.synced,
        status: ThreadStatus.active,
        deviceId: deviceId,
      );

  late StreamController<List<TrustedDevice>> paired;

  Future<ProviderContainer> container({
    required List<TrustedDevice> devices,
    List<Thread> threads = const [],
    String? connected,
    String? stored,
  }) async {
    SharedPreferences.setMockInitialValues({
      if (stored != null) 'uxnan.threads.lastDevice': stored,
    });
    paired = StreamController<List<TrustedDevice>>.broadcast();
    final c = ProviderContainer(
      overrides: [
        trustedDevicesProvider.overrideWith((ref) async* {
          yield devices;
          yield* paired.stream;
        }),
        threadsProvider.overrideWith((ref) => Stream.value(threads)),
        connectedDeviceProvider.overrideWith(
          (ref) => Stream.value(connected == null ? null : pc(connected)),
        ),
      ],
    );
    addTearDown(() {
      c.dispose();
      unawaited(paired.close());
    });
    // Subscribe, then let the streams and the stored focus land.
    c
      ..listen(shellDeviceProvider(AppRoutes.home), (_, __) {})
      ..listen(focusedDeviceProvider, (_, __) {});
    for (var i = 0; i < 5; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    return c;
  }

  test('a route that belongs to a PC shows that PC', () async {
    final c = await container(
      devices: [pc('mac-a'), pc('mac-b')],
      threads: [thread('t-b', 'mac-b')],
      stored: 'mac-a',
    );
    for (final location in [
      AppRoutes.deviceArchived('mac-b'),
      AppRoutes.deviceStats('mac-b'),
      AppRoutes.conversation('t-b'),
      AppRoutes.workspaceFiles('/dev/app', threadId: 't-b'),
    ]) {
      c.listen(shellDeviceProvider(location), (_, __) {});
      await Future<void>.delayed(Duration.zero);
      expect(c.read(shellDeviceProvider(location)), 'mac-b', reason: location);
    }
  });

  test('a route that names no PC keeps the PC in focus', () async {
    final c = await container(
      devices: [pc('mac-a'), pc('mac-b')],
      stored: 'mac-b',
      connected: 'mac-a',
    );
    expect(
      c.read(shellDeviceProvider(AppRoutes.workspaceFiles('/dev/app'))),
      'mac-b',
    );
  });

  test('a PC that is no longer paired gives way to one that is', () async {
    final c = await container(
      devices: [pc('mac-a')],
      stored: 'mac-gone',
      connected: 'mac-a',
    );
    expect(c.read(shellDeviceProvider(AppRoutes.home)), 'mac-a');

    final d = await container(devices: [pc('mac-c')], stored: 'mac-gone');
    expect(
      d.read(shellDeviceProvider(AppRoutes.home)),
      'mac-c',
      reason: 'nothing connected: any paired PC, never "no devices"',
    );
  });

  test('nothing paired is the only way to no PC', () async {
    final c = await container(devices: const []);
    expect(c.read(shellDeviceProvider(AppRoutes.home)), isNull);
  });

  test('a PC paired a moment ago takes the focus', () async {
    final c = await container(devices: [pc('mac-a')], stored: 'mac-a');
    expect(c.read(focusedDeviceProvider), 'mac-a');

    paired.add([pc('mac-a'), pc('mac-new')]);
    for (var i = 0; i < 5; i++) {
      await Future<void>.delayed(Duration.zero);
    }

    expect(c.read(focusedDeviceProvider), 'mac-new');
    expect(c.read(shellDeviceProvider(AppRoutes.home)), 'mac-new');
  });
}
