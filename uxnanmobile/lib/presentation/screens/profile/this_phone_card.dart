import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/device_name_dialog.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// This phone, as its PCs see it: the name every paired PC shows for it (the
/// same on all of them), and what it is — on the profile, beside the stats
/// that are this phone's too. Renaming here reaches the connected
/// PC now and the others the next time the phone connects to them.
class ThisPhoneCard extends ConsumerWidget {
  /// Creates a [ThisPhoneCard].
  const ThisPhoneCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final name = ref.watch(phoneNameProvider).value;
    final details = ref.watch(phoneDetailsProvider).value;
    final shown = name ?? details?.defaultName;
    if (shown == null) return const SizedBox.shrink();
    final about = [
      if (details?.model case final String model when model != shown) model,
      if (details?.osVersion case final String os)
        if (details?.platform == 'ios') 'iOS $os' else 'Android $os',
    ].join(' · ');
    return NeCard(
      child: Row(
        children: [
          UxIcon(UxIcons.smartphone, color: colors.primary),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.thisPhoneLabel,
                  style: textTheme.labelMedium?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                Text(
                  shown,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.titleSmall,
                ),
                if (about.isNotEmpty)
                  Text(
                    about,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
          IconButton(
            tooltip: l10n.thisPhoneRename,
            icon: const UxIcon(UxIcons.edit, size: 20),
            color: colors.onSurfaceVariant,
            onPressed: () async {
              final next = await DeviceNameDialog.show(
                context,
                shown,
                title: l10n.thisPhoneRename,
              );
              if (next == null || next.isEmpty) return;
              await ref.read(bridgeReplicaProvider).renameThisPhone(next);
            },
          ),
        ],
      ),
    );
  }
}
