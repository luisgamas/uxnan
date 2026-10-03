import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/relay_manager.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
import 'package:uxnan/domain/value_objects/relay_status.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/relay_dialogs.dart';
import 'package:uxnan/presentation/screens/profile/relay_setup_screen.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_badge.dart';
import 'package:uxnan/presentation/widgets/ne_button.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Which relay action is running, so its row shows the loader and the others
/// wait.
enum _RelayBusy { toggling, updating, rotating, removing }

/// "Remote access" on a PC's details: how a phone reaches this PC from
/// another network, and the PC's own relay (architecture/02a §5.10).
///
/// The bridge owns the relay; this section mirrors what it reports
/// (`relayStatusProvider`) and asks it through `RelayManager`. While this PC
/// is the connected one it shows the live status and every action (switch,
/// update, new address, remove — or set up when there is none). While it is
/// not, it shows the relay the PC last shared and keeps the switch: a change
/// is kept on this phone and sent, dated, the next time the PC is reachable.
class RemoteAccessSection extends ConsumerStatefulWidget {
  /// Creates a [RemoteAccessSection] for the PC with [deviceId].
  const RemoteAccessSection({
    required this.deviceId,
    required this.isConnected,
    super.key,
  });

  /// The PC's `macDeviceId`.
  final String deviceId;

  /// Whether this PC holds the live channel right now.
  final bool isConnected;

  @override
  ConsumerState<RemoteAccessSection> createState() =>
      _RemoteAccessSectionState();
}

class _RemoteAccessSectionState extends ConsumerState<RemoteAccessSection> {
  _RelayBusy? _busy;

  RelayManager get _relay => ref.read(relayManagerProvider);

