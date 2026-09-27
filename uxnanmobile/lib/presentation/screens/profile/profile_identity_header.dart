import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/avatar_sheet.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/device_name_dialog.dart';
import 'package:uxnan/presentation/widgets/ne_badge.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Who this is: the picture, and the one name — this phone's, the same on
/// every paired PC (the desktop and the bridge show it too) — with what the
/// phone is, how many PCs it is paired with and since when.
///
/// The picture opens [AvatarSheet]; the pencil renames the phone, which reaches
/// the connected PC now and the others the next time the phone connects to
/// them.
class ProfileIdentityHeader extends ConsumerWidget {
  /// Creates a [ProfileIdentityHeader].
  const ProfileIdentityHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final name = ref.watch(shownPhoneNameProvider);
    final details = ref.watch(phoneDetailsProvider).value;
    final pcs = ref.watch(trustedDevicesProvider).value?.length ?? 0;
    final online = ref.watch(connectedDeviceProvider).value != null ? 1 : 0;
    final since = ref.watch(memberSinceProvider);
    final about = [
      if (details?.model case final String model when model != name) model,
      if (details?.osVersion case final String os)
        if (details?.platform == 'ios') 'iOS $os' else 'Android $os',
    ].join(' · ');

    return NeCard(
      padding: const EdgeInsets.all(UxnanSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _EditableAvatar(onTap: () => AvatarSheet.show(context)),
              const SizedBox(width: UxnanSpacing.lg),
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
                      name ?? l10n.profileDisplayName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.headlineSmall,
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
                onPressed: name == null
                    ? null
                    : () async {
                        final next = await DeviceNameDialog.show(
                          context,
                          name,
                          title: l10n.thisPhoneRename,
                        );
                        if (next == null || next.isEmpty) return;
                        await ref
                            .read(bridgeReplicaProvider)
                            .renameThisPhone(next);
                      },
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.md),
          Wrap(
            spacing: UxnanSpacing.sm,
            runSpacing: UxnanSpacing.sm,
            children: [
              NeBadge(
                label: l10n.profilePairedPcs(pcs),
                icon: UxIcons.laptopMac,
              ),
              NeBadge(
                label: l10n.profileActiveSessions(online),
                icon: UxIcons.podcasts,
                tone: online > 0 ? NeBadgeTone.live : NeBadgeTone.neutral,
              ),
              if (since != null)
                NeBadge(
                  label: l10n.profileMemberSince(
                    DateFormat.yMMM().format(since),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The profile picture with a small camera badge that says it can be changed.
class _EditableAvatar extends ConsumerWidget {
  const _EditableAvatar({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: l10n.profileAvatarTitle,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            ProfileAvatarView(
              avatar: ref.watch(profileAvatarProvider),
              size: 64,
            ),
            Positioned(
              right: -2,
              bottom: -2,
              child: Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  shape: BoxShape.circle,
                  border: Border.all(color: colors.surfaceContainer, width: 2),
                ),
                alignment: Alignment.center,
                child: UxIcon(
                  UxIcons.photoCamera,
                  size: 12,
                  color: colors.onPrimaryContainer,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
