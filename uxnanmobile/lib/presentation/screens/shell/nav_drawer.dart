import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/shell_device_provider.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/threads/threads_screen.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';
import 'package:uxnan/presentation/widgets/transport_badge.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// The permanent navigation drawer of wide windows.
///
/// **Three zones and nothing else** — the PC you are talking to, the work on
/// it, and you. That is a rule rather than a description: a drawer is the one
/// surface in an app where "there is room, put it here" always looks
/// reasonable, and a drawer that accumulates is how a two-pane layout turns
/// back into a menu. Anything else that wants to exist belongs in the content
/// pane, which is the whole point of having one.
///
/// It is permanent in the M3 sense (`docs/neural-expressive-design.md` §4.4):
/// no opening animation, no gesture to dismiss it, no scrim. Below expanded it
/// does not exist at all and those windows navigate with a screen stack.
class NavDrawer extends ConsumerWidget {
  /// Creates a [NavDrawer] for [deviceId].
  const NavDrawer({required this.deviceId, super.key});

  /// The PC whose work fills the middle zone, or null when none is known —
  /// which on a first run means none is paired.
  final String? deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final devices = ref.watch(trustedDevicesProvider).value ?? const [];
    final device = devices.firstWhereOrNull((d) => d.macDeviceId == deviceId);

    // Material, not a ColoredBox: the drawer is a pane BESIDE the routed
    // screen, so the Scaffold that would normally provide ink is inside the
    // content and not above this. Without it every InkWell in here throws.
    return Material(
      color: colors.surface,
      child: SafeArea(
        child: Column(
          children: [
            _DeviceHeader(device: device, devices: devices),
            const Divider(height: 1),
            // With no PC there is nothing to list, and the header above has
            // become the pairing call to action. Drawing an empty tree under
            // it would bury the only action that exists.
            if (device == null)
              const Spacer()
            else
              Expanded(
                child: ThreadsScreen(
                  key: ValueKey('drawer-spaces-${device.macDeviceId}'),
                  deviceId: device.macDeviceId,
                  embedded: true,
                ),
              ),
            const Divider(height: 1),
            const _ProfileFooter(),
          ],
        ),
      ),
    );
  }
}

/// Zone 1 — which PC you are talking to, and the two actions that change it.
class _DeviceHeader extends ConsumerWidget {
  const _DeviceHeader({required this.device, required this.devices});

  final TrustedDevice? device;
  final List<TrustedDevice> devices;

  Future<void> _switchTo(
    BuildContext context,
    WidgetRef ref,
    TrustedDevice target,
  ) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      // A real connection attempt, with its validation — not a filter over a
      // list. Picking a PC here is the same act as picking one on the home
      // screen, and it fails the same way.
      await ref.read(sessionCoordinatorProvider).switchMac(target);
      await ref.read(lastVisitedDeviceProvider.notifier).visited(
            target.macDeviceId,
          );
    } on Object {
      messenger
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(content: Text(l10n.deviceConnectFailed(target.displayName))),
        );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final current = device;

    if (current == null) {
      // Nothing paired: the header IS the call to action, because it is the
      // only thing that can be done from here at all.
      return Padding(
        padding: const EdgeInsets.all(UxnanSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.drawerNoDevices, style: textTheme.titleMedium),
            const SizedBox(height: UxnanSpacing.sm),
            FilledButton.icon(
              onPressed: () => context.push(AppRoutes.pairing),
              icon: const UxIcon(UxIcons.addLink),
              label: Text(l10n.actionPairDevice),
            ),
          ],
        ),
      );
    }

    final connected = ref.watch(connectedDeviceProvider).value;
    final online = connected?.macDeviceId == current.macDeviceId;
    // The app already classifies the live path once, correctly (it can tell
    // LAN from Tailscale, which `bridge/status` cannot). Re-deriving it here
    // would be a second answer to the same question.
    final kind = ref.watch(networkKindProvider);

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.md,
        UxnanSpacing.sm,
        UxnanSpacing.sm,
        UxnanSpacing.sm,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _OnlineDot(online: online),
                    const SizedBox(width: UxnanSpacing.sm),
                    Flexible(
                      child: Text(
                        current.displayName,
                        style: textTheme.titleMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                if (online) ...[
                  const SizedBox(height: 2),
                  TransportBadge(kind: kind, dense: true),
                ],
              ],
            ),
          ),
          // Switching PCs, and pairing another — the only two things this zone
          // does, both of which change WHICH machine the rest of the drawer is
          // about.
          if (devices.length > 1)
            IconSurfaceMenu<TrustedDevice>(
              icon: UxIcons.expandMore,
              tooltip: l10n.drawerSwitchDevice,
              onSelected: (target) =>
                  unawaited(_switchTo(context, ref, target)),
              itemBuilder: (context) => [
                for (final option in devices)
                  PopupMenuItem<TrustedDevice>(
                    value: option,
                    child: Row(
                      children: [
                        _OnlineDot(
                          online: option.macDeviceId == connected?.macDeviceId,
                        ),
                        const SizedBox(width: UxnanSpacing.sm),
                        Expanded(
                          child: Text(
                            option.displayName,
                            style: UxnanTypography.menuItem.copyWith(
                              color: colors.onSurface,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          IconSurface(
            icon: UxIcons.addLink,
            tooltip: l10n.actionPairDevice,
            onPressed: () => context.push(AppRoutes.pairing),
          ),
        ],
      ),
    );
  }
}

/// Zone 3 — you, and the way back to the overview.
///
/// Tapping the name does **not** open a screen: it returns the content pane to
/// the overview. In a layout with no back stack this is the "home" affordance,
/// and putting it under the name is what makes the drawer feel like a place
/// rather than a menu.
class _ProfileFooter extends ConsumerWidget {
  const _ProfileFooter();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final name = ref.watch(profileNameProvider) ?? l10n.profileDisplayName;

    // `ListTile`, not a hand-rolled Material + InkWell: M3 already specifies
    // this row — ink, minimum height, leading/trailing slots, the disabled and
    // selected states, and the semantics that make it announce as one thing.
    // Rebuilding that by hand gets the look and loses the rest.
    return ListTile(
      leading: ProfileAvatarView(
        avatar: ref.watch(profileAvatarProvider),
        size: UxnanSize.iconSurface,
      ),
      title: Text(
        name,
        style: textTheme.titleSmall,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      // Returns the CONTENT pane to the overview rather than opening a screen.
      // In a layout with no back stack this is the "home" affordance.
      onTap: () => context.go(AppRoutes.home),
      trailing: IconSurface(
        icon: UxIcons.settings,
        tooltip: l10n.settingsTitle,
        onPressed: () => context.push(AppRoutes.settings),
      ),
    );
  }
}

class _OnlineDot extends StatelessWidget {
  const _OnlineDot({required this.online});

  final bool online;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: online ? colors.tertiary : colors.outlineVariant,
        shape: BoxShape.circle,
      ),
    );
  }
}