  /// Runs one relay action: marks its row busy, shows the bridge's refusal as
  /// it wrote it, and says [done] when it went through.
  Future<void> _run(
    _RelayBusy busy,
    Future<String?> Function() action,
  ) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = busy);
    String? message;
    try {
      message = await action();
    } on RpcError catch (error) {
      message = error.message;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('relay action got no answer', error, stackTrace);
      message = l10n.relayActionNoAnswer;
    } finally {
      if (mounted) setState(() => _busy = null);
    }
    if (message == null) return;
    messenger
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _toggle(bool enabled) => _run(_RelayBusy.toggling, () async {
        final l10n = AppLocalizations.of(context);
        final outcome = await _relay.setEnabled(
          deviceId: widget.deviceId,
          enabled: enabled,
        );
        if (outcome == RelaySwitchOutcome.applied) return null;
        ref.invalidate(pendingRelaySwitchProvider(widget.deviceId));
        return l10n.relaySwitchKept;
      });

  Future<void> _update(RelayStatus status) async {
    final l10n = AppLocalizations.of(context);
    RelayCredential? credential;
    if (!status.tokenRemembered) {
      credential = await RelayTokenDialog.show(context);
      if (credential == null || !mounted) return;
    }
    await _run(_RelayBusy.updating, () async {
      await _relay.update(
        apiToken: credential?.apiToken,
        remember: credential?.remember,
      );
      return l10n.relayUpdated;
    });
  }

  Future<void> _rotate() async {
    final l10n = AppLocalizations.of(context);
    if (!await confirmRelayRotate(context) || !mounted) return;
    await _run(_RelayBusy.rotating, () async {
      await _relay.rotate();
      return l10n.relayRotated;
    });
  }

  Future<void> _remove(RelayStatus status) async {
    final l10n = AppLocalizations.of(context);
    final choice = await RelayRemoveDialog.show(
      context,
      tokenRemembered: status.tokenRemembered,
    );
    if (choice == null || !mounted) return;
    await _run(_RelayBusy.removing, () async {
      await _relay.remove(
        deleteWorker: choice.deleteWorker,
        apiToken: choice.credential?.apiToken,
        remember: choice.credential?.remember,
      );
      return l10n.relayRemoved;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final status =
        widget.isConnected ? ref.watch(relayStatusProvider).value : null;
    final stored = ref
        .watch(trustedDevicesProvider)
        .value
        ?.firstWhereOrNull((d) => d.macDeviceId == widget.deviceId)
        ?.relay;
    final pending = widget.isConnected
        ? null
        : ref.watch(pendingRelaySwitchProvider(widget.deviceId)).value;

    final live = status != null;
    final endpoint = live ? status.endpoint : stored;
    final rows = _rows(status);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Headed like the screen's other sections (spend, activity).
        Text(l10n.remoteAccessTitle, style: textTheme.titleLarge),
        const SizedBox(height: UxnanSpacing.sm),
        if (endpoint == null)
          _ConnectionWays(
            onSetUp: live ? () => RelaySetupScreen.push(context) : null,
            showConnectHint: !widget.isConnected,
          )
        else ...[
          ExpressiveCardGroup(
            count: rows.length,
            itemBuilder: (context, index, position) => _buildRow(
              rows[index],
              position,
              status: status,
              endpoint: endpoint,
              pending: pending,
            ),
          ),
          if (!widget.isConnected)
            NeSectionHint(text: l10n.relayConnectToManage),
        ],
      ],
    );
  }

  /// The rows of a set-up relay: its status and switch always; its actions
  /// only while the bridge can be asked.
  List<_RelayRow> _rows(RelayStatus? status) => [
        _RelayRow.status,
        _RelayRow.toggle,
        if (status != null) ...[
          if (_updateAvailable(status)) _RelayRow.update,
          _RelayRow.rotate,
          _RelayRow.remove,
        ],
      ];

  /// A relay this bridge deployed whose version is not the one it ships. A
  /// relay the user deployed by hand is theirs to update.
  static bool _updateAvailable(RelayStatus status) {
    final deployed = status.deployedVersion;
    return status.provider != RelayProvider.custom &&
        deployed != null &&
        deployed != status.bundledVersion;
  }

  Widget _buildRow(
    _RelayRow row,
    CardGroupPosition position, {
    required RelayStatus? status,
    required RelayEndpoint endpoint,
    required bool? pending,
  }) {
    final l10n = AppLocalizations.of(context);
    final busy = _busy != null;
    void idle() {}
    Widget? loaderIf(_RelayBusy action) => _busy == action
        ? const SizedBox.square(
            dimension: UxnanSize.iconContent,
            child: PolygonLoader(),
          )
        : null;

    switch (row) {
      case _RelayRow.status:
        return _RelayStatusCard(
          position: position,
          endpoint: endpoint,
          status: status,
        );
      case _RelayRow.toggle:
        final enabled =
            status?.endpoint?.enabled ?? pending ?? endpoint.enabled;
        return NeSwitchTile(
          position: position,
          icon: UxIcons.public,
          title: l10n.relayEnabledTitle,
          subtitle: switch (pending) {
            true => l10n.relaySwitchPendingOn,
            false => l10n.relaySwitchPendingOff,
            null => l10n.relayEnabledSubtitle,
          },
          value: enabled,
          onChanged: busy ? (_) {} : _toggle,
        );
      case _RelayRow.update:
        return NeNavTile(
          position: position,
          icon: UxIcons.systemUpdate,
          title: l10n.relayUpdateTitle,
          subtitle: _busy == _RelayBusy.updating
              ? l10n.relayUpdating
              : l10n.relayUpdateSubtitle(status!.bundledVersion),
          trailing: loaderIf(_RelayBusy.updating),
          onTap: busy ? idle : () => _update(status!),
        );
      case _RelayRow.rotate:
        return NeNavTile(
          position: position,
          icon: UxIcons.autorenew,
          title: l10n.relayRotateTitle,
          subtitle: l10n.relayRotateSubtitle,
          trailing: loaderIf(_RelayBusy.rotating),
          onTap: busy ? idle : _rotate,
        );
      case _RelayRow.remove:
        return NeNavTile(
          position: position,
          icon: UxIcons.delete,
          title: l10n.relayRemoveTitle,
          subtitle: _busy == _RelayBusy.removing
              ? l10n.relayRemoving
              : l10n.relayRemoveSubtitle,
          trailing: loaderIf(_RelayBusy.removing),
          onTap: busy ? idle : () => _remove(status!),
        );
    }
  }
}

