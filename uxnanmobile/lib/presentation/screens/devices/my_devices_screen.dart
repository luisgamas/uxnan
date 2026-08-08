import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/network_kind.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_badge.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_menu_button.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';
import 'package:uxnan/presentation/widgets/transport_badge.dart';

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
    // The classified network path of the LIVE channel — LAN, Tailscale, a
    // direct address, or the relay — derived client-side from the actual
    // connected endpoint (never from `bridge/status.relayConnected`, which
    // can't tell LAN from Tailscale and lags the real per-session transport).
    // Only the connected PC shows it.
    final networkKind = ref.watch(networkKindProvider);
    // The endpoint the live channel is ACTUALLY served through (the winning
    // direct host, or the relay), so the connected card shows the real address
    // in use — not the first advertised host (a lexicographic guess that is
    // usually the Tailscale `100.x` IP even when we're on LAN). Null until
    // known; only the connected PC uses it.
    final connectedEndpoint = ref.watch(connectedEndpointProvider).value;

    // Two columns once the window earns them. Below expanded the cards keep the
    // full content width — a phone splitting a 44 dp avatar row in two would
    // just make both halves cramped.
    final columns =
        UxnanBreakpoint.of(context).usesPermanentPane && devices.length > 1
            ? 2
            : 1;

    return NeScaffold(
      // The bar carries the product's identity, not the screen's: the mark on
      // the left, your avatar on the right (NE §4.2 keeps the main screen's bar
      // title empty, and this screen's real heading is the headline below).
      titleWidget: const _BrandMark(),
      actions: [
        // Pair another PC: an M3 popup (matching the threads sort/more menus)
        // offering the QR scanner or the manual host+code flow.
        IconSurfaceMenu<_PairAction>(
          tooltip: l10n.actionPairDevice,
          icon: Icons.add_link_rounded,
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
        _ProfileAvatarAction(onPressed: () => context.push(AppRoutes.profile)),
      ],
      slivers: [
        if (devices.isEmpty)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: _PairEmptyState(),
          )
        else ...[
          const SliverToBoxAdapter(child: _OverviewHeadline()),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              0,
              UxnanSpacing.lg,
              UxnanSpacing.lg,
            ),
            sliver: _DeviceCardList(
              devices: devices,
              columns: columns,
              connectedId: connectedId,
              connectingId: connectingId,
              networkKind: networkKind,
              connectedEndpoint: connectedEndpoint,
              onStats: (device) =>
                  context.push(AppRoutes.deviceStats(device.macDeviceId)),
              onOpen: (device) => _open(context, device),
              onConnect: (device) => _connect(ref, context, device),
              onRename: (device) => _rename(ref, context, device),
              onVerify: (device) => _verify(ref, context, device),
              onRemove: (device) => _remove(ref, context, device),
            ),
          ),
        ],
      ],
    );
  }
}

/// The paired PCs, in one column or two.
///
/// Two columns are laid out as rows of paired cells rather than a `SliverGrid`
/// on purpose: a grid needs a fixed extent or aspect ratio, and this card's
/// height depends on text that grows with the user's font scale — the one input
/// a fixed extent cannot survive. [IntrinsicHeight] costs nothing on a list of
/// paired machines and buys equal-height cards for free.
class _DeviceCardList extends StatelessWidget {
  const _DeviceCardList({
    required this.devices,
    required this.columns,
    required this.connectedId,
    required this.connectingId,
    required this.networkKind,
    required this.connectedEndpoint,
    required this.onStats,
    required this.onOpen,
    required this.onConnect,
    required this.onRename,
    required this.onVerify,
    required this.onRemove,
  });

  final List<TrustedDevice> devices;
  final int columns;
  final String? connectedId;
  final String? connectingId;
  final NetworkKind networkKind;
  final String? connectedEndpoint;
  final void Function(TrustedDevice) onStats;
  final void Function(TrustedDevice) onOpen;
  final void Function(TrustedDevice) onConnect;
  final void Function(TrustedDevice) onRename;
  final void Function(TrustedDevice) onVerify;
  final void Function(TrustedDevice) onRemove;

