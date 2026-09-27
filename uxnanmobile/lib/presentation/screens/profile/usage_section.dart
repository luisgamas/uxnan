import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Plan limits: how much of each provider's allowance is used, read live from
/// the connected PC (`agent/usageStats` — the bridge asks Claude Code and Codex
/// themselves). Each window shows what is used, where the window stands in
/// time, and whether the current pace reaches the limit before it resets.
/// Codex's redeemable resets can be spent from here, as on the desktop.
///
/// Hidden while no PC is connected: limits are live, never cached.
class UsageSection extends ConsumerWidget {
  /// Creates a [UsageSection].
  const UsageSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final connected = ref.watch(connectedDeviceProvider).value;
    if (connected == null) return const SizedBox.shrink();
    final usageAsync = ref.watch(usageStatsProvider);
    final shown = (usageAsync.value ?? const <ProviderUsage>[])
        .where((u) => u.status != UsageStatus.notInstalled)
        .toList();
    final loading = usageAsync.isLoading;
    final use24h = ref.watch(usageClock24hProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.usageLimitsTitle, style: textTheme.titleLarge),
                  Text(
                    l10n.usageLimitsFrom(connected.displayName),
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (loading) const PolygonLoader(),
          ],
        ),
        const SizedBox(height: UxnanSpacing.sm),
        if (shown.isNotEmpty)
          ExpressiveCardGroup(
            count: shown.length,
            itemBuilder: (context, index, position) => _ProviderCard(
              usage: shown[index],
              use24h: use24h,
              position: position,
            ),
          )
        else if (!loading)
          Text(
            l10n.usageNoData,
            style:
                textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
          ),
      ],
    );
  }
}

class _ProviderCard extends ConsumerWidget {
  const _ProviderCard({
    required this.usage,
    required this.use24h,
    required this.position,
  });

  final ProviderUsage usage;
  final bool use24h;
  final CardGroupPosition position;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final agent = _agentOf(usage.provider);
    final plan = usage.account?.plan;
    final type = usage.account?.accountType;
    final resets = usage.resetCredits;
    return ExpressiveCard(
      position: position,
      color: colors.surfaceContainer,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (agent != null)
                AgentLogo(agent: agent, size: 22, color: colors.onSurface)
              else
                UxIcon(UxIcons.code, size: 22, color: colors.onSurfaceVariant),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Text(
                  _labelOf(usage.provider),
                  style: textTheme.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (plan != null) _Pill(label: plan),
              if (type != null && _accountTypeLabel(l10n, type) != plan) ...[
                const SizedBox(width: UxnanSpacing.xs),
                _Pill(label: _accountTypeLabel(l10n, type)),
              ],
            ],
          ),
          if (usage.status != UsageStatus.ok) ...[
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              usage.status == UsageStatus.error
                  ? (usage.message ?? l10n.usageLoadError)
                  : l10n.usageNotSignedIn,
              style: textTheme.bodySmall?.copyWith(
                color: usage.status == UsageStatus.error
                    ? colors.error
                    : colors.onSurfaceVariant,
              ),
            ),
          ] else ...[
            if (usage.windows.isEmpty && usage.credit == null)
              Padding(
                padding: const EdgeInsets.only(top: UxnanSpacing.sm),
                child: Text(
                  l10n.usageNoWindow,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ),
            for (final window in usage.windows) ...[
              const SizedBox(height: UxnanSpacing.md),
              _WindowBar(window: window, use24h: use24h),
            ],
            if (usage.credit != null) ...[
              const SizedBox(height: UxnanSpacing.md),
              _Line(
                icon: UxIcons.accountBalanceWallet,
                text: _creditLine(l10n, usage.credit!),
              ),
            ],
            if (resets != null && resets.available > 0) ...[
              const SizedBox(height: UxnanSpacing.sm),
              _Resets(provider: usage.provider, resets: resets),
            ],
          ],
        ],
      ),
    );
  }
}

