import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/core/utils/clock_format.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/agent_activity_section.dart';
import 'package:uxnan/presentation/screens/profile/profile_metrics_widgets.dart';
import 'package:uxnan/presentation/screens/profile/spend_section.dart';
import 'package:uxnan/presentation/screens/profile/usage_section.dart';
import 'package:uxnan/presentation/screens/threads/workspace_browser_sheet.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_badge.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_entrance_scope.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// One PC's stats: what its agents spent, its plan limits while it is the
/// connected PC, and its activity — the same sections as the profile, scoped
/// to this PC. Reached from the profile's PC list and the device card's
/// overflow menu. While this PC is connected the screen also shows its shared
/// start folder (`settings/set`, architecture/02a §5.8.17), which the phone
/// can change.
///
/// A **child** of whatever opened it, not a route: opened from the profile
/// inside Settings' pane on a tablet, a routed screen escaped that pane —
/// Settings closed and the stats appeared beside the drawer, conversations
/// and all. Pushed, it stacks where it was asked for, like the theme editor.
class PcDetailsScreen extends ConsumerWidget {
  /// Creates a [PcDetailsScreen] for the PC with [deviceId].
  const PcDetailsScreen({required this.deviceId, super.key});

  /// The `macDeviceId` of the PC whose metrics are shown.
  final String deviceId;

  /// Opens the stats of the PC with [deviceId] in the nearest navigator.
  static Future<void> push(BuildContext context, String deviceId) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PcDetailsScreen(deviceId: deviceId),
      ),
    );
  }

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
            child: Center(child: PolygonLoader(size: 48)),
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
    final titleStyle = Theme.of(context).textTheme.titleLarge;
    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          UxnanSpacing.sm,
          UxnanSpacing.lg,
          UxnanSpacing.xxl,
        ),
        // Staggered by BLOCK, as on the profile: the spacers between them
        // are not things that arrive.
        sliver: SliverList.list(
          children: [
            NeEntranceRow(
              index: 0,
              child: _PcHeader(
                device: device,
                isConnected: isConnected,
                relayConnected: relayConnected,
              ),
            ),
            if (isConnected) ...[
              const SizedBox(height: UxnanSpacing.lg),
              const NeEntranceRow(index: 1, child: _StartFolderCard()),
            ],
            const SizedBox(height: UxnanSpacing.xl),
            NeEntranceRow(index: 2, child: SpendSection(deviceId: deviceId)),
            if (isConnected) ...[
              const SizedBox(height: UxnanSpacing.xl),
              const NeEntranceRow(index: 3, child: UsageSection()),
            ],
            const SizedBox(height: UxnanSpacing.xl),
            NeEntranceRow(
              index: 4,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(l10n.profileActivity, style: titleStyle),
                  const SizedBox(height: UxnanSpacing.sm),
                  ActivityHighlights(metrics: m),
                  const SizedBox(height: UxnanSpacing.md),
                  AgentActivitySection(
                    firstYear: firstYear,
                    deviceId: deviceId,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ];
  }
}

/// The connected PC's start folder: where exploring for a new project begins,
/// on this phone and in Uxnan Desktop alike. Tapping it browses the PC to pick
/// another one; the bridge checks it and every client follows.
class _StartFolderCard extends ConsumerStatefulWidget {
  const _StartFolderCard();

  @override
  ConsumerState<_StartFolderCard> createState() => _StartFolderCardState();
}

class _StartFolderCardState extends ConsumerState<_StartFolderCard> {
  bool _saving = false;

  Future<void> _change() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final folder = await WorkspaceBrowserSheet.show(context);
    if (folder == null || !mounted) return;
    setState(() => _saving = true);
    try {
      await ref.read(bridgeReplicaProvider).setHome(folder);
    } on Object {
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.bridgeHomeFailed)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final home = ref.watch(bridgeHomeProvider).value;
    return NeCard(
      onTap: _saving ? null : _change,
      child: Row(
        children: [
          UxIcon(UxIcons.folderOpen, color: colors.primary),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.bridgeHomeTitle, style: textTheme.titleSmall),
                const SizedBox(height: UxnanSpacing.xs),
                Text(
                  home ?? '—',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: UxnanTypography.codeSmall.copyWith(
                    color: colors.onSurface,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.xs),
                Text(
                  l10n.bridgeHomeSubtitle,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: UxnanSpacing.sm),
          if (_saving)
            const SizedBox.square(dimension: 20, child: PolygonLoader())
          else
            Semantics(
              label: l10n.bridgeHomeChange,
              child: UxIcon(
                UxIcons.edit,
                size: UxnanSize.iconContent,
                color: colors.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
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
        parts.add('${l10n.deviceLastSeenLabel}: ${formatWhen(lastSeen)}');
      }
    }
    final subtitle = parts.join(' · ');

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
            child: UxIcon(
              UxIcons.laptopMac,
              size: UxnanSize.iconContentLarge,
              color: isConnected ? colors.tertiary : colors.onSurfaceVariant,
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
                  const SizedBox(height: UxnanSpacing.xs),
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
                // The same badge the device card wears, so "connected" is one
                // shape wherever a PC is shown: the live fill while it is,
                // supporting metadata while it is not.
                NeBadge(
                  icon: isConnected ? UxIcons.wifiTethering : UxIcons.cloudOff,
                  label: [
                    if (isConnected)
                      l10n.connectionConnected
                    else
                      l10n.connectionDisconnected,
                    if (transport != null) transport,
                  ].join(' · '),
                  tone: isConnected ? NeBadgeTone.live : NeBadgeTone.secondary,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
