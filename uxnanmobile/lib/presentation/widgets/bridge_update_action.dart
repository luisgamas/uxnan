import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// Asks the PC's bridge to update itself (`bridge/update`) — the one place the
/// app does, whichever surface the person pressed it on (the notice atop the
/// conversations, Settings → Updates). The bridge stops, installs the
/// published version and its service brings it back; the phone reconnects and
/// the notice says when it is on the new version. A refusal (a turn running
/// on some client) is shown as the bridge put it.
Future<void> requestBridgeUpdate(BuildContext context, WidgetRef ref) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final entered = await ref.read(bridgeReplicaProvider).applyBridgeUpdate();
    final target = entered?.targetVersion;
    if (target != null) {
      ref.read(bridgeUpdatePendingProvider.notifier).set(target);
    }
  } on RpcError catch (error) {
    messenger.showSnackBar(SnackBar(content: Text(error.message)));
  }
}