/// One window: what is used, a mark where the window stands in time, when it
/// resets, and whether the current pace reaches the limit first.
class _WindowBar extends StatelessWidget {
  const _WindowBar({required this.window, required this.use24h});

  final UsageWindow window;
  final bool use24h;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final used = window.usedPercent.clamp(0, 100).toDouble();
    final pace = WindowPace.of(window, DateTime.now());
    final hot = pace?.runsOutIn != null;
    final fill = used >= 90 ? colors.error : colors.primary;
    final reset = window.resetsAt;
    final lines = [
      if (reset != null && reset.isAfter(DateTime.now()))
        _resetLabel(l10n, reset, use24h: use24h),
      if (pace != null && hot)
        l10n.usagePaceRunsOut(shortDuration(pace.runsOutIn!))
      else if (pace != null)
        l10n.usagePaceOk,
    ];
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
                color: fill,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        const SizedBox(height: UxnanSpacing.xs),
        Semantics(
          label: window.label,
          value: '${window.usedPercent.round()}%',
          child: SizedBox(
            height: 12,
            child: LayoutBuilder(
              builder: (context, constraints) => Stack(
                alignment: Alignment.centerLeft,
                children: [
                  ClipRRect(
                    borderRadius: const BorderRadius.all(UxnanRadius.full),
                    child: LinearProgressIndicator(
                      value: used / 100,
                      minHeight: UxnanSpacing.sm,
                      backgroundColor: colors.surfaceContainerHighest,
                      color: fill,
                    ),
                  ),
                  // Where the window stands in time: used left of this mark
                  // means spending slower than the window passes.
                  if (pace != null)
                    Positioned(
                      left: (constraints.maxWidth * pace.elapsed - 2)
                          .clamp(0, constraints.maxWidth - 4),
                      top: 0,
                      bottom: 0,
                      child: Container(
                        width: 4,
                        decoration: BoxDecoration(
                          color: colors.onSurface,
                          border: Border.symmetric(
                            vertical:
                                BorderSide(color: colors.surfaceContainer),
                          ),
                          borderRadius:
                              const BorderRadius.all(UxnanRadius.full),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        if (lines.isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(
            lines.join(' · '),
            style: textTheme.labelSmall?.copyWith(
              color: hot ? colors.error : colors.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

/// Where a usage window stands: how much of its time has passed, and — when
/// the pace so far would use the rest before it resets — how soon the limit
/// is reached.
class WindowPace {
  /// Creates a [WindowPace].
  const WindowPace({required this.elapsed, this.runsOutIn});

  /// The share of the window's time that has passed, 0–1.
  final double elapsed;

  /// How soon the limit is reached at the pace so far, when before the reset.
  final Duration? runsOutIn;

  /// The pace of [window] at [now], or null when the window gives no length
  /// or reset, or has barely begun (too early to say).
  static WindowPace? of(UsageWindow window, DateTime now) {
    final minutes = window.windowMinutes;
    final reset = window.resetsAt;
    if (minutes == null || minutes <= 0 || reset == null) return null;
    final length = Duration(minutes: minutes);
    final left = reset.difference(now);
    if (left.isNegative || left > length) return null;
    final passed = length - left;
    final elapsed = passed.inSeconds / length.inSeconds;
    if (elapsed < 0.05) return null;
    final used = window.usedPercent.clamp(0, 100).toDouble();
    if (used <= 0) return WindowPace(elapsed: elapsed);
    if (used >= 100) {
      return WindowPace(elapsed: elapsed, runsOutIn: Duration.zero);
    }
    final secondsPerPercent = passed.inSeconds / used;
    final toLimit =
        Duration(seconds: ((100 - used) * secondsPerPercent).round());
    return WindowPace(
      elapsed: elapsed,
      runsOutIn: toLimit < left ? toLimit : null,
    );
  }
}

/// Codex's redeemable resets: how many, when the next one expires, and a
/// button that spends the soonest-expiring one, after a confirmation.
class _Resets extends ConsumerStatefulWidget {
  const _Resets({required this.provider, required this.resets});

  final UsageProvider provider;
  final ResetCredits resets;

  @override
  ConsumerState<_Resets> createState() => _ResetsState();
}

class _ResetsState extends ConsumerState<_Resets> {
  bool _busy = false;

  Future<void> _redeem() async {
    final l10n = AppLocalizations.of(context);
    final next = widget.resets.entries.firstOrNull;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.usageRedeemTitle),
        content: Text(
          l10n.usageRedeemBody(widget.resets.available - 1),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.usageRedeemAction),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(usageStatsProvider.notifier).redeemReset(
            widget.provider,
            attempt: const Uuid().v4(),
            creditId: next?.id,
          );
    } on UsageRedeemException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..clearSnackBars()
          ..showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final expires = widget.resets.entries.firstOrNull?.expiresAt;
    return Row(
      children: [
        Expanded(
          child: _Line(
            icon: UxIcons.refresh,
            text: [
              l10n.usageResetsAvailable(widget.resets.available),
              if (expires != null)
                l10n.usageResetExpires(DateFormat.MMMd().format(expires)),
            ].join(' · '),
          ),
        ),
        const SizedBox(width: UxnanSpacing.sm),
        FilledButton.tonal(
          onPressed: _busy ? null : _redeem,
          child: Text(l10n.usageRedeemAction),
        ),
      ],
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.icon, required this.text});

  final UxIconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      children: [
        UxIcon(icon, size: 16, color: colors.onSurfaceVariant),
        const SizedBox(width: UxnanSpacing.sm),
        Expanded(
          child: Text(
            text,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: colors.onSurfaceVariant),
          ),
        ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: colors.onSurfaceVariant),
      ),
    );
  }
}

/// A duration, short: `45min`, `6h 30min`, `3d 4h`.
String shortDuration(Duration d) {
  if (d.inDays >= 1) {
    final h = d.inHours % 24;
    return h == 0 ? '${d.inDays}d' : '${d.inDays}d ${h}h';
  }
  final hours = d.inHours;
  final minutes = d.inMinutes % 60;
  if (hours == 0) return '${minutes}min';
  return minutes == 0 ? '${hours}h' : '${hours}h ${minutes}min';
}

/// The reset label: a relative duration for a window resetting within a day
/// ("Resets in 6h 30min"), days and the clock time past that ("Resets in 5d at
/// 14:30" / "… 2:30 PM").
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
  return l10n.usageResetsIn(shortDuration(diff));
}

String _creditLine(AppLocalizations l10n, CreditBalance credit) {
  final used = credit.used.toStringAsFixed(2);
  final amount = credit.limit != null
      ? '$used / ${credit.limit!.toStringAsFixed(2)} ${credit.currency}'
      : '$used ${credit.currency}';
  return '${l10n.usageCreditLabel}: $amount · ${credit.period}';
}

AgentId? _agentOf(UsageProvider provider) => switch (provider) {
      UsageProvider.codex => AgentId.codex,
      UsageProvider.claude => AgentId.claudeCode,
      UsageProvider.grok => AgentId.grok,
      UsageProvider.copilot => null,
    };

String _labelOf(UsageProvider provider) => switch (provider) {
      UsageProvider.codex => 'Codex',
      UsageProvider.claude => 'Claude',
      UsageProvider.grok => 'Grok',
      UsageProvider.copilot => 'GitHub Copilot',
    };

String _accountTypeLabel(AppLocalizations l10n, AccountType type) =>
    switch (type) {
      AccountType.subscription => l10n.usageAccountSubscription,
      AccountType.payAsYouGo => l10n.usageAccountPayAsYouGo,
      AccountType.free => l10n.usageAccountFree,
      AccountType.team => l10n.usageAccountTeam,
      AccountType.enterprise => l10n.usageAccountEnterprise,
    };
