import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';

/// The PC whose list the permanent drawer should be showing.
///
/// On a phone the answer is always in the route — you got to a list by tapping
/// a PC. In a window wide enough for a drawer it is not: the drawer is on
/// screen before anything has been opened, and a deep link
/// (`/conversation/:id`, from a push notification) lands on a conversation with
/// no list behind it at all. Left unanswered, the drawer is simply blank in
/// exactly the case a tablet user meets first.
///
/// So it is resolved in order of how much each source actually knows:
///
/// 1. The **thread being read**, if any — it says which PC it runs on, and
///    that is the PC whose siblings belong beside it.
/// 2. The **last list visited**, persisted, for a cold start with no
///    conversation open.
/// 3. The **connected PC**, for a first run with neither.
class ShellDevice extends Notifier<String?> {
  @override
  String? build() {
    unawaited(_hydrate());
    return null;
  }

  Future<void> _hydrate() async {
    final stored = await ref
        .read(threadListPreferencesStoreProvider)
        .readLastVisitedDevice();
    if (stored != null && state == null) state = stored;
  }

  /// Records the PC a list was opened for, so the drawer can come back to it.
  Future<void> visited(String deviceId) async {
    if (deviceId.isEmpty || deviceId == state) return;
    state = deviceId;
    await ref
        .read(threadListPreferencesStoreProvider)
        .writeLastVisitedDevice(deviceId);
  }
}

/// The last PC a list was opened for (persisted).
final lastVisitedDeviceProvider =
    NotifierProvider<ShellDevice, String?>(ShellDevice.new);

/// Which PC the drawer shows, given the conversation currently open.
///
/// Pass the active thread id when the content pane is a conversation; null
/// otherwise. Returns null only when the app has never seen a PC at all, which
/// is the state the drawer answers with its pairing call to action.
final shellDeviceProvider = Provider.family<String?, String?>((ref, threadId) {
  if (threadId != null) {
    final threads = ref.watch(threadsProvider).value ?? const <Thread>[];
    for (final thread in threads) {
      if (thread.id != threadId) continue;
      final deviceId = thread.deviceId;
      if (deviceId != null && deviceId.isNotEmpty) return deviceId;
      break;
    }
  }
  final remembered = ref.watch(lastVisitedDeviceProvider);
  if (remembered != null) return remembered;
  return ref.watch(connectedDeviceProvider).value?.macDeviceId;
});
