import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/metrics_refresh_interval.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/agent_activity_section.dart';
import 'package:uxnan/presentation/screens/profile/edit_profile_sheet.dart';
import 'package:uxnan/presentation/screens/profile/profile_backup_actions.dart';
import 'package:uxnan/presentation/screens/profile/profile_metrics_widgets.dart';
import 'package:uxnan/presentation/screens/profile/usage_section.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_entrance_scope.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Aggregate activity across every paired PC: identity header, headline stats,
/// a GitHub-style contribution heatmap and a per-agent breakdown — all derived
/// from the bridge-owned snapshots.
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
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final metricsAsync = ref.watch(profileMetricsProvider);

    return NeScaffold(
      automaticBackButton: !widget.embedded,
      title: l10n.profileTitle,
      actions: const [_ProfileMenu()],
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
        sliver: SliverToBoxAdapter(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: UxnanSpacing.maxContentWidth,
              ),
              // Staggered by BLOCK, not by widget: the spacers between them
              // are not things that arrive, and the stats grid is one object
              // even though it draws several tiles.
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  NeEntranceRow(
                    index: 0,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const _StatsHeader(),
                        const SizedBox(height: UxnanSpacing.sm),
                        MetricsStatGrid(metrics: m),
                      ],
                    ),
                  ),
                  const SizedBox(height: UxnanSpacing.xl),
                  NeEntranceRow(
                    index: 1,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(l10n.profileActivity, style: titleStyle),
                        const SizedBox(height: UxnanSpacing.sm),
                        AgentActivitySection(firstYear: firstYear),
                      ],
                    ),
                  ),
                  const SizedBox(height: UxnanSpacing.xl),
                  const NeEntranceRow(index: 2, child: UsageSection()),
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
            icon: const UxIcon(UxIcons.refresh),
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

/// The profile's overflow menu: editing your identity, and the backup of the
/// stats ledger.
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
        if (action == _ProfileAction.edit) {
          EditProfileSheet.show(context);
          return;
        }
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
          case _ProfileAction.edit:
            break;
        }
      },
      itemBuilder: (context) => [
        PopupMenuItem(
          value: _ProfileAction.edit,
          child: Text(l10n.profileEditTitle),
        ),
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
enum _ProfileAction { edit, export, import }
