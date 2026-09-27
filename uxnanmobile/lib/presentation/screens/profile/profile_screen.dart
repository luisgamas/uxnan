import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/enums/metrics_refresh_interval.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/domain/value_objects/spend_view.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/profile/agent_activity_section.dart';
import 'package:uxnan/presentation/screens/profile/profile_backup_actions.dart';
import 'package:uxnan/presentation/screens/profile/profile_identity_header.dart';
import 'package:uxnan/presentation/screens/profile/profile_metrics_widgets.dart';
import 'package:uxnan/presentation/screens/profile/spend_section.dart';
import 'package:uxnan/presentation/screens/profile/usage_format.dart';
import 'package:uxnan/presentation/screens/profile/usage_section.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_entrance_scope.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The profile, across every paired PC: who this is (the one name, this
/// phone's), what the agents spent (`usage/summary`), the connected PC's plan
/// limits, the activity (highlights, a year heatmap, the agents ranked) and
/// each PC, opening its own stats. Everything comes from the bridges; the
/// phone caches it per PC so a PC that is off still counts.
class ProfileScreen extends ConsumerStatefulWidget {
  /// Creates the [ProfileScreen].
  const ProfileScreen({this.embedded = false, super.key});

  /// Whether this is the **content of a pane** rather than a pushed screen.
  ///
  /// Embedded it keeps its title but drops the back arrow: `canPop` would
  /// answer for the Settings route still open on the left, so tapping it would
  /// leave Settings entirely.
  final bool embedded;

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
      ref.read(usageSummariesProvider.notifier).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final metricsAsync = ref.watch(profileMetricsProvider);

    return NeScaffold(
      automaticBackButton: !widget.embedded,
      title: l10n.profileTitle,
      actions: const [_RefreshAction(), _ProfileMenu()],
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
        data: (metrics) => _content(context, l10n, metrics),
      ),
    );
  }

  List<Widget> _content(
    BuildContext context,
    AppLocalizations l10n,
    ProfileMetrics m,
  ) {
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
        // **No second clamp here.** [NeScaffold] already stops every screen's
        // slivers at the window class's [UxnanBreakpoint.maxContentWidth],
        // measured from its own constraints (so it is right inside Settings'
        // pane too). A typographic line length is right for the conversation
        // and wrong for charts, provider cards and a 53-week heatmap.
        sliver: SliverToBoxAdapter(
          // Staggered by BLOCK, not by widget: the spacers between them are not
          // things that arrive.
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const NeEntranceRow(index: 0, child: ProfileIdentityHeader()),
              const SizedBox(height: UxnanSpacing.xl),
              const NeEntranceRow(index: 1, child: SpendSection()),
              const SizedBox(height: UxnanSpacing.xl),
              const NeEntranceRow(index: 2, child: UsageSection()),
              const SizedBox(height: UxnanSpacing.xl),
              NeEntranceRow(
                index: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(l10n.profileActivity, style: titleStyle),
                    const SizedBox(height: UxnanSpacing.sm),
                    ActivityHighlights(metrics: m),
                    const SizedBox(height: UxnanSpacing.md),
                    AgentActivitySection(firstYear: firstYear),
                  ],
                ),
              ),
              const SizedBox(height: UxnanSpacing.xl),
              const NeEntranceRow(index: 4, child: _YourPcs()),
            ],
          ),
        ),
      ),
    ];
  }
}

