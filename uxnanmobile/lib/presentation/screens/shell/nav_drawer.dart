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
import 'package:uxnan/presentation/screens/profile/edit_profile_sheet.dart';
import 'package:uxnan/presentation/screens/threads/threads_screen.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_menu_button.dart';
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
        // The keyboard belongs to the CONTENT pane, not to this one. Without
        // this, opening it consumes the bottom inset here too — the system bar
        // padding drops to zero and the profile row visibly slides down while
        // you are typing in the other half of the screen. A phone never showed
        // it because a phone has no drawer beside the keyboard.
        maintainBottomViewPadding: true,
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
          // Only when there is somewhere to switch TO. With one PC paired
          // this is a control whose entire menu is the row beside it.
          if (devices.length > 1)
            IconSurfaceMenu<TrustedDevice>(
              icon: UxIcons.moreVert,
              tooltip: l10n.drawerSwitchDevice,
              onSelected: (target) =>
                  unawaited(_switchTo(context, ref, target)),
              itemBuilder: (context) => [
                for (final option in devices)
                  CheckedPopupMenuItem<TrustedDevice>(
                    value: option,
                    checked: option.macDeviceId == connected?.macDeviceId,
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
      // Empties the content pane, and **clears what was behind it**: `go`
      // replaces the stack rather than adding to it, so this is the way out of
      // a deep walk (conversation → files → git) without back then retracing
      // every screen that walk touched. A permanent drawer makes that stack
      // invisible, and an invisible stack is one nobody can reason about.
      onTap: () => context.go(AppRoutes.home),
      trailing: const _FooterMenu(),
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

/// The drawer footer's actions: settings, and adding a device.
///
/// These are the two the phone keeps in its app bar. On a tablet the content
/// pane's bar belongs to whatever is open there, so they come down here — as a
/// MENU rather than two more buttons, because the row already has a job and a
/// drawer that grows a button per action becomes a toolbar.
///
/// Built exactly like the sort menu: a second `showMenu` pushed OVER the first
/// without popping it, and a back row to leave it. The first attempt navigated
/// while the outer menu was still open, which left its barrier up with nothing
/// to dismiss it — the app froze with a menu on screen and no way out.
class _FooterMenu extends StatelessWidget {
  const _FooterMenu();

  Future<void> _open(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final anchor = menuPositionUnder(context);

    // Deferred until AFTER the menu has closed. Opening anything from inside an
    // open menu is what froze it: the barrier stayed up with nothing to
    // dismiss it.
    String? route;
    var editProfile = false;

    await showMenu<void>(
      context: context,
      position: anchor,
      constraints: kNeMenuConstraints,
      items: [
        PopupMenuItem<void>(
          enabled: false,
          padding: EdgeInsets.zero,
          child: _MenuRow(
            icon: UxIcons.edit,
            label: l10n.profileEditTitle,
            // The same sheet the profile screen opens. Editing your name or
            // avatar is a two-field job, and reaching it through a screen you
            // then have to leave is most of the work.
            onTap: () {
              editProfile = true;
              Navigator.of(context).pop();
            },
          ),
        ),
        PopupMenuItem<void>(
          enabled: false,
          padding: EdgeInsets.zero,
          child: _MenuRow(
            icon: UxIcons.settings,
            label: l10n.settingsTitle,
            onTap: () {
              route = AppRoutes.settings;
              Navigator.of(context).pop();
            },
          ),
        ),
        PopupMenuItem<void>(
          enabled: false,
          padding: EdgeInsets.zero,
          child: _MenuRow(
            icon: UxIcons.addLink,
            label: l10n.drawerDevices,
            trailing: UxIcon(
              UxIcons.chevronRight,
              size: UxnanSize.iconContentSmall,
              color: colors.onSurfaceVariant,
            ),
            onTap: () async {
              final picked = await _pickPairing(context, anchor, l10n);
              if (picked == null || !context.mounted) return;
              route = picked;
              Navigator.of(context).pop();
            },
          ),
        ),
      ],
    );

    if (!context.mounted) return;
    if (editProfile) {
      await EditProfileSheet.show(context);
      return;
    }
    final target = route;
    if (target != null) await context.push(target);
  }

  /// The two ways to add a device, over the first panel rather than replacing
  /// it — and with a row back, because a thumb has nowhere to move to.
  Future<String?> _pickPairing(
    BuildContext context,
    RelativeRect anchor,
    AppLocalizations l10n,
  ) {
    final colors = Theme.of(context).colorScheme;
    return showMenu<String>(
      context: context,
      position: anchor,
      constraints: kNeMenuConstraints,
      items: [
        PopupMenuItem<String>(
          enabled: false,
          padding: EdgeInsets.zero,
          child: _MenuRow(
            icon: UxIcons.chevronLeft,
            label: l10n.drawerDevices,
            muted: true,
            onTap: () => Navigator.of(context).pop(),
          ),
        ),
        const PopupMenuDivider(),
        PopupMenuItem<String>(
          value: AppRoutes.pairing,
          child: Text(
            l10n.actionScanQr,
            style: UxnanTypography.menuItem.copyWith(color: colors.onSurface),
          ),
        ),
        PopupMenuItem<String>(
          value: AppRoutes.manualPairing,
          child: Text(
            l10n.manualCodeTitle,
            style: UxnanTypography.menuItem.copyWith(color: colors.onSurface),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return IconSurface(
      icon: UxIcons.moreVert,
      tooltip: l10n.drawerDevices,
      onPressed: () => unawaited(_open(context)),
    );
  }
}

/// A row inside the footer menu, at the app's menu metrics.
///
/// Hand-built rather than a plain item because these must NOT dismiss the menu
/// themselves: one opens a second panel, another goes back, and the one that
/// navigates has to let the menu close first.
class _MenuRow extends StatelessWidget {
  const _MenuRow({
    required this.icon,
    required this.label,
    required this.onTap,
    this.trailing,
    this.muted = false,
  });

  final UxIconData icon;
  final String label;
  final VoidCallback onTap;
  final Widget? trailing;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.lg,
          vertical: UxnanSpacing.md,
        ),
        child: Row(
          children: [
            // A menu row's glyph is the row's OWN mark: it takes the row size
            // (`iconContentSmall` is the subordinate one, for a mark that
            // accompanies another) and the row's OWN colour. Muted, it sat a
            // tone below the label naming the same action, which reads as
            // disabled rather than as quiet. Only a row that IS quiet — the
            // back row — keeps the muted tone, and it takes it on both.
            UxIcon(
              icon,
              size: UxnanSize.iconContent,
              color: muted ? colors.onSurfaceVariant : colors.onSurface,
            ),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Text(
                label,
                style: UxnanTypography.menuItem.copyWith(
                  color: muted ? colors.onSurfaceVariant : colors.onSurface,
                ),
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
      ),
    );
  }
}
