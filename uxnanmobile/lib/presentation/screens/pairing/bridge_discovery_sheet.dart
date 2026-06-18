import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/discovered_bridge.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Modal sheet that browses the LAN for bridges (mDNS `_uxnan._tcp`) and lets
/// the user pick one — returning its `host:port` so the manual-pairing form can
/// pre-fill the host. Discovery runs while the sheet is open (the autoDispose
/// [bridgeDiscoveryProvider] stops it on close). Typing the host stays the
/// fallback when nothing is found.
class BridgeDiscoverySheet extends ConsumerWidget {
  /// Creates a [BridgeDiscoverySheet].
  const BridgeDiscoverySheet({super.key});

  /// Shows the sheet and resolves with the chosen `host:port`, or `null` when
  /// the user dismisses it without picking a bridge.
  static Future<String?> show(BuildContext context) {
    return showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => const BridgeDiscoverySheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final bridges = ref.watch(bridgeDiscoveryProvider).value ?? const [];

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.wifi_find_rounded, color: colors.primary, size: 22),
                const SizedBox(width: UxnanSpacing.sm),
                Text(l10n.bridgeDiscoveryTitle, style: textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: UxnanSpacing.md),
            if (bridges.isEmpty)
              _Searching(message: l10n.bridgeDiscoverySearching)
            else
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: bridges.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: UxnanSpacing.xs),
                  itemBuilder: (context, index) => _BridgeTile(
                    bridge: bridges[index],
                    onTap: () =>
                        Navigator.of(context).pop(bridges[index].hostPort),
                  ),
                ),
              ),
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              l10n.bridgeDiscoveryEmpty,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The "searching" placeholder: a small spinner + a hint, shown while no bridge
/// has been discovered yet.
class _Searching extends StatelessWidget {
  const _Searching({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.lg),
      child: Row(
        children: [
          const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Text(
              message,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A single discovered-bridge row: name, `host:port`, and the device id when
/// advertised. Tapping it returns the host:port to the caller.
class _BridgeTile extends StatelessWidget {
  const _BridgeTile({required this.bridge, required this.onTap});
  final DiscoveredBridge bridge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerHigh,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: Icon(Icons.dns_rounded, color: colors.primary),
        title: Text(bridge.name, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          bridge.deviceId == null
              ? bridge.hostPort
              : '${bridge.hostPort} · ${bridge.deviceId}',
          style: UxnanTypography.codeSmall.copyWith(
            color: colors.onSurfaceVariant,
          ),
          overflow: TextOverflow.ellipsis,
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: onTap,
      ),
    );
  }
}
