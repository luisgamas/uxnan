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
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
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

    if (devices.isEmpty) {
      return const Scaffold(body: _PairEmptyState());
    }

    return NeScaffold(
      title: l10n.devicesTitle,
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
          icon: Icons.person_outline_rounded,
          tooltip: l10n.profileTitle,
          onPressed: () => context.push(AppRoutes.profile),
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
                networkKind: device.macDeviceId == connectedId
                    ? networkKind
                    : NetworkKind.unknown,
                connectedEndpoint: device.macDeviceId == connectedId
                    ? connectedEndpoint
                    : null,
                onStats: () =>
                    context.push(AppRoutes.deviceStats(device.macDeviceId)),
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
                        // Privacy: the address is blurred by default (it
                        // exposes the network topology — LAN/Tailscale IPs).
                        // Tapping it reveals it; tapping again re-hides it.
                        Flexible(child: _RevealableAddress(address: host)),
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
                    onTap: onStats,
                    child: Row(
                      children: [
                        const Icon(Icons.insights_rounded, size: 18),
                        const SizedBox(width: UxnanSpacing.sm),
                        Flexible(child: Text(l10n.deviceStatistics)),
                      ],
                    ),
                  ),
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
                  networkKind: networkKind,
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
    );
  }

  String _lastSeenText(AppLocalizations l10n) {
    final lastSeen = device.lastSeen;
    if (lastSeen == null) return l10n.deviceNeverConnected;
    return '${l10n.deviceLastSeenLabel}: ${_relativeTime(lastSeen)}';
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
    required this.networkKind,
  });
  final bool isConnected;
  final bool isConnecting;
  final NetworkKind networkKind;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
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
        // The network path badge: LAN / Tailscale / direct / relay while
        // connected, a "detecting…" loading pill while this PC's own connect
        // attempt is in flight, and nothing otherwise.
        if (isConnected || isConnecting) ...[
          const SizedBox(width: UxnanSpacing.xs),
          TransportBadge(
            kind: networkKind,
            detecting: isConnecting && !isConnected,
            dense: true,
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

/// Footer pinned to the bottom of the devices screen: a small rendition of
/// the brand mark with the localized "ALPHA" release-stage pill as a caption
/// underneath. Picks the white-stroke (`logo_wnb.svg`) or black-stroke
/// (`logo_nb.svg`) variant by theme brightness.
///
/// Layout: lives inside a `SliverFillRemaining(hasScrollBody: false)`, so it
/// fills the remaining viewport when the device list is short (the inner
/// `Spacer` then pushes the content to the bottom of the screen) and shrinks
/// to its natural height — right after the last card — when the list
/// overflows. The footer is purely informational, never tappable.
///
/// Theming: a dedicated white-mark SVG is swapped in on dark surfaces (no
/// runtime tint); the caption reuses the same neutral surface family the rest
/// of the app uses for non-interactive status labels.
class _BrandingFooter extends StatelessWidget {
  const _BrandingFooter();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isDark = colors.brightness == Brightness.dark;
    // Two hand-authored mark variants: white stroke for dark surfaces,
    // black stroke for light ones (no runtime tint).
    final markAsset =
        isDark ? 'assets/images/logo_wnb.svg' : 'assets/images/logo_nb.svg';

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
            SvgPicture.asset(
              markAsset,
              height: 44,
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
                style: textTheme.labelSmall?.copyWith(
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
