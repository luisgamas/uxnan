import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/edit_profile_sheet.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/activity_section.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';

/// Aggregate activity across every paired PC: identity header, headline stats,
/// a GitHub-style contribution heatmap and a per-agent breakdown — all derived
/// locally.
class ProfileScreen extends ConsumerWidget {
  /// Creates the [ProfileScreen].
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
            _IdentityHeader(
              metrics: m,
              pcsPaired: pcsPaired,
              online: online,
            ),
            const SizedBox(height: UxnanSpacing.lg),
            _StatGrid(metrics: m),
            const SizedBox(height: UxnanSpacing.xl),
            Text(l10n.profileActivity, style: titleStyle),
            const SizedBox(height: UxnanSpacing.sm),
            ActivitySection(firstYear: firstYear),
            const SizedBox(height: UxnanSpacing.xl),
            if (m.byAgent.isNotEmpty) ...[
              Text(l10n.profileByAgent, style: titleStyle),
              const SizedBox(height: UxnanSpacing.sm),
              _AgentBreakdown(byAgent: m.byAgent),
            ],
          ],
        ),
      ),
    ];
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
      // Tapping anywhere on the header (or the pencil) opens the editor.
      onTap: () => EditProfileSheet.show(context),
      child: Row(
        children: [
          ProfileAvatarView(avatar: avatar),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: textTheme.titleMedium,
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

class _StatGrid extends StatelessWidget {
  const _StatGrid({required this.metrics});

  final ProfileMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final m = metrics;
    // Order requested: connection stats first, then conversation volume, then
    // work/details (three tiles per row).
    final tiles = <_StatTile>[
      _StatTile(
        value: _fmtDuration(m.totalConnected),
        label: l10n.statTimeConnected,
      ),
      _StatTile(
        value: _fmtDuration(m.longestSession),
        label: l10n.statLongestSession,
      ),
      _StatTile(value: '${m.agentsUsed}', label: l10n.statAgentsUsed),
      _StatTile(value: '${m.conversations}', label: l10n.statConversations),
      _StatTile(value: '${m.messages}', label: l10n.statMessages),
      _StatTile(value: '${m.sessions}', label: l10n.statSessions),
      _StatTile(value: '${m.gitActions}', label: l10n.statGitActions),
      _StatTile(
        value: switch (m.mostUsedTransport) {
          ConnectionTransport.relay => l10n.connectionRelay,
          ConnectionTransport.direct => l10n.connectionDirect,
          null => '—',
        },
        label: l10n.statMostUsedTransport,
      ),
      _StatTile(value: '${m.modelsUsed}', label: l10n.statModelsUsed),
    ];

    // Lay the tiles out three-per-row with equal widths.
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 3) {
      final chunk = tiles.sublist(i, (i + 3).clamp(0, tiles.length));
      rows.add(
        Row(
          children: [
            for (var j = 0; j < 3; j++) ...[
              Expanded(
                child: j < chunk.length ? chunk[j] : const SizedBox.shrink(),
              ),
              if (j < 2) const SizedBox(width: UxnanSpacing.sm),
            ],
          ],
        ),
      );
      if (i + 3 < tiles.length) {
        rows.add(const SizedBox(height: UxnanSpacing.sm));
      }
    }
    return Column(children: rows);
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    // A fixed height keeps every tile in a row the same size (labels may wrap
    // to two lines) without a cross-axis stretch, which would demand an
    // unbounded height inside the scrolling sliver.
    return Container(
      height: 92,
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: UxnanSpacing.md,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceContainer,
        borderRadius: const BorderRadius.all(UxnanRadius.xl),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: textTheme.headlineMedium?.copyWith(color: colors.onSurface),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _AgentBreakdown extends StatelessWidget {
  const _AgentBreakdown({required this.byAgent});

  final List<AgentUsage> byAgent;

  @override
  Widget build(BuildContext context) {
    final maxCount = byAgent.fold<int>(
      1,
      (m, a) => a.conversations > m ? a.conversations : m,
    );
    // One card per agent so each has room to breathe.
    return Column(
      children: [
        for (var i = 0; i < byAgent.length; i++) ...[
          if (i > 0) const SizedBox(height: UxnanSpacing.sm),
          _AgentCard(usage: byAgent[i], maxCount: maxCount),
        ],
      ],
    );
  }
}

/// One agent's usage as its own roomy card: logo, name + a proportional bar,
/// and the conversation count with a label saying what the number is.
class _AgentCard extends StatelessWidget {
  const _AgentCard({required this.usage, required this.maxCount});

  final AgentUsage usage;
  final int maxCount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final id = AgentIdParsing.fromWireId(usage.agentId);
    final logo = AgentVisuals.logoFor(id);
    final accent = AgentVisuals.colorFor(id);
    final fraction = (usage.conversations / maxCount).clamp(0.0, 1.0);

    return NeCard(
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: colors.surfaceContainerHigh,
              shape: BoxShape.circle,
              border: Border.all(color: colors.outline),
            ),
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: logo != null
                    ? SvgPicture.asset(logo)
                    : Icon(
                        Icons.smart_toy_outlined,
                        size: 22,
                        color: colors.onSurfaceVariant,
                      ),
              ),
            ),
          ),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  AgentVisuals.labelFor(id),
                  style: textTheme.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: UxnanSpacing.sm),
                ClipRRect(
                  borderRadius: const BorderRadius.all(UxnanRadius.full),
                  child: LinearProgressIndicator(
                    value: fraction,
                    minHeight: 6,
                    backgroundColor: colors.surfaceContainerHigh,
                    color: accent,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: UxnanSpacing.md),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${usage.conversations}',
                style: textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                l10n.profileAgentConversationsLabel,
                style: textTheme.labelSmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Formats a [Duration] compactly: `45s`, `12m`, `3h 12m`, `5h`.
String _fmtDuration(Duration d) {
  if (d.inSeconds < 60) return '${d.inSeconds}s';
  if (d.inMinutes < 60) return '${d.inMinutes}m';
  final h = d.inHours;
  final m = d.inMinutes % 60;
  return m == 0 ? '${h}h' : '${h}h ${m}m';
}
