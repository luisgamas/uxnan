import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';

/// The "Usage & credit" block on the profile: per-provider quota windows, plan
/// and credit read live from the connected PC (`agent/usageStats`). While
/// connected the block is always present — it shows a loading state, then the
/// provider cards (not-installed providers hidden) with a manual refresh — and
/// the data is kept in memory so scrolling never reloads it. Hidden only when
/// offline (no PC to query).
class UsageSection extends ConsumerWidget {
  /// Creates a [UsageSection].
  const UsageSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final connected = ref.watch(connectedDeviceProvider).value;
    // Nothing to query without a live PC — hide the whole block.
    if (connected == null) return const SizedBox.shrink();

    final usageAsync = ref.watch(usageStatsProvider);
    // The data is kept in memory (the provider is not autoDispose), so it stays
    // put while scrolling and during a manual refresh.
    final data = usageAsync.value ?? const <ProviderUsage>[];
    final shown =
        data.where((u) => u.status != UsageStatus.notInstalled).toList();
    final loading = usageAsync.isLoading;
    final use24h = ref.watch(usageClock24hProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: UxnanSpacing.xl),
        Row(
          children: [
            Expanded(
              child: Text(l10n.profileUsageTitle, style: textTheme.titleMedium),
            ),
            if (loading)
              const Padding(
                padding: EdgeInsets.all(UxnanSpacing.md),
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else
              IconButton.filledTonal(
                icon: const Icon(Icons.refresh_rounded),
                tooltip: l10n.usageRefreshAction,
                onPressed: () =>
                    ref.read(usageStatsProvider.notifier).refresh(),
              ),
          ],
        ),
        const SizedBox(height: UxnanSpacing.sm),
        if (shown.isNotEmpty)
          ExpressiveCardGroup(
            count: shown.length,
            itemBuilder: (context, index, position) => _ProviderUsageCard(
              usage: shown[index],
              use24h: use24h,
              position: position,
            ),
          )
        else if (loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: UxnanSpacing.lg),
            child: Center(child: CircularProgressIndicator()),
          )
        else
          Text(
            l10n.usageNoData,
            style:
                textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
          ),
      ],
    );
  }
}

class _ProviderUsageCard extends StatelessWidget {
  const _ProviderUsageCard({
    required this.usage,
    required this.use24h,
    required this.position,
  });

  final ProviderUsage usage;
  final bool use24h;
  final CardGroupPosition position;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final visuals = _visualsFor(usage.provider);