enum _RelayRow { status, toggle, update, rotate, remove }

/// The relay itself: where it is, how the bridge reaches it, why the last
/// attempt failed and how many phones use it — or, while the PC is not
/// connected, whether it was on when the PC last said.
class _RelayStatusCard extends StatelessWidget {
  const _RelayStatusCard({
    required this.position,
    required this.endpoint,
    required this.status,
  });

  final CardGroupPosition position;
  final RelayEndpoint endpoint;

  /// The live status; `null` while the PC is not connected.
  final RelayStatus? status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final status = this.status;
    final host = Uri.tryParse(endpoint.url)?.host;

    final badge = switch (status?.state) {
      RelayConnectionState.connected => NeBadge(
          icon: UxIcons.wifiTethering,
          label: l10n.relayStateConnected,
          tone: NeBadgeTone.live,
        ),
      RelayConnectionState.connecting => NeBadge(
          label: l10n.relayStateConnecting,
          tone: NeBadgeTone.secondary,
        ),
      RelayConnectionState.error => NeBadge(
          icon: UxIcons.error,
          label: l10n.relayStateError,
          tone: NeBadgeTone.secondary,
        ),
      RelayConnectionState.off => NeBadge(label: l10n.relayStateOff),
      null => NeBadge(
          label: endpoint.enabled ? l10n.relayStateOn : l10n.relayStateOff,
        ),
    };
    final lastError =
        status?.state == RelayConnectionState.error ? status?.lastError : null;

    return ExpressiveCard(
      position: position,
      color: colors.surfaceContainer,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          UxIcon(UxIcons.cloud, color: colors.onSurfaceVariant),
          const SizedBox(width: UxnanSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      // The rows below are list tiles: same title role.
                      child: Text(
                        l10n.relayYourRelay,
                        style: textTheme.bodyLarge,
                      ),
                    ),
                    const SizedBox(width: UxnanSpacing.sm),
                    badge,
                  ],
                ),
                const SizedBox(height: UxnanSpacing.xs),
                Text(
                  (host == null || host.isEmpty) ? endpoint.url : host,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: UxnanTypography.codeSmall.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                if (lastError != null) ...[
                  const SizedBox(height: UxnanSpacing.sm),
                  Text(
                    lastError,
                    style: textTheme.bodySmall?.copyWith(color: colors.error),
                  ),
                ],
                if (status != null) ...[
                  const SizedBox(height: UxnanSpacing.xs),
                  Text(
                    l10n.relayPhonesConnected(status.connectedPhones),
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// No relay yet: the three ways to reach this PC, and setting up the third.
/// [onSetUp] is null while the PC cannot be asked (not connected, or a bridge
/// that does not report a relay).
class _ConnectionWays extends StatelessWidget {
  const _ConnectionWays({required this.onSetUp, required this.showConnectHint});

  final VoidCallback? onSetUp;
  final bool showConnectHint;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final onSetUp = this.onSetUp;
    return NeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.remoteAccessIntro,
            style: textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: UxnanSpacing.md),
          _Way(
            icon: UxIcons.wifiTethering,
            title: l10n.remoteAccessSameNetworkTitle,
            body: l10n.remoteAccessSameNetworkBody,
          ),
          _Way(
            icon: UxIcons.shield,
            title: l10n.remoteAccessTailscaleTitle,
            body: l10n.remoteAccessTailscaleBody,
          ),
          _Way(
            icon: UxIcons.public,
            title: l10n.remoteAccessRelayTitle,
            body: l10n.remoteAccessRelayBody,
          ),
          if (onSetUp != null) ...[
            const SizedBox(height: UxnanSpacing.md),
            NeButton.icon(
              icon: UxIcons.cloud,
              label: l10n.relaySetUpAction,
              onPressed: onSetUp,
            ),
          ] else if (showConnectHint) ...[
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              l10n.relayConnectToManage,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Way extends StatelessWidget {
  const _Way({required this.icon, required this.title, required this.body});

  final UxIconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          UxIcon(icon, color: colors.primary),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(
                  body,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
