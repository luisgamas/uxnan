import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/metrics_refresh_interval.dart';
import 'package:uxnan/domain/enums/usage_refresh_interval.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The "Metrics & provider usage" settings section — the two independent things
/// the profile reads from a connected PC:
///
/// - **Profile stats** (`metrics/*`): how the profile's own stats stay current.
/// - **Provider usage** (`agent/usageStats`): how often each provider's
///   remaining limits are re-read, and how their reset times are formatted.
class MetricsUsageSettingsScreen extends ConsumerWidget {
  /// Creates the metrics & provider-usage settings screen.
  const MetricsUsageSettingsScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const MetricsUsageSettingsScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    return NeScaffold(
      title: l10n.settingsUsageSection,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.lg,
            UxnanSpacing.xxl,
          ),
          sliver: SliverList.list(
            children: [
              NeSectionHeader(label: l10n.settingsMetricsGroup, first: true),
              const _MetricsIntervalSelector(),
              NeSectionHint(text: l10n.metricsRefreshHint),
              NeSectionHeader(label: l10n.settingsProviderUsageGroup),
              NeSectionHint(text: l10n.settingsProviderUsageExplainer),
              const _IntervalSelector(),
              NeSectionHint(text: l10n.usageRefreshHint),
              NeSectionHeader(label: l10n.settingsUsageClockGroup),
              const _ClockToggle(),
            ],
          ),
        ),
      ],
    );
  }
}

/// The 24-hour vs 12-hour clock toggle for usage reset times.
class _ClockToggle extends ConsumerWidget {
  const _ClockToggle();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final value = ref.watch(usageClock24hProvider);
    return NeSwitchTile(
      icon: Icons.schedule_rounded,
      title: l10n.usageClock24hTitle,
      subtitle: l10n.usageClock24hSubtitle,
      value: value,
      onChanged: (v) => ref.read(usageClock24hProvider.notifier).set(value: v),
    );
  }
}

/// The profile-stats refresh-mode selector: a radio-row card group.
class _MetricsIntervalSelector extends ConsumerWidget {
  const _MetricsIntervalSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final selected = ref.watch(metricsRefreshIntervalProvider);
    final controller = ref.read(metricsRefreshIntervalProvider.notifier);
    const options = MetricsRefreshInterval.values;

    return RadioGroup<MetricsRefreshInterval>(
      groupValue: selected,
      onChanged: (value) {
        if (value != null) controller.set(value);
      },
      child: ExpressiveCardGroup(
        count: options.length,
        itemBuilder: (context, i, pos) => ExpressiveCard(
          position: pos,
          color: colors.surfaceContainer,
          padding: EdgeInsets.zero,
          child: RadioListTile<MetricsRefreshInterval>(
            value: options[i],
            title: Text(_label(l10n, options[i])),
          ),
        ),
      ),
    );
  }

  String _label(AppLocalizations l10n, MetricsRefreshInterval interval) =>
      switch (interval) {
        MetricsRefreshInterval.automatic => l10n.metricsIntervalAutomatic,
        MetricsRefreshInterval.every5m => l10n.usageInterval5m,
        MetricsRefreshInterval.every15m => l10n.metricsInterval15m,
        MetricsRefreshInterval.every30m => l10n.metricsInterval30m,
        MetricsRefreshInterval.every1h => l10n.usageInterval1h,
        MetricsRefreshInterval.manual => l10n.usageIntervalManual,
      };
}

/// The auto-refresh-interval selector: a radio-row card group.
class _IntervalSelector extends ConsumerWidget {
  const _IntervalSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final selected = ref.watch(usageRefreshIntervalProvider);
    final controller = ref.read(usageRefreshIntervalProvider.notifier);
    const options = UsageRefreshInterval.values;

    return RadioGroup<UsageRefreshInterval>(
      groupValue: selected,
      onChanged: (value) {
        if (value != null) controller.set(value);
      },
      child: ExpressiveCardGroup(
        count: options.length,
        itemBuilder: (context, i, pos) => ExpressiveCard(
          position: pos,
          color: colors.surfaceContainer,
          padding: EdgeInsets.zero,
          child: RadioListTile<UsageRefreshInterval>(
            value: options[i],
            title: Text(_label(l10n, options[i])),
          ),
        ),
      ),
    );
  }

  String _label(AppLocalizations l10n, UsageRefreshInterval interval) =>
      switch (interval) {
        UsageRefreshInterval.manual => l10n.usageIntervalManual,
        UsageRefreshInterval.every5m => l10n.usageInterval5m,
        UsageRefreshInterval.every10m => l10n.usageInterval10m,
        UsageRefreshInterval.every20m => l10n.usageInterval20m,
        UsageRefreshInterval.every1h => l10n.usageInterval1h,
      };
}
