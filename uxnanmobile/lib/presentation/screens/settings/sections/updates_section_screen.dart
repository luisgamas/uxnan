import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// The Updates settings section: the current update state plus an explicit
/// check/apply action (no silent install).
///
/// This is the minimal, behavior-preserving move of the former inline update
/// card into its own section screen. The richer flow (current-version display,
/// in-section download → install, configurable check interval) is layered on
/// top of this screen in a follow-up.
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
            children: const [_UpdatesTile()],
          ),
        ),
      ],
    );
  }
}

/// The app-update row: current state + an explicit check/apply action (no
/// silent install). Rendered as a single dynamic-corner card.
class _UpdatesTile extends ConsumerWidget {
  const _UpdatesTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final state = ref.watch(appUpdateControllerProvider);
    final controller = ref.read(appUpdateControllerProvider.notifier);
    final unsupported = state.status?.channel == UpdateChannel.unsupported;

    final String subtitle;
    switch (state.phase) {
      case AppUpdatePhase.checking:
        subtitle = l10n.updateStatusChecking;
      case AppUpdatePhase.upToDate:
        subtitle = unsupported
            ? l10n.updateStatusUnsupported
            : l10n.updateStatusUpToDate;
      case AppUpdatePhase.available:
        final version = state.status?.storeVersion;
        subtitle = version == null
            ? l10n.updateAvailableBody
            : l10n.updateAvailableBodyVersion(version);
      case AppUpdatePhase.error:
        subtitle = l10n.updateStatusError;
      case AppUpdatePhase.idle:
        subtitle = l10n.updateCheckSubtitle;
    }

    final Widget trailing;
    if (state.phase == AppUpdatePhase.checking) {
      trailing = const SizedBox(
        width: 20,
        height: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    } else if (state.hasUpdate) {
      trailing = FilledButton(
        onPressed: state.starting ? null : controller.startUpdate,
        child: Text(
          state.starting ? l10n.updateActionStarting : l10n.updateAction,
        ),
      );
    } else {
      trailing = TextButton(
        onPressed: unsupported ? null : controller.check,
        child: Text(l10n.updateCheckAction),
      );
    }

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
}
