import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// The app's home: the list of paired PCs (trusted bridges). The app keeps one
/// active connection at a time; tapping a PC opens its threads and "Connect"
/// switches the active session to it (spec 02a §5.5.6 — `MyDevicesScreen`).
class MyDevicesScreen extends ConsumerWidget {
  /// Creates the devices screen.
  const MyDevicesScreen({super.key});

  void _open(WidgetRef ref, BuildContext context, TrustedDevice device) {
    // Mark the device active locally and show its threads; connecting is an
    // explicit action (the "Connect" CTA), so navigation never blocks.
    ref.read(sessionCoordinatorProvider).setActiveDevice(device);
    context.push(AppRoutes.deviceThreads(device.macDeviceId));
  }

  Future<void> _connect(WidgetRef ref, TrustedDevice device) async {
    try {
      await ref.read(sessionCoordinatorProvider).switchMac(device);
    } on Object {
      // Connection errors surface through the connection-phase indicator.
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final devices = ref.watch(trustedDevicesProvider).value ?? const [];
    final activeId = ref.watch(activeMacProvider).value?.macDeviceId;
    final phase = ref.watch(connectionPhaseProvider).value ??
        ConnectionPhase.disconnected;

    if (devices.isEmpty) {
      return const Scaffold(body: _PairEmptyState());
    }

    return Scaffold(
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(
          parent: AlwaysScrollableScrollPhysics(),
        ),
        slivers: [
          SliverAppBar.large(
            floating: true,
            snap: true,
            title: Text(l10n.devicesTitle),
            actions: [
              IconButton(
                tooltip: l10n.actionPairDevice,
                icon: const Icon(Icons.add_link_rounded),
                // A PC is already paired (onboarding done): go straight to the
                // QR scanner. First-pair onboarding is the empty state below.
                onPressed: () => context.push(AppRoutes.pairing),
              ),
              const SizedBox(width: UxnanSpacing.sm),
            ],
          ),
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
                final isActive = device.macDeviceId == activeId;
                return _DeviceCard(
                  device: device,
                  isActive: isActive,
                  phase: phase,
                  onOpen: () => _open(ref, context, device),
                  onConnect: () => _connect(ref, device),
                  onRename: () => _rename(ref, context, device),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    required this.device,
    required this.isActive,
    required this.phase,
    required this.onOpen,
    required this.onConnect,
    required this.onRename,
  });

  final TrustedDevice device;
  final bool isActive;
  final ConnectionPhase phase;
  final VoidCallback onOpen;
  final VoidCallback onConnect;
  final VoidCallback onRename;

  bool get _isConnected => isActive && phase == ConnectionPhase.connected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final host = _relayHost(device.relayUrl);

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
                        onTap: onRename,
                        child: Row(
                          children: [
                            const Icon(Icons.edit_outlined, size: 18),
                            const SizedBox(width: UxnanSpacing.sm),
                            Text(l10n.deviceRename),
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
                    child: _StatusLine(isActive: isActive, phase: phase),
                  ),
                  if (!_isConnected)
                    FilledButton.tonal(
                      onPressed: onConnect,
                      child: Text(l10n.deviceConnect),
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

  static String _relayHost(String relayUrl) {
    final host = Uri.tryParse(relayUrl)?.host;
    return host == null || host.isEmpty ? relayUrl : host;
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
  const _StatusLine({required this.isActive, required this.phase});
  final bool isActive;
  final ConnectionPhase phase;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;

    // A device only reflects the live phase while it is the active one; any
    // other paired PC reads as disconnected.
    final effective = isActive ? phase : ConnectionPhase.disconnected;
    final (label, color) = switch (effective) {
      ConnectionPhase.connected => (
          l10n.connectionConnected,
          UxnanColors.connected,
        ),
      ConnectionPhase.connecting ||
      ConnectionPhase.handshaking ||
      ConnectionPhase.syncing ||
      ConnectionPhase.reconnecting =>
        (l10n.connectionConnecting, UxnanColors.connecting),
      ConnectionPhase.disconnected || ConnectionPhase.error => (
          l10n.connectionDisconnected,
          UxnanColors.disconnected,
        ),
    };

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: UxnanSpacing.xs),
        Text(label, style: textTheme.bodySmall?.copyWith(color: color)),
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