/// Every paired PC, each opening its own stats: the one connected now marked
/// live, and what its agents spent in the last 30 days beside it (from the
/// cache for a PC that is off).
class _YourPcs extends ConsumerWidget {
  const _YourPcs();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final devices = ref.watch(trustedDevicesProvider).value ?? const [];
    if (devices.isEmpty) return const SizedBox.shrink();
    final connected = ref.watch(connectedDeviceProvider).value?.macDeviceId;
    final summaries = ref.watch(usageSummariesProvider).value ?? const {};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.profilePcsTitle, style: textTheme.titleLarge),
        const SizedBox(height: UxnanSpacing.sm),
        ExpressiveCardGroup(
          count: devices.length,
          itemBuilder: (context, index, position) {
            final device = devices[index];
            final online = device.macDeviceId == connected;
            final summary = summaries[device.macDeviceId];
            final spent = summary == null
                ? null
                : computeSpendView([summary], 30, SpendMetric.cost).total;
            final detail = [
              if (online) l10n.profilePcOnline,
              if (spent != null && spent.responses > 0)
                l10n.profilePcSpent30(
                  spent.unpriced
                      ? fmtTokens(spent.tokens)
                      : fmtUsd(spent.costUsd),
                ),
            ].join(' · ');
            return NeNavTile(
              position: position,
              icon: UxIcons.laptopMac,
              title: device.displayName,
              // A PC that is off and spent nothing has nothing to say here, so
              // the row stays one line instead of holding an empty second one.
              subtitle: detail.isEmpty ? null : detail,
              onTap: () =>
                  context.push(AppRoutes.deviceStats(device.macDeviceId)),
            );
          },
        ),
      ],
    );
  }
}

/// Refreshes everything the profile reads: the activity, what the agents
/// spent and the plan limits — whatever the configured refresh mode. A spinner
/// replaces it while any of them is loading; the figures stay put meanwhile.
class _RefreshAction extends ConsumerWidget {
  const _RefreshAction();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final loading = ref.watch(metricsSnapshotsProvider).isLoading ||
        ref.watch(usageSummariesProvider).isLoading ||
        ref.watch(usageStatsProvider).isLoading;
    final connected = ref.watch(connectedDeviceProvider).value != null;
    if (loading) {
      return const Padding(
        padding: EdgeInsets.all(UxnanSpacing.md),
        child: PolygonLoader(),
      );
    }
    return IconSurface(
      icon: UxIcons.refresh,
      tooltip: l10n.profileStatsRefreshAction,
      // Nothing to fetch without a live PC; the cached figures stay shown.
      onPressed: connected
          ? () {
              ref.read(metricsSnapshotsProvider.notifier).refresh();
              ref.read(usageSummariesProvider.notifier).refresh();
              ref.read(usageStatsProvider.notifier).refresh();
            }
          : null,
    );
  }
}

/// The profile's overflow menu: the backup of the stats ledger. (The name and
/// the picture are changed on the identity header itself.)
///
/// Both used to be inline — the identity as a card at the top (a duplicate of
/// the overview's header, hidden one screen deeper) and the backup as a card at
/// the bottom, spending permanent screen space on two buttons pressed once a
/// year. They are actions, so they live where actions live.
///
/// Plain text entries, like every other menu in the app (the pairing menu on
/// the overview is the reference): no icons, no dividers, no explanatory
/// paragraph turned into a row. Export and import are sealed and verified BY
/// THE BRIDGE, so they need a live PC — offline they still open, and say why in
/// a snackbar, which is a sentence the user can read instead of a greyed row
/// they have to interpret.
class _ProfileMenu extends ConsumerWidget {
  const _ProfileMenu();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    return IconSurfaceMenu<_ProfileAction>(
      tooltip: l10n.profileMenuTooltip,
      icon: UxIcons.moreVert,
      onSelected: (action) {
        if (ref.read(connectedDeviceProvider).value == null) {
          ScaffoldMessenger.of(context)
            ..clearSnackBars()
            ..showSnackBar(
              SnackBar(content: Text(l10n.profileBackupOfflineHint)),
            );
          return;
        }
        switch (action) {
          case _ProfileAction.export:
            unawaited(exportMetricsBackup(context, ref));
          case _ProfileAction.import:
            unawaited(importMetricsBackup(context, ref));
        }
      },
      itemBuilder: (context) => [
        PopupMenuItem(
          value: _ProfileAction.export,
          child: Text(l10n.profileBackupExport),
        ),
        PopupMenuItem(
          value: _ProfileAction.import,
          child: Text(l10n.profileBackupImport),
        ),
      ],
    );
  }
}

/// The entries of the profile's overflow menu.
enum _ProfileAction { export, import }
