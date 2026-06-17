import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// The app's home: the list of paired PCs (trusted bridges). The app keeps one
/// active connection at a time; tapping a PC opens its threads and "Connect"
/// switches the active session to it (spec 02a §5.5.6 — `MyDevicesScreen`).
class MyDevicesScreen extends ConsumerWidget {
  /// Creates the devices screen.
  const MyDevicesScreen({super.key});

  void _open(BuildContext context, TrustedDevice device) {
    // Browsing a PC's threads is read-only and must NOT change the connection
    // target: connecting stays an explicit, validated action (the "Connect"
    // CTA here or on the threads screen). Just navigate to its cached threads.
    context.push(AppRoutes.deviceThreads(device.macDeviceId));
  }

  Future<void> _connect(
    WidgetRef ref,
    BuildContext context,
    TrustedDevice device,
  ) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(sessionCoordinatorProvider).switchMac(device);
    } on Object {
      // The switch validates reachability first and stays on the current PC on
      // failure; tell the user the target couldn't be reached.
      messenger
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(content: Text(l10n.deviceConnectFailed(device.displayName))),
        );
    }
  }

  Future<void> _rename(
    WidgetRef ref,
    BuildContext context,
    TrustedDevice device,
  ) async {
    final name = await _DeviceNameDialog.show(context, device.displayName);
    if (name == null || name.isEmpty) return;
    await ref
        .read(trustedDeviceRepositoryProvider)
        .saveDevice(device.copyWith(displayName: name));
  }

  Future<void> _remove(
    WidgetRef ref,
    BuildContext context,
    TrustedDevice device,
  ) async {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.deviceRemoveTitle(device.displayName)),
        content: Text(l10n.deviceRemoveBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: colors.error),
            onPressed: () => Navigator.pop(context, true),
            child: Text(l10n.deviceRemoveConfirm),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    // Tell the bridge to forget this phone (best-effort) and drop the session
    // if this PC is the connected one, then wipe its local data. Order matters:
    // the RPC must go out while we still hold the channel, before disconnect.
    await ref.read(sessionCoordinatorProvider).removeTrustedDevice(device);
    await ref
        .read(threadRepositoryProvider)
        .deleteThreadsByDeviceId(device.macDeviceId);
    await ref
        .read(trustedDeviceRepositoryProvider)
        .deleteDevice(device.macDeviceId);
  }

  Future<void> _verify(
    WidgetRef ref,
    BuildContext context,
    TrustedDevice device,
  ) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.deviceVerifying)));
    final ok = await ref.read(sessionCoordinatorProvider).verifyConnection();
    messenger
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(ok ? l10n.deviceVerifyOk : l10n.deviceVerifyFailed),
        ),
      );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final devices = ref.watch(trustedDevicesProvider).value ?? const [];
    // Status keys off the device that is ACTUALLY connected / being connected,
    // not the one merely selected for browsing — so opening a PC's threads
    // never makes it appear connected when it isn't reachable.
    final connectedId = ref.watch(connectedDeviceProvider).value?.macDeviceId;
    final connectingId = ref.watch(connectingDeviceProvider).value?.macDeviceId;
    // Whether the live connection runs over the relay (vs direct LAN/Tailscale),
    // as reported by `bridge/status`. Null until known; only the connected PC
    // shows it.
    final relayConnected =
        ref.watch(bridgeStatusProvider).value?.relayConnected;

    if (devices.isEmpty) {
      return const Scaffold(body: _PairEmptyState());
    }

    return NeScaffold(
      title: l10n.devicesTitle,
      actions: [
        // Pair another PC: an M3 popup (matching the threads sort/more menus)
        // offering the QR scanner or the manual host+code flow.
        PopupMenuButton<_PairAction>(
          tooltip: l10n.actionPairDevice,
          position: PopupMenuPosition.under,
          child: const _MenuSurface(icon: Icons.add_link_rounded),
          onSelected: (action) {
            switch (action) {
              case _PairAction.scanQr:
                context.push(AppRoutes.pairing);
              case _PairAction.enterCode:
                context.push(AppRoutes.manualPairing);
            }
          },
          itemBuilder: (context) => [
            PopupMenuItem(
              value: _PairAction.scanQr,
              child: Text(l10n.actionScanQr),
            ),
            PopupMenuItem(
              value: _PairAction.enterCode,
              child: Text(l10n.actionEnterCode),
            ),
          ],
        ),
        IconSurface(
          icon: Icons.settings_outlined,
          tooltip: l10n.settingsTitle,
          onPressed: () => context.push(AppRoutes.settings),
        ),
      ],
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.lg,
            UxnanSpacing.lg,
          ),
          sliver: SliverList.separated(
            itemCount: devices.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: UxnanSpacing.md),
            itemBuilder: (context, index) {
              final device = devices[index];
              return _DeviceCard(
                device: device,
                isConnected: device.macDeviceId == connectedId,
                isConnecting: device.macDeviceId == connectingId,
                relayConnected:
                    device.macDeviceId == connectedId ? relayConnected : null,
                onOpen: () => _open(context, device),
                onConnect: () => _connect(ref, context, device),
                onRename: () => _rename(ref, context, device),
                onVerify: () => _verify(ref, context, device),
                onRemove: () => _remove(ref, context, device),
              );
            },
          ),
        ),
        // Pinned footer (app name + ALPHA stage pill). `SliverFillRemaining`
        // with `hasScrollBody: false` gives the child the remaining viewport
        // space when the list is short (the inner `Spacer` then pushes the
        // content to the bottom of the screen), and the child's natural size
        // when the list overflows — so the footer always sits right after
        // the last card and never leaves a screen-sized white gap to scroll.
        const SliverFillRemaining(
          hasScrollBody: false,
          child: _BrandingFooter(),
        ),
      ],
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    required this.device,
    required this.isConnected,
    required this.isConnecting,
    required this.relayConnected,
    required this.onOpen,
    required this.onConnect,
    required this.onRename,
    required this.onVerify,
    required this.onRemove,
  });

  final TrustedDevice device;
  final bool isConnected;
  final bool isConnecting;

  /// For the connected PC: whether the live channel runs over the relay (true)
  /// or direct LAN/Tailscale (false); null when unknown / not connected.
  final bool? relayConnected;
  final VoidCallback onOpen;
  final VoidCallback onConnect;
  final VoidCallback onRename;
  final VoidCallback onVerify;
  final VoidCallback onRemove;

  bool get _isConnected => isConnected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final host = _addressLabel(device);

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _PcAvatar(active: _isConnected),
                  const SizedBox(width: UxnanSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          device.displayName,
                          style: textTheme.titleSmall,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Icon(
                              Icons.cloud_outlined,
                              size: 13,
                              color: colors.onSurfaceVariant,
                            ),
                            const SizedBox(width: UxnanSpacing.xs),
                            Flexible(
                              child: Text(
                                host,
                                style: UxnanTypography.codeSmall.copyWith(
                                  color: colors.onSurfaceVariant,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  PopupMenuButton<void>(
                    icon: Icon(
                      Icons.more_vert_rounded,
                      color: colors.onSurfaceVariant,
                    ),
                    itemBuilder: (context) => [
                      PopupMenuItem<void>(
                        onTap: onVerify,
                        child: Row(
                          children: [
                            const Icon(Icons.wifi_tethering_rounded, size: 18),
                            const SizedBox(width: UxnanSpacing.sm),
                            Flexible(child: Text(l10n.deviceVerifyConnection)),
                          ],
                        ),
                      ),
                      PopupMenuItem<void>(
                        onTap: onRename,
                        child: Row(
                          children: [
                            const Icon(Icons.edit_outlined, size: 18),
                            const SizedBox(width: UxnanSpacing.sm),
                            Flexible(child: Text(l10n.deviceRename)),
                          ],
                        ),
                      ),
                      PopupMenuItem<void>(
                        onTap: onRemove,
                        child: Row(
                          children: [
                            Icon(
                              Icons.link_off_rounded,
                              size: 18,
                              color: colors.error,
                            ),
                            const SizedBox(width: UxnanSpacing.sm),
                            Flexible(
                              child: Text(
                                l10n.deviceRemove,
                                style: TextStyle(color: colors.error),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: UxnanSpacing.sm),
              Row(
                children: [
                  Icon(
                    Icons.history_rounded,
                    size: 14,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  Expanded(
                    child: Text(
                      _lastSeenText(l10n),
                      style: textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: UxnanSpacing.xs),
              Row(
                children: [
                  Expanded(
                    child: _StatusLine(
                      isConnected: isConnected,
                      isConnecting: isConnecting,
                      relayConnected: relayConnected,
                    ),
                  ),
                  if (!isConnected)
                    FilledButton.tonal(
                      onPressed: isConnecting ? null : onConnect,
                      child: Text(
                        isConnecting
                            ? l10n.connectionConnecting
                            : l10n.deviceConnect,
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _lastSeenText(AppLocalizations l10n) {
    final lastSeen = device.lastSeen;
    if (lastSeen == null) return l10n.deviceNeverConnected;
    return '${l10n.deviceLastSeenLabel}: ${_relativeTime(lastSeen)}';
  }

  /// The address shown under the device name: the relay host when a relay is
  /// configured, otherwise the first direct LAN/Tailscale host (a pure
  /// LAN/Tailscale device has no relay).
  static String _addressLabel(TrustedDevice device) {
    if (device.relayUrl.isNotEmpty) {
      final host = Uri.tryParse(device.relayUrl)?.host;
      return host == null || host.isEmpty ? device.relayUrl : host;
    }
    return device.hosts.isNotEmpty ? device.hosts.first : '';
  }
}

class _PcAvatar extends StatelessWidget {
  const _PcAvatar({required this.active});
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Icon(
        Icons.laptop_mac_rounded,
        size: 22,
        color: active ? UxnanColors.connected : colors.onSurfaceVariant,
      ),
    );
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({
    required this.isConnected,
    required this.isConnecting,
    this.relayConnected,
  });
  final bool isConnected;
  final bool isConnecting;
  final bool? relayConnected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    // Truthful per-device status: connected only when this PC holds the live
    // channel, connecting only while its own attempt is in flight, else
    // disconnected — regardless of which PC is selected for browsing.
    final (label, color) = isConnected
        ? (l10n.connectionConnected, UxnanColors.connected)
        : isConnecting
            ? (l10n.connectionConnecting, UxnanColors.connecting)
            : (l10n.connectionDisconnected, UxnanColors.disconnected);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: UxnanSpacing.xs),
        Flexible(
          child: Text(
            label,
            style: textTheme.bodySmall?.copyWith(color: color),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        // How we're connected: relay vs direct LAN/Tailscale (connected only).
        if (isConnected && relayConnected != null) ...[
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            '· '
            '${relayConnected! ? l10n.connectionRelay : l10n.connectionDirect}',
            style: textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

class _DeviceNameDialog extends StatefulWidget {
  const _DeviceNameDialog({required this.initial});
  final String initial;

  static Future<String?> show(BuildContext context, String initial) {
    return showDialog<String>(
      context: context,
      builder: (_) => _DeviceNameDialog(initial: initial),
    );
  }

  @override
  State<_DeviceNameDialog> createState() => _DeviceNameDialogState();
}

class _DeviceNameDialogState extends State<_DeviceNameDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.deviceNameTitle),
      content: TextField(
        controller: _controller,
        autofocus: true,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(hintText: l10n.deviceNameHint),
        onSubmitted: (value) => Navigator.of(context).pop(value.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.actionCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_controller.text.trim()),
          child: Text(l10n.actionSave),
        ),
      ],
    );
  }
}

class _PairEmptyState extends StatelessWidget {
  const _PairEmptyState();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.hub_outlined,
              size: 56,
              color: UxnanColors.onSurfaceMuted,
            ),
            const SizedBox(height: UxnanSpacing.lg),
            Text(
              l10n.homeEmptyTitle,
              style: textTheme.headlineMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              l10n.homeEmptyBody,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UxnanSpacing.xl),
            FilledButton.icon(
              onPressed: () => context.push(AppRoutes.onboarding),
              icon: const Icon(Icons.qr_code_scanner),
              label: Text(l10n.actionPairDevice),
            ),
          ],
        ),
      ),
    );
  }
}

String _relativeTime(DateTime time) {
  final now = DateTime.now();
  final isSameDay =
      now.year == time.year && now.month == time.month && now.day == time.day;
  return isSameDay
      ? DateFormat.Hm().format(time)
      : DateFormat.MMMd().format(time);
}

/// Footer pinned to the bottom of the devices screen: the localized app
/// name (with the "Mobile" / "Móvil" suffix) and a neutral "ALPHA"
/// release-stage pill.
///
/// Layout: lives inside a `SliverFillRemaining(hasScrollBody: false)`, so it
/// fills the remaining viewport when the device list is short (the inner
/// `Spacer` then pushes the content to the bottom of the screen) and shrinks
/// to its natural height — right after the last card — when the list
/// overflows. The footer is purely informational, never tappable.
class _BrandingFooter extends StatelessWidget {
  const _BrandingFooter();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        child: Column(
          children: [
            // Expands to fill the remaining viewport when the list is short
            // (so the content below pins to the bottom of the screen) and
            // collapses to 0 when the list overflows (so the footer takes
            // only its natural height right after the last card).
            const Spacer(),
            Text(
              l10n.appTitleMobile,
              style: textTheme.titleSmall?.copyWith(color: colors.onSurface),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UxnanSpacing.xs),
            // Release-stage indicator. A neutral, non-interactive label pill
            // modeled on the project's existing `_RiskBadge` / `_TokenChip`
            // pattern: a `Container` with an M3 surface-container background
            // and `onSurfaceVariant` text. Chips imply interactivity and
            // Flutter's `Badge` widget is for notification counts — neither
            // fits a non-actionable status label. Colors come from the
            // surface token family so it survives light/dark theme changes
            // without standing out.
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: UxnanSpacing.sm,
                vertical: 2,
              ),
              decoration: BoxDecoration(
                color: colors.surfaceContainerHigh,
                borderRadius: const BorderRadius.all(UxnanRadius.full),
              ),
              child: Text(
                l10n.appVersionStage,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The pairing entry choices in the devices app-bar menu.
enum _PairAction { scanQr, enterCode }

/// A neutral circular surface (40 dp visual / 48 dp touch) used as the tappable
/// child of the pairing popup menu, so it reads as an Icon Surface in the bar —
/// matching the threads sort/more menus and the standalone [IconSurface] actions.
class _MenuSurface extends StatelessWidget {
  const _MenuSurface({required this.icon});
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SizedBox(
      width: 48,
      height: 48,
      child: Center(
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: colors.surfaceContainerHigh,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 20, color: colors.onSurfaceVariant),
        ),
      ),
    );
  }
}
