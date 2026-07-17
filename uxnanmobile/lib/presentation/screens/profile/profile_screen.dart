import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/enums/metrics_refresh_interval.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/agent_activity_section.dart';
import 'package:uxnan/presentation/screens/profile/edit_profile_sheet.dart';
import 'package:uxnan/presentation/screens/profile/profile_backup_section.dart';
import 'package:uxnan/presentation/screens/profile/profile_metrics_widgets.dart';
import 'package:uxnan/presentation/screens/profile/usage_section.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';

/// Aggregate activity across every paired PC: identity header, headline stats,
/// a GitHub-style contribution heatmap and a per-agent breakdown — all derived
/// from the bridge-owned snapshots.
class ProfileScreen extends ConsumerStatefulWidget {
  /// Creates the [ProfileScreen].
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  @override
  void initState() {
    super.initState();
    // On a live connection the snapshot is only re-fetched when the connection
    // itself changes, so opening the profile would otherwise keep showing
    // whatever was current at connect time. In `automatic` the stats are
    // therefore refreshed on every open; the other modes leave it to their poll
    // or to the refresh button. Post-frame: refresh() invalidates a provider,
    // which must not happen during a build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!ref.read(metricsRefreshIntervalProvider).refreshesOnOpen) return;
      if (ref.read(connectedDeviceProvider).value == null) return;
      ref.read(metricsSnapshotsProvider.notifier).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final metricsAsync = ref.watch(profileMetricsProvider);
    final pcsPaired = ref.watch(trustedDevicesProvider).value?.length ?? 0;
    final online = ref.watch(connectedDeviceProvider).value != null ? 1 : 0;

    return NeScaffold(
      title: l10n.profileTitle,
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
          pcsPaired: pcsPaired,
          online: online,
        ),
      ),
    );
  }

  List<Widget> _content(
    BuildContext context,
    AppLocalizations l10n,
    ProfileMetrics m, {
    required int pcsPaired,
    required int online,
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
        sliver: SliverToBoxAdapter(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: UxnanSpacing.maxContentWidth,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _IdentityHeader(
                    metrics: m,
                    pcsPaired: pcsPaired,
                    online: online,
                  ),
                  const SizedBox(height: UxnanSpacing.lg),
                  const _StatsHeader(),
                  const SizedBox(height: UxnanSpacing.sm),
                  MetricsStatGrid(metrics: m),
                  const SizedBox(height: UxnanSpacing.xl),
                  Text(l10n.profileActivity, style: titleStyle),
                  const SizedBox(height: UxnanSpacing.sm),
                  AgentActivitySection(firstYear: firstYear),
                  const SizedBox(height: UxnanSpacing.xl),
                  Text(l10n.profileBackupTitle, style: titleStyle),
                  const SizedBox(height: UxnanSpacing.sm),
                  const ProfileBackupSection(),
                  const SizedBox(height: UxnanSpacing.xl),
                  const UsageSection(),
                ],
              ),
            ),
          ),
        ),
      ),
    ];
  }
}

/// The stats section title plus a manual refresh — always available, whatever
/// the configured refresh mode. Mirrors the usage section's header: a spinner
/// replaces the button while a fetch is in flight, and the stats below stay put
/// (Riverpod keeps the previous value during a refresh).
class _StatsHeader extends ConsumerWidget {
  const _StatsHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final titleStyle = Theme.of(context).textTheme.titleLarge;
    final loading = ref.watch(metricsSnapshotsProvider).isLoading;
    final connected = ref.watch(connectedDeviceProvider).value != null;

    return Row(
      children: [
        Expanded(child: Text(l10n.profileStatsTitle, style: titleStyle)),
        if (loading)
          const Padding(
            padding: EdgeInsets.all(UxnanSpacing.md),
            child: PolygonLoader(),
          )
        else
          IconButton.filledTonal(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: l10n.profileStatsRefreshAction,
            // Nothing to fetch without a live PC; the cached stats stay shown.
            onPressed: connected
                ? () => ref.read(metricsSnapshotsProvider.notifier).refresh()
                : null,
          ),
      ],
    );
  }
}

class _IdentityHeader extends ConsumerWidget {
  const _IdentityHeader({
    required this.metrics,
    required this.pcsPaired,
    required this.online,
  });

  final ProfileMetrics metrics;
  final int pcsPaired;
  final int online;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final name = ref.watch(profileNameProvider) ?? l10n.profileDisplayName;
    final avatar = ref.watch(profileAvatarProvider);
    final since = metrics.memberSince;
    final subtitle = [
      if (since != null)
        l10n.profileMemberSince(DateFormat.yMMM().format(since)),
      l10n.profilePairedPcs(pcsPaired),
    ].join(' · ');

    return NeCard(
      color: colors.surfaceContainerHigh,
      padding: const EdgeInsets.all(UxnanSpacing.lg),
      // Tapping anywhere on the header (or the pencil) opens the editor.
      onTap: () => EditProfileSheet.show(context),
      child: Row(
        children: [
          ProfileAvatarView(avatar: avatar, size: 64),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: textTheme.titleLarge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.xs),
                Row(
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: online > 0
                            ? colors.primary
                            : colors.onSurfaceVariant,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    Text(
                      l10n.profileActiveSessions(online),
                      style: textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: l10n.profileEditTitle,
            onPressed: () => EditProfileSheet.show(context),
          ),
        ],
      ),
    );
  }
}
