import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/update_check_interval.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/app_info_provider.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The Updates settings section: the installed version, the live update state
/// with an in-section download → install flow (no silent install), and a
/// configurable automatic check interval.
class UpdatesSectionScreen extends ConsumerWidget {
  /// Creates the updates section screen.
  const UpdatesSectionScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const UpdatesSectionScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    return NeScaffold(
      title: l10n.settingsUpdatesSection,
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
              NeSectionHeader(
                label: l10n.settingsUpdatesVersionGroup,
                first: true,
              ),
              const _CurrentVersionCard(),
              const SizedBox(height: UxnanSpacing.sm),
              const _UpdateStateCard(),
              NeSectionHeader(label: l10n.updateIntervalSectionTitle),
              const _IntervalSelector(),
            ],
          ),
        ),
      ],
    );
  }
}

/// The installed app version row (name + build), from `package_info_plus`.
class _CurrentVersionCard extends ConsumerWidget {
  const _CurrentVersionCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final info = ref.watch(appPackageInfoProvider);
    final version = info.maybeWhen(
      data: (i) =>
          i.buildNumber.isEmpty ? i.version : '${i.version} (${i.buildNumber})',
      orElse: () => '—',
    );

    return ExpressiveCard(
      color: colors.surfaceContainer,
      padding: EdgeInsets.zero,
      child: ListTile(
        leading: Icon(
          Icons.info_outline_rounded,
          color: colors.onSurfaceVariant,
        ),
        title: Text(l10n.updateCurrentVersionTitle),
        subtitle: Text(version),
      ),
    );
  }
}

/// The live update-state card: reflects checking / up-to-date / available /
/// downloading (+% when known) / downloaded (install banner) / installing /
/// error, with the matching primary action.
class _UpdateStateCard extends ConsumerWidget {
  const _UpdateStateCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final state = ref.watch(appUpdateControllerProvider);
    final controller = ref.read(appUpdateControllerProvider.notifier);
    final unsupported = state.status?.channel == UpdateChannel.unsupported;

    final subtitle = _subtitle(l10n, state, unsupported: unsupported);
    final trailing = _trailing(
      l10n,
      controller,
      state,
      unsupported: unsupported,
    );

    return ExpressiveCard(
      color: colors.surfaceContainer,
      padding: EdgeInsets.zero,
      child: ListTile(
        leading: Icon(
          Icons.system_update_outlined,
          color: colors.onSurfaceVariant,
        ),
        title: Text(l10n.updateCheckTitle),
        subtitle: Text(subtitle),
        trailing: trailing,
      ),
    );
  }

  String _subtitle(
    AppLocalizations l10n,
    AppUpdateState state, {
    required bool unsupported,
  }) {
    switch (state.phase) {
      case AppUpdatePhase.checking:
        return l10n.updateStatusChecking;
      case AppUpdatePhase.upToDate:
        return unsupported
            ? l10n.updateStatusUnsupported
            : l10n.updateStatusUpToDate;
      case AppUpdatePhase.available:
        final version = state.status?.storeVersion;
        return version == null
            ? l10n.updateAvailableBody
            : l10n.updateAvailableBodyVersion(version);
      case AppUpdatePhase.downloading:
        final fraction = state.install?.fraction;
        return fraction == null
            ? l10n.updateStatusDownloading
            : l10n.updateStatusDownloadingPercent((fraction * 100).round());
      case AppUpdatePhase.downloaded:
        return l10n.updateStatusDownloaded;
      case AppUpdatePhase.installing:
        return l10n.updateStatusInstalling;
      case AppUpdatePhase.error:
        return l10n.updateStatusError;
      case AppUpdatePhase.idle:
        return l10n.updateCheckSubtitle;
    }
  }

  Widget _trailing(
    AppLocalizations l10n,
    AppUpdateController controller,
    AppUpdateState state, {
    required bool unsupported,
  }) {
    switch (state.phase) {
      case AppUpdatePhase.checking:
      case AppUpdatePhase.installing:
        return const SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(strokeWidth: 2),
        );
      case AppUpdatePhase.downloading:
        final fraction = state.install?.fraction;
        return SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(strokeWidth: 2, value: fraction),
        );
      case AppUpdatePhase.downloaded:
        return FilledButton(
          onPressed: controller.install,
          child: Text(l10n.updateInstallAction),
        );
      case AppUpdatePhase.available:
        final isIos = state.status?.channel == UpdateChannel.appStore;
        return FilledButton(
          onPressed: state.starting ? null : controller.download,
          child: Text(
            isIos ? l10n.updateAction : l10n.updateDownloadAction,
          ),
        );
      case AppUpdatePhase.idle:
      case AppUpdatePhase.upToDate:
      case AppUpdatePhase.error:
        return TextButton(
          onPressed: unsupported ? null : controller.check,
          child: Text(l10n.updateCheckAction),
        );
    }
  }
}

/// The automatic check-interval selector: a radio-row card group for the seven
/// [UpdateCheckInterval] options.
class _IntervalSelector extends ConsumerWidget {
  const _IntervalSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final selected = ref.watch(
      appUpdateControllerProvider.select((s) => s.interval),
    );
    final controller = ref.read(appUpdateControllerProvider.notifier);
    const options = UpdateCheckInterval.values;

    return RadioGroup<UpdateCheckInterval>(
      groupValue: selected,
      onChanged: (value) {
        if (value != null) controller.setInterval(value);
      },
      child: ExpressiveCardGroup(
        count: options.length,
        itemBuilder: (context, i, pos) => ExpressiveCard(
          position: pos,
          color: colors.surfaceContainer,
          padding: EdgeInsets.zero,
          child: RadioListTile<UpdateCheckInterval>(
            value: options[i],
            title: Text(_label(l10n, options[i])),
          ),
        ),
      ),
    );
  }

  String _label(AppLocalizations l10n, UpdateCheckInterval interval) =>
      switch (interval) {
        UpdateCheckInterval.everyLaunch => l10n.updateIntervalEveryLaunch,
        UpdateCheckInterval.every6h => l10n.updateIntervalEvery6h,
        UpdateCheckInterval.every12h => l10n.updateIntervalEvery12h,
        UpdateCheckInterval.every24h => l10n.updateIntervalEvery24h,
        UpdateCheckInterval.every48h => l10n.updateIntervalEvery48h,
        UpdateCheckInterval.weekly => l10n.updateIntervalWeekly,
        UpdateCheckInterval.monthly => l10n.updateIntervalMonthly,
      };
}
