import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/router/route_facts.dart';

/// The PC in focus: the one the user last went to. Persisted, so a cold start
/// with nothing open comes back to it.
///
/// **One writer, three ways in, all of them acts of going to a PC:**
/// - the route — opening anything that belongs to a PC (its list, archive or
///   stats, one of its conversations, a folder's screen opened from one)
///   focuses it; the shell reports what [routeDeviceProvider] resolves;
/// - the drawer's PC switcher ([focus]);
/// - pairing — a PC that was not paired a moment ago is the one you are
///   about to use, so it takes the focus as it appears.
///
/// A route that names no PC (the overview, a folder opened from the list)
/// leaves the focus where it was — which is exactly why the route has to
/// write it: otherwise a PC reached through a notification was forgotten the
/// moment you opened one of its folders, and the drawer jumped to the last
/// list you had tapped.
class FocusedDevice extends Notifier<String?> {
  @override
  String? build() {
    ref.listen<AsyncValue<List<TrustedDevice>>>(trustedDevicesProvider, (
      previous,
      next,
    ) {
      final before = previous?.value;
      final now = next.value;
      if (before == null || now == null) return;
      final known = {for (final d in before) d.macDeviceId};
      final added = now.where((d) => !known.contains(d.macDeviceId)).toList();
      if (added.length == 1) unawaited(focus(added.single.macDeviceId));
    });
    unawaited(_hydrate());
    return null;
  }

  Future<void> _hydrate() async {
    final stored = await ref
        .read(threadListPreferencesStoreProvider)
        .readLastVisitedDevice();
    if (stored != null && state == null) state = stored;
  }

  /// Focuses the PC with [deviceId].
  Future<void> focus(String deviceId) async {
    if (deviceId.isEmpty || deviceId == state) return;
    state = deviceId;
    await ref
        .read(threadListPreferencesStoreProvider)
        .writeLastVisitedDevice(deviceId);
  }
}

/// The PC in focus (persisted). See [FocusedDevice].
final focusedDeviceProvider =
    NotifierProvider<FocusedDevice, String?>(FocusedDevice.new);

/// The PC the conversation [threadId] runs on, from this phone's copy; null
/// while it is unknown here (a notification can open one before it syncs).
final threadDeviceProvider = Provider.family<String?, String>((ref, threadId) {
  final threads = ref.watch(threadsProvider).value ?? const <Thread>[];
  for (final thread in threads) {
    if (thread.id != threadId) continue;
    final deviceId = thread.deviceId;
    return deviceId == null || deviceId.isEmpty ? null : deviceId;
  }
  return null;
});

/// The PC the router [location] belongs to: the one it names, or the one its
/// conversation runs on. Null for a route that belongs to no PC.
final routeDeviceProvider = Provider.family<String?, String>((ref, location) {
  final facts = RouteFacts.parse(location);
  final named = facts.deviceId;
  if (named != null) return named;
  final thread = facts.threadId;
  return thread == null ? null : ref.watch(threadDeviceProvider(thread));
});

/// Which PC the permanent drawer lists, for the router [location] on screen.
///
/// In order of how much each source knows: the PC the route belongs to, the
/// PC in focus, the connected PC, then any paired PC. Every answer is checked
/// against the PCs actually paired — a PC removed a moment ago must not leave
/// the drawer saying "no devices" while others are still there. Null only when
/// nothing is paired, which the drawer answers with its pairing call to action.
final shellDeviceProvider = Provider.family<String?, String>((ref, location) {
  final paired = ref.watch(trustedDevicesProvider).value;
  // Still loading: trust what we have rather than blank the drawer.
  bool isPaired(String? id) =>
      id != null && (paired == null || paired.any((d) => d.macDeviceId == id));

  final routed = ref.watch(routeDeviceProvider(location));
  if (isPaired(routed)) return routed;
  final focused = ref.watch(focusedDeviceProvider);
  if (isPaired(focused)) return focused;
  final connected = ref.watch(connectedDeviceProvider).value?.macDeviceId;
  if (isPaired(connected)) return connected;
  return paired == null || paired.isEmpty ? null : paired.first.macDeviceId;
});
