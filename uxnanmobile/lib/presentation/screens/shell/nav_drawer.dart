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
import 'package:uxnan/presentation/router/pane_navigation.dart';
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
      await ref.read(focusedDeviceProvider.notifier).focus(target.macDeviceId);
      // Whatever the pane held belongs to the PC you just left; beside the
      // new PC's list it would say the switch did not happen.
      if (context.mounted && await context.clearPane() && context.mounted) {
        context.go(AppRoutes.home);
      }
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
              // Onboarding, NOT the scanner. Whoever reaches this button has no
              // PC paired, which means there may well be no bridge installed
              // either — and a camera pointed at nothing is a dead end that
              // explains none of that. Onboarding installs the bridge, then
              // hands off to the same scanner (its own "scan" step pushes
              // `AppRoutes.pairing`), so nobody who already has one loses a
              // step worth mentioning.
              onPressed: () => context.push(AppRoutes.onboarding),
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

    // The whole row is the PC switcher: the chosen PC, and a chevron down that
    // says a menu drops from it. It is
    // there with ONE PC too: the same menu is where you pair another and
    // manage the ones you have, which a tablet had no way to reach at all.
    return Padding(
      padding: const EdgeInsets.all(UxnanSpacing.sm),
      child: Material(
        color: Colors.transparent,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        child: InkWell(
          borderRadius: const BorderRadius.all(UxnanRadius.lg),
          onTap: () => unawaited(_openPcMenu(context, ref, current)),
          child: Semantics(
            button: true,
            label: l10n.drawerSwitchDevice,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.sm,
                UxnanSpacing.xs,
                UxnanSpacing.sm,
                UxnanSpacing.xs,
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
                  const SizedBox(width: UxnanSpacing.sm),
                  UxIcon(
                    UxIcons.expandMore,
                    size: UxnanSize.iconContent,
                    color: colors.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// The PC menu: every paired PC (the current one checked), then managing
  /// them, and pairing another — whose two ways open in a submenu beside it.
  ///
  /// What was picked is acted on AFTER the menu has closed — navigating from
  /// inside an open menu left its barrier up with nothing to dismiss it.
  Future<void> _openPcMenu(
    BuildContext context,
    WidgetRef ref,
    TrustedDevice current,
  ) async {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final picked = await showMenu<Object>(
      context: context,
      position: menuPositionUnder(context),
      constraints: kNeMenuConstraints,
      items: [
        for (final option in devices)
          _drawerMenuItem<Object>(
            context,
            value: option,
            icon: UxIcons.laptopMac,
            label: option.displayName,
            trailing: option.macDeviceId == current.macDeviceId
                ? UxIcon(
                    UxIcons.check,
                    size: UxnanSize.iconContent,
                    color: colors.primary,
                  )
                : null,
          ),
        const PopupMenuDivider(),
        _drawerMenuItem<Object>(
          context,
          value: AppRoutes.devices,
          icon: UxIcons.settings,
          label: l10n.drawerManageDevices,
        ),
        // The two ways to pair, in a submenu beside this row — Material's
        // nested menu: next to its parent, never on top of it.
        PopupMenuItem<Object>(
          enabled: false,
          padding: EdgeInsets.zero,
          child: Builder(
            builder: (rowContext) => NeSubmenuRow<String>(
              icon: UxIcons.addLink,
              label: l10n.actionPairDevice,
              items: () => [
                _drawerMenuItem(
                  rowContext,
                  value: AppRoutes.pairing,
                  icon: UxIcons.qrCodeScanner,
                  label: l10n.actionScanQr,
                ),
                _drawerMenuItem(
                  rowContext,
                  value: AppRoutes.manualPairing,
                  icon: UxIcons.key,
                  label: l10n.manualCodeTitle,
                ),
              ],
              // Picked in the submenu: close the PC menu with it, so it is
              // acted on once both menus are gone.
              onSelected: (route) => Navigator.of(rowContext).pop(route),
            ),
          ),
        ),
      ],
    );

    if (!context.mounted) return;
    switch (picked) {
      case final TrustedDevice target
          when target.macDeviceId != current.macDeviceId:
        await _switchTo(context, ref, target);
      case AppRoutes.devices:
        // The PCs' own screen, in the pane: rename, remove, verify.
        await context.openInPane(AppRoutes.devices);
      case final String route:
        await context.push<void>(route);
    }
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
    final name = ref.watch(shownPhoneNameProvider) ?? l10n.profileDisplayName;

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
      onTap: () async {
        if (await context.clearPane() && context.mounted) {
          context.go(AppRoutes.home);
        }
      },
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

/// The drawer footer's actions: your profile and the app's settings.
///
/// The phone keeps these in its app bar. On a tablet the content pane's bar
/// belongs to whatever is open there, so they come down here — as a MENU
/// rather than more buttons, because the row already has a job and a drawer
/// that grows a button per action becomes a toolbar. Pairing lives with the
/// PCs, in the header's menu.
class _FooterMenu extends StatelessWidget {
  const _FooterMenu();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return IconSurfaceMenu<String>(
      icon: UxIcons.moreVert,
      tooltip: l10n.threadsMore,
      // Destinations: pushed over everything, and back returns here.
      onSelected: (route) => unawaited(context.push<void>(route)),
      itemBuilder: (context) => [
        _drawerMenuItem(
          context,
          value: AppRoutes.profile,
          icon: UxIcons.person,
          label: l10n.profileTitle,
        ),
        _drawerMenuItem(
          context,
          value: AppRoutes.settings,
          icon: UxIcons.settings,
          label: l10n.settingsTitle,
        ),
      ],
    );
  }
}

/// One row of a drawer menu, at the app's menu metrics: its own glyph at the
/// row size and in the row's own colour — a muted glyph beside a label naming
/// the same action reads as disabled rather than as quiet.
PopupMenuItem<T> _drawerMenuItem<T>(
  BuildContext context, {
  required T value,
  required UxIconData icon,
  required String label,
  Widget? trailing,
}) {
  final colors = Theme.of(context).colorScheme;
  return PopupMenuItem<T>(
    value: value,
    child: Row(
      children: [
        UxIcon(icon, size: UxnanSize.iconContent, color: colors.onSurface),
        const SizedBox(width: UxnanSpacing.md),
        Expanded(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: UxnanTypography.menuItem.copyWith(color: colors.onSurface),
          ),
        ),
        if (trailing != null) trailing,
      ],
    ),
  );
}
