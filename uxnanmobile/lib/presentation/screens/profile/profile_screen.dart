import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/edit_profile_sheet.dart';
import 'package:uxnan/presentation/screens/profile/profile_metrics_widgets.dart';
import 'package:uxnan/presentation/screens/profile/usage_section.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/activity_section.dart';
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
            MetricsStatGrid(metrics: m),
            const SizedBox(height: UxnanSpacing.xl),
            Text(l10n.profileActivity, style: titleStyle),
            const SizedBox(height: UxnanSpacing.sm),
            ActivitySection(firstYear: firstYear),
            const SizedBox(height: UxnanSpacing.xl),
            if (m.byAgent.isNotEmpty) ...[
              Text(l10n.profileByAgent, style: titleStyle),
              const SizedBox(height: UxnanSpacing.sm),
              MetricsAgentBreakdown(byAgent: m.byAgent),
            ],
            const UsageSection(),
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
