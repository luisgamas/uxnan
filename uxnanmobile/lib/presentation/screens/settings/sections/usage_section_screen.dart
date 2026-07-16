import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/usage_refresh_interval.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The Usage settings section: how often the profile's "Usage & credit" panel
/// polls the connected PC for provider usage (or manual-only).
class UsageSettingsScreen extends ConsumerWidget {
  /// Creates the usage settings screen.
  const UsageSettingsScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const UsageSettingsScreen()),
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
              NeSectionHeader(label: l10n.usageRefreshTitle, first: true),
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
