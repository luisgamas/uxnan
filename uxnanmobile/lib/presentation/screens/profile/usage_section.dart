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
import 'package:uxnan/presentation/widgets/ne_card.dart';

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
              IconButton(
                icon: const Icon(Icons.refresh_rounded),
                tooltip: l10n.usageRefreshAction,
                onPressed: () =>
                    ref.read(usageStatsProvider.notifier).refresh(),
              ),
          ],
        ),
        const SizedBox(height: UxnanSpacing.sm),
        if (shown.isNotEmpty)
          for (var i = 0; i < shown.length; i++) ...[
            if (i > 0) const SizedBox(height: UxnanSpacing.sm),
            _ProviderUsageCard(usage: shown[i], use24h: use24h),
          ]
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
  const _ProviderUsageCard({required this.usage, required this.use24h});

  final ProviderUsage usage;
  final bool use24h;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final visuals = _visualsFor(usage.provider);

    return NeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SizedBox(
                width: 20,
                height: 20,
                child: visuals.logo != null
                    ? SvgPicture.asset(visuals.logo!)
                    : Icon(
                        visuals.icon,
                        size: 20,
                        color: colors.onSurfaceVariant,
                      ),
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Text(
                  visuals.label,
                  style: textTheme.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (usage.account?.plan != null) ...[
                const SizedBox(width: UxnanSpacing.sm),
                Text(
                  usage.account!.plan!,
                  style: textTheme.labelSmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
              if (usage.status != UsageStatus.ok) ...[
                const SizedBox(width: UxnanSpacing.sm),
                _StatusPill(status: usage.status),
              ],
            ],
          ),
          if (usage.status == UsageStatus.ok) ...[
            for (final window in usage.windows) ...[
              const SizedBox(height: UxnanSpacing.md),
              _WindowBar(window: window, use24h: use24h),
            ],
            if (usage.credit != null) ...[
              const SizedBox(height: UxnanSpacing.md),
              Text(
                _creditLine(l10n, usage.credit!),
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
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
                style: textTheme.bodySmall,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Text(
              '${window.usedPercent.round()}%',
              style: textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
            ),
          ],
        ),
        const SizedBox(height: UxnanSpacing.xs),
        ClipRRect(
          borderRadius: const BorderRadius.all(UxnanRadius.full),
          child: LinearProgressIndicator(
            value: fraction,
            minHeight: 6,
            backgroundColor: colors.surfaceContainerHigh,
            color: colors.primary,
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

    return Container(
      padding:
          const EdgeInsets.symmetric(horizontal: UxnanSpacing.sm, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg),
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