    return ExpressiveCard(
      position: position,
      color: colors.surfaceContainer,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: colors.surfaceContainerHigh,
                  shape: BoxShape.circle,
                  border: Border.all(color: colors.outlineVariant),
                ),
                alignment: Alignment.center,
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: visuals.logo != null
                      ? SvgPicture.asset(visuals.logo!)
                      : Icon(
                          visuals.icon,
                          size: 24,
                          color: colors.onSurfaceVariant,
                        ),
                ),
              ),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      visuals.label,
                      style: textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (usage.account?.plan != null ||
                        usage.status != UsageStatus.ok) ...[
                      const SizedBox(height: UxnanSpacing.xs),
                      Wrap(
                        spacing: UxnanSpacing.xs,
                        runSpacing: UxnanSpacing.xs,
                        children: [
                          if (usage.account?.plan != null)
                            _PlanPill(label: usage.account!.plan!),
                          if (usage.status != UsageStatus.ok)
                            _StatusPill(status: usage.status),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if (usage.status == UsageStatus.ok) ...[
            for (final window in usage.windows) ...[
              const SizedBox(height: UxnanSpacing.md),
              _WindowBar(window: window, use24h: use24h),
            ],
            if (usage.credit != null) ...[
              const SizedBox(height: UxnanSpacing.md),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.md,
                  vertical: UxnanSpacing.sm,
                ),
                decoration: BoxDecoration(
                  color: colors.surfaceContainerHigh,
                  borderRadius: const BorderRadius.all(UxnanRadius.lg),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.account_balance_wallet_outlined,
                      size: 18,
                      color: colors.onSurfaceVariant,
                    ),
                    const SizedBox(width: UxnanSpacing.sm),
                    Expanded(
                      child: Text(
                        _creditLine(l10n, usage.credit!),
                        style: textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ] else if (usage.message != null) ...[
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              usage.message!,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _WindowBar extends StatelessWidget {
  const _WindowBar({required this.window, required this.use24h});

  final UsageWindow window;
  final bool use24h;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final fraction = (window.usedPercent / 100).clamp(0.0, 1.0);
    final reset = window.resetsAt;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                window.label,
                style: textTheme.labelLarge,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Text(
              '${window.usedPercent.round()}%',
              style: textTheme.titleSmall?.copyWith(
                color: colors.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        const SizedBox(height: UxnanSpacing.xs),
        Semantics(
          label: window.label,
          value: '${window.usedPercent.round()}%',
          child: ClipRRect(
            borderRadius: const BorderRadius.all(UxnanRadius.full),
            child: LinearProgressIndicator(
              value: fraction,
              minHeight: UxnanSpacing.sm,
              backgroundColor: colors.surfaceContainerHighest,
              color: colors.primary,
            ),
          ),
        ),
        if (reset != null && reset.isAfter(DateTime.now())) ...[
          const SizedBox(height: 2),
          Text(
            _resetLabel(l10n, reset, use24h: use24h),
            style:
                textTheme.labelSmall?.copyWith(color: colors.onSurfaceVariant),
          ),
        ],
      ],
    );
  }
}

class _PlanPill extends StatelessWidget {
  const _PlanPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: UxnanSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Text(
        label,
        style: textTheme.labelSmall?.copyWith(color: colors.onSurfaceVariant),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final UsageStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final isError = status == UsageStatus.error;
    final label = isError ? l10n.usageLoadError : l10n.usageNotSignedIn;
    final bg = isError ? colors.errorContainer : colors.secondaryContainer;
    final fg = isError ? colors.onErrorContainer : colors.onSecondaryContainer;

    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: UxnanSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Text(
        label,
        style: textTheme.labelSmall?.copyWith(color: fg),
      ),
    );
  }
}

/// Builds the reset label: a relative duration for windows resetting within a
/// day ("Resets in 6h 30min"), or days-remaining + the clock time for longer
/// (weekly/monthly) windows ("Resets in 5d at 14:30" / "… 2:30 PM").
String _resetLabel(
  AppLocalizations l10n,
  DateTime reset, {
  required bool use24h,
}) {
  final diff = reset.difference(DateTime.now());
  final clock = use24h ? DateFormat.Hm() : DateFormat.jm();
  if (diff.inDays >= 1) {
    return l10n.usageResetsInDays(diff.inDays, clock.format(reset));
  }
  final hours = diff.inHours;
  final minutes = diff.inMinutes % 60;
  final duration = hours > 0
      ? (minutes > 0 ? '${hours}h ${minutes}min' : '${hours}h')
      : '${minutes}min';
  return l10n.usageResetsIn(duration);
}

String _creditLine(AppLocalizations l10n, CreditBalance credit) {
  final used = credit.used.toStringAsFixed(2);
  final amount = credit.limit != null
      ? '$used / ${credit.limit!.toStringAsFixed(2)} ${credit.currency}'
      : '$used ${credit.currency}';
  return '${l10n.usageCreditLabel}: $amount · ${credit.period}';
}

typedef _ProviderVisuals = ({String label, String? logo, IconData icon});

_ProviderVisuals _visualsFor(UsageProvider provider) {
  AgentId? agent;
  String label;
  switch (provider) {
    case UsageProvider.codex:
      agent = AgentId.codex;
      label = 'Codex';
    case UsageProvider.claude:
      agent = AgentId.claudeCode;
      label = 'Claude';
    case UsageProvider.gemini:
      agent = AgentId.geminiCli;
      label = 'Gemini';
    case UsageProvider.grok:
      agent = AgentId.grok;
      label = 'Grok';
    case UsageProvider.copilot:
      agent = null;
      label = 'GitHub Copilot';
  }
  return (
    label: label,
    logo: agent != null ? AgentVisuals.logoFor(agent) : null,
    icon: Icons.code_rounded,
  );
}