  Widget _card(TrustedDevice device) {
    final isConnected = device.macDeviceId == connectedId;
    return _DeviceCard(
      device: device,
      isConnected: isConnected,
      isConnecting: device.macDeviceId == connectingId,
      networkKind: isConnected ? networkKind : NetworkKind.unknown,
      connectedEndpoint: isConnected ? connectedEndpoint : null,
      onStats: () => onStats(device),
      onOpen: () => onOpen(device),
      onConnect: () => onConnect(device),
      onRename: () => onRename(device),
      onVerify: () => onVerify(device),
      onRemove: () => onRemove(device),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (columns == 1) {
      return SliverList.separated(
        itemCount: devices.length,
        separatorBuilder: (_, __) => const SizedBox(height: UxnanSpacing.md),
        itemBuilder: (context, index) => _card(devices[index]),
      );
    }

    final rows = (devices.length + columns - 1) ~/ columns;
    return SliverList.separated(
      itemCount: rows,
      separatorBuilder: (_, __) => const SizedBox(height: UxnanSpacing.md),
      itemBuilder: (context, row) {
        final first = row * columns;
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var column = 0; column < columns; column++) ...[
                if (column > 0) const SizedBox(width: UxnanSpacing.md),
                Expanded(
                  child: first + column < devices.length
                      ? _card(devices[first + column])
                      // A trailing gap, not a card: the last row of an odd
                      // list keeps its sibling at half width instead of
                      // stretching it across the whole row.
                      : const SizedBox.shrink(),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    required this.device,
    required this.isConnected,
    required this.isConnecting,
    required this.networkKind,
    required this.connectedEndpoint,
    required this.onStats,
    required this.onOpen,
    required this.onConnect,
    required this.onRename,
    required this.onVerify,
    required this.onRemove,
  });

  final TrustedDevice device;
  final bool isConnected;
  final bool isConnecting;

  /// For the connected PC: the classified network path of the live channel
  /// (LAN / Tailscale / direct / relay); [NetworkKind.unknown] when not this
  /// card's connected PC.
  final NetworkKind networkKind;

  /// For the connected PC: the URL the live channel is actually served through
  /// (the winning direct host, or the relay); null when unknown / not connected.
  /// Preferred over [TrustedDevice.hosts] for the displayed address.
  final String? connectedEndpoint;
  final VoidCallback onStats;
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
    final host = _addressLabel(device, connectedEndpoint);

    return NeCard(
      onTap: onOpen,
      padding: const EdgeInsets.all(UxnanSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _PcAvatar(active: _isConnected, isConnecting: isConnecting),
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
                    // Privacy: the address is blurred by default (it exposes
                    // the network topology — LAN/Tailscale IPs). Tapping it
                    // reveals it; tapping again re-hides it.
                    _RevealableAddress(address: host),
                    const SizedBox(height: 2),
                    // Spelled out, not a badge: a bare "9:41" said nothing —
                    // a time needs its label to mean anything, and a label
                    // that long turns a badge into a paragraph in a pill.
                    Text(
                      device.lastSeen == null
                          ? l10n.deviceNeverConnected
                          : l10n.deviceLastConnection(
                              _lastConnectionText(context, device.lastSeen!),
                            ),
                      style: textTheme.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              NeMenuButton<void>(
                tooltip: l10n.deviceMenuTooltip,
                itemBuilder: (context) => [
                  PopupMenuItem<void>(
                    onTap: onStats,
                    child: Text(l10n.deviceStatistics),
                  ),
                  PopupMenuItem<void>(
                    onTap: onVerify,
                    child: Text(l10n.deviceVerifyConnection),
                  ),
                  PopupMenuItem<void>(
                    onTap: onRename,
                    child: Text(l10n.deviceRename),
                  ),
                  PopupMenuItem<void>(
                    onTap: onRemove,
                    child: Text(
                      l10n.deviceRemove,
                      style: TextStyle(color: colors.error),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.md),
          // How it connects and when it last did, as supporting metadata.
          // They wrap instead of truncating: "Tailscale" and a long relative
          // time will not both fit a narrow card, and a half-word badge says
          // less than a second line does.
          Wrap(
            spacing: UxnanSpacing.sm,
            runSpacing: UxnanSpacing.sm,
            children: [
              NeBadge(
                icon: isConnected
                    ? Icons.wifi_tethering_rounded
                    : Icons.cloud_off_outlined,
                // Status and network path are one fact seen from two sides:
                // the live path when there is one, otherwise what the
                // connection is doing.
                label: isConnected
                    ? _connectionValue(networkKind, l10n)
                    : isConnecting
                        ? l10n.transportDetecting
                        : l10n.connectionDisconnected,
                tone: isConnected ? NeBadgeTone.live : NeBadgeTone.secondary,
              ),
              _DeviceWorkingBadge(deviceId: device.macDeviceId),
            ],
          ),
          const SizedBox(height: UxnanSpacing.md),
          Row(
            children: [
              if (!isConnected)
                FilledButton.tonal(
                  onPressed: isConnecting ? null : onConnect,
                  child: Text(
                    isConnecting
                        ? l10n.connectionConnecting
                        : l10n.deviceConnect,
                  ),
                ),
              const Spacer(),
              // Quiet, and last: how much history this PC holds is the reason
              // to open it, not a reason to look at it.
              _DeviceThreadCount(deviceId: device.macDeviceId),
            ],
          ),
        ],
      ),
    );
  }

  /// When the PC was last reachable, in the phone's own conventions:
  /// [MaterialLocalizations.formatTimeOfDay] follows the locale AND the
  /// device's 12/24-hour setting, which a hand-rolled `DateFormat` pattern
  /// cannot. Anything older than today carries its date, because a lone time
  /// from last week is worse than no time at all.
  static String _lastConnectionText(BuildContext context, DateTime time) {
    final l10n = MaterialLocalizations.of(context);
    final clock = l10n.formatTimeOfDay(
      TimeOfDay.fromDateTime(time),
      alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
    );
    final now = DateTime.now();
    final sameDay =
        now.year == time.year && now.month == time.month && now.day == time.day;
    return sameDay ? clock : '${DateFormat.MMMd().format(time)}, $clock';
  }

  /// What the connection cell says for a LIVE channel: the classified network
  /// path, or a plain "Connected" while the path is still unclassified — never
  /// an empty cell.
  static String _connectionValue(NetworkKind kind, AppLocalizations l10n) {
    final label = networkKindLabel(kind, l10n);
    return label.isEmpty ? l10n.connectionConnected : label;
  }

  /// The address shown under the device name.
  ///
  /// Prefers [connectedEndpoint] — the endpoint the live channel is ACTUALLY
  /// served through (the winning direct host, or the relay) — so the connected
  /// card shows the real address in use. Falls back, when not connected, to the
  /// relay host, then the first advertised direct host. (Using the advertised
  /// `hosts.first` alone was misleading: the bridge sorts its hosts
  /// lexicographically, so the Tailscale `100.x` address always sorts ahead of
  /// a LAN `192.168.x` one and showed even while connected over LAN.)
  static String _addressLabel(TrustedDevice device, String? connectedEndpoint) {
    if (connectedEndpoint != null && connectedEndpoint.isNotEmpty) {
      return _hostFromEndpoint(connectedEndpoint);
    }
    if (device.relayUrl.isNotEmpty) {
      final host = Uri.tryParse(device.relayUrl)?.host;
      return host == null || host.isEmpty ? device.relayUrl : host;
    }
    return device.hosts.isNotEmpty ? device.hosts.first : '';
  }

  /// The human-readable `host` (or `host:port`) from a transport URL. A direct
  /// endpoint carries an explicit port (`ws://192.168.1.5:8765` → `192.168.1.5:
  /// 8765`); the relay usually does not (`wss://relay.uxnan.dev` → `relay.uxnan.
  /// dev`). Falls back to the raw string if it doesn't parse as a URI.
  static String _hostFromEndpoint(String endpoint) {
    final uri = Uri.tryParse(endpoint);
    if (uri == null || uri.host.isEmpty) return endpoint;
    return uri.hasPort ? '${uri.host}:${uri.port}' : uri.host;
  }
}

/// Agents producing a turn on this PC **right now**, as the card's one live
/// badge. Zero draws nothing: an empty signal is noise, and a PC at rest keeps
/// the two badges it already has.
class _DeviceWorkingBadge extends ConsumerWidget {
  const _DeviceWorkingBadge({required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final working = ref.watch(deviceWorkingCountProvider(deviceId));
    if (working == 0) return const SizedBox.shrink();
    return NeBadge(
      icon: Icons.smart_toy_outlined,
      label: AppLocalizations.of(context).homeDeviceWorking(working),
      tone: NeBadgeTone.live,
    );
  }
}

/// How many conversations the phone knows for this PC — read from the local
/// cache, so it still describes a machine that is not connected. Quiet text,
/// not a badge: it is the reason to open the card, not a reason to look at it.
class _DeviceThreadCount extends ConsumerWidget {
  const _DeviceThreadCount({required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threads = ref.watch(deviceThreadCountProvider(deviceId));
    if (threads == 0) return const SizedBox.shrink();
    return Text(
      AppLocalizations.of(context).homeDeviceThreads(threads),
      style: Theme.of(context).textTheme.bodySmall,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}

/// The machine, as a rounded surface glyph with a live status dot in its
/// corner — the state is read off the card before any text is.
class _PcAvatar extends StatelessWidget {
  const _PcAvatar({required this.active, required this.isConnecting});

  final bool active;
  final bool isConnecting;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dotColor = active
        ? UxnanColors.connected
        : isConnecting
            ? UxnanColors.connecting
            : UxnanColors.disconnected;

    return SizedBox(
      width: 44,
      height: 44,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
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
          ),
          Positioned(
            right: -1,
            bottom: -1,
            child: Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                color: dotColor,
                shape: BoxShape.circle,
                // Ringed in the card's own tone so the dot reads as a marker
                // on the glyph rather than a speck floating over its edge.
                border: Border.all(color: colors.surfaceContainer, width: 2),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The PC's address (its LAN/Tailscale IP or relay host) rendered blurred by
/// default and revealed on tap — a low-friction privacy affordance so the
/// network topology isn't exposed at a glance (shoulder-surfing, screenshots,
/// screen-sharing). Tapping toggles between blurred and clear; the blur
/// animates unless the OS has reduced motion enabled.
///
/// The tap is handled by this widget's own [InkWell], which wins the gesture
/// arena over the enclosing card — so revealing the address never opens the
/// PC's threads.
class _RevealableAddress extends StatefulWidget {
  const _RevealableAddress({required this.address});

  final String address;

  @override
  State<_RevealableAddress> createState() => _RevealableAddressState();
}

class _RevealableAddressState extends State<_RevealableAddress> {
  /// Blur strength (logical px) applied while hidden — enough to make an 11 px
  /// monospace IP unreadable while preserving its shape and length.
  static const double _blurSigma = 5;

  bool _revealed = false;

  void _toggle() => setState(() => _revealed = !_revealed);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final label = _revealed ? l10n.deviceAddressHide : l10n.deviceAddressReveal;

    return Semantics(
      button: true,
      label: label,
      child: Tooltip(
        message: label,
        child: InkWell(
          onTap: _toggle,
          borderRadius: const BorderRadius.all(UxnanRadius.md),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: UxnanSpacing.xs,
              vertical: 1,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: TweenAnimationBuilder<double>(
                    tween: Tween<double>(end: _revealed ? 0 : _blurSigma),
                    duration: reduceMotion
                        ? Duration.zero
                        : const Duration(milliseconds: 220),
                    curve: Curves.easeOutCubic,
                    builder: (context, sigma, child) {
                      // Below a hair of blur, drop the filter entirely: an
                      // exactly-zero-sigma ImageFilter can smear on some GPUs,
                      // and skipping it while revealed is cheaper.
                      if (sigma < 0.05) return child!;
                      return ImageFiltered(
                        imageFilter: ImageFilter.blur(
                          sigmaX: sigma,
                          sigmaY: sigma,
                          tileMode: TileMode.decal,
                        ),
                        child: child,
                      );
                    },
                    child: Text(
                      widget.address,
                      style: UxnanTypography.codeSmall.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
                const SizedBox(width: UxnanSpacing.xs),
                // Decorative affordance; the Semantics label above already
                // announces the reveal/hide action.
                ExcludeSemantics(
                  child: Icon(
                    _revealed
                        ? Icons.visibility_off_rounded
                        : Icons.visibility_rounded,
                    size: 13,
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
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
            SvgPicture.asset(
              'assets/images/logo_fg.svg',
              key: const ValueKey('devices-empty-logo'),
              width: 96,
              height: 96,
              colorFilter: ColorFilter.mode(
                colors.onSurface,
                BlendMode.srcIn,
              ),
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

/// The product mark in the top bar.
///
/// This is where the brand lives now: it used to sit in a footer pinned under
/// the device list, spending the bottom of the screen on a logo. In the bar it
/// is chrome — present, quiet, and out of the content's way. It stands a little
/// taller than the 40 dp action circles beside it so it reads as the product's
/// mark rather than one more button.
class _BrandMark extends StatelessWidget {
  const _BrandMark();

  /// A touch above the 40 dp [IconSurface] circles sharing this row.
  static const double _height = 44;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    // The tintable foreground mark, not the hand-authored black/white variants:
    // one asset that follows the theme's `onSurface` instead of two that have
    // to be picked by brightness.
    return Align(
      alignment: Alignment.centerLeft,
      child: SvgPicture.asset(
        'assets/images/logo_fg.svg',
        height: _height,
        colorFilter: ColorFilter.mode(colors.onSurface, BlendMode.srcIn),
      ),
    );
  }
}

/// The user's avatar as a top-bar action, on the same 40 dp circular footprint
/// every [IconSurface] in the bar keeps so the row stays on one rhythm.
class _ProfileAvatarAction extends ConsumerWidget {
  const _ProfileAvatarAction({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Tooltip(
      message: l10n.profileTitle,
      child: InkWell(
        onTap: onPressed,
        customBorder: const CircleBorder(),
        child: SizedBox(
          // The same 48 dp target and 44 dp circle as every [IconSurface] in
          // this row — an avatar a few dp smaller reads as a mistake, not as a
          // different kind of control.
          width: UxnanSize.minTouchTarget,
          height: UxnanSize.minTouchTarget,
          child: Center(
            child: ProfileAvatarView(
              avatar: ref.watch(profileAvatarProvider),
              size: UxnanSize.iconSurface,
            ),
          ),
        ),
      ),
    );
  }
}

/// The overview's heading: a greeting carrying the user's name, over a line
/// saying how many of their machines are reachable and since when they have
/// been using Uxnan.
///
/// It scrolls away under the pinned bar rather than collapsing into a title.
/// The bar already holds the identity that matters once the headline is gone —
/// the mark and the avatar — and repeating "Welcome back" up there would say
/// nothing. Every fragment is dropped rather than faked when unknown.
class _OverviewHeadline extends ConsumerWidget {
  const _OverviewHeadline();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    final name = ref.watch(profileNameProvider);
    final online = ref.watch(connectedDeviceProvider).value != null ? 1 : 0;
    // Cache only: a phone that has never synced metrics simply drops the
    // "member since" fragment instead of dragging the whole metrics
    // aggregation onto the app's first screen.
    final since = ref.watch(memberSinceProvider);

    final hasName = name != null && name.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.sm,
        UxnanSpacing.lg,
        UxnanSpacing.lg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Two rows when there is a name: the constant half quiet and small,
          // the half that is *yours* carrying the weight. Without a name the
          // greeting is the whole headline, so it takes the large style itself
          // — never a placeholder name to keep the shape.
          if (hasName) ...[
            Text(
              l10n.homeGreeting,
              style: textTheme.headlineMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              name,
              style: textTheme.displayLarge,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ] else
            Text(
              l10n.homeGreeting,
              style: textTheme.displayLarge,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          const SizedBox(height: UxnanSpacing.md),
          // Two badges, deliberately unequal: how many machines are reachable
          // is live and takes the one solid tone on the screen; how long you
          // have been here is a fact that never changes and stays quiet. They
          // wrap rather than truncate — the date is long in some locales.
          Wrap(
            spacing: UxnanSpacing.sm,
            runSpacing: UxnanSpacing.sm,
            children: [
              NeBadge(
                label: l10n.profileActiveSessions(online),
                icon: Icons.podcasts_rounded,
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

/// The pairing entry choices in the devices app-bar menu.
enum _PairAction { scanQr, enterCode }
