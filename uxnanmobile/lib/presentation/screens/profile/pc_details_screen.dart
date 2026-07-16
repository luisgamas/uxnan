import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/agent_activity_section.dart';
import 'package:uxnan/presentation/screens/profile/profile_metrics_widgets.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Per-PC metrics: the same activity heatmap, stat tiles and per-agent
/// breakdown as the profile, but scoped to a single paired PC (its
/// conversations, work, connection time and agents used). Reached from the
/// device card's overflow menu. All local — no bridge call.
class PcDetailsScreen extends ConsumerWidget {
  /// Creates a [PcDetailsScreen] for the PC with [deviceId].
  const PcDetailsScreen({required this.deviceId, super.key});

  /// The `macDeviceId` of the PC whose metrics are shown.
  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final device = ref
        .watch(trustedDevicesProvider)
        .value
        ?.firstWhereOrNull((d) => d.macDeviceId == deviceId);
    final metricsAsync = ref.watch(pcMetricsProvider(deviceId));
    final isConnected =
        ref.watch(connectedDeviceProvider).value?.macDeviceId == deviceId;
    final relayConnected = isConnected
        ? ref.watch(bridgeStatusProvider).value?.relayConnected
        : null;

    return NeScaffold(
      title: device?.displayName ?? l10n.devicesTitle,
      slivers: metricsAsync.when(
        loading: () => const [
          SliverFillRemaining(
            hasScrollBody: false,
            child: Center(child: CircularProgressIndicator()),
          ),
        ],
        error: (_, __) => [
          SliverFillRemaining(
            hasScrollBody: false,
            child: Center(child: Text(l10n.profileNoData)),
          ),
        ],
        data: (metrics) => _content(
          context,
          l10n,
          metrics,
          device: device,
          isConnected: isConnected,
          relayConnected: relayConnected,
        ),
      ),
    );
  }

  List<Widget> _content(
    BuildContext context,
    AppLocalizations l10n,
    ProfileMetrics m, {
    required TrustedDevice? device,
    required bool isConnected,
    required bool? relayConnected,
  }) {
    final firstYear = m.memberSince?.year ?? DateTime.now().year;
    final titleStyle = Theme.of(context).textTheme.titleMedium;
    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          UxnanSpacing.sm,
          UxnanSpacing.lg,
          UxnanSpacing.xxl,
        ),
        sliver: SliverList.list(
          children: [
            _PcHeader(
              device: device,
              isConnected: isConnected,
              relayConnected: relayConnected,
            ),
            const SizedBox(height: UxnanSpacing.lg),
            MetricsStatGrid(metrics: m),
            const SizedBox(height: UxnanSpacing.xl),
            Text(l10n.profileActivity, style: titleStyle),
            const SizedBox(height: UxnanSpacing.sm),
            AgentActivitySection(firstYear: firstYear, deviceId: deviceId),
          ],
        ),
      ),
    ];
  }
}

class _PcHeader extends StatelessWidget {
  const _PcHeader({
    required this.device,
    required this.isConnected,
    required this.relayConnected,
  });

  final TrustedDevice? device;
  final bool isConnected;
  final bool? relayConnected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final device = this.device;
    final parts = <String>[];
    if (device != null) {
      final paired = DateFormat.yMMMd().format(device.pairedAt);
      parts.add('${l10n.devicePairedLabel}: $paired');
      final lastSeen = device.lastSeen;
      if (lastSeen != null) {
        parts.add('${l10n.deviceLastSeenLabel}: ${_relativeTime(lastSeen)}');
      }
    }
    final subtitle = parts.join(' · ');

    final (statusLabel, statusColor) = isConnected
        ? (l10n.connectionConnected, UxnanColors.connected)
        : (l10n.connectionDisconnected, UxnanColors.disconnected);
    final transport = (isConnected && relayConnected != null)
        ? (relayConnected! ? l10n.connectionRelay : l10n.connectionDirect)
        : null;

    return NeCard(
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: colors.surfaceContainerHigh,
              borderRadius: const BorderRadius.all(UxnanRadius.lg),
              border: Border.all(color: colors.outline),
            ),
            child: Icon(
              Icons.laptop_mac_rounded,
              size: 24,
              color:
                  isConnected ? UxnanColors.connected : colors.onSurfaceVariant,
            ),
          ),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  device?.displayName ?? '',
                  style: textTheme.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const SizedBox(height: UxnanSpacing.xs),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: statusColor,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    Text(
                      statusLabel,
                      style: textTheme.bodySmall?.copyWith(color: statusColor),
                    ),
                    if (transport != null)
                      Text(
                        ' · $transport',
                        style: textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _relativeTime(DateTime time) {
    final now = DateTime.now();
    final sameDay =
        now.year == time.year && now.month == time.month && now.day == time.day;
    return sameDay
        ? DateFormat.Hm().format(time)
        : DateFormat.MMMd().format(time);
  }
}
