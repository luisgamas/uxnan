import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/relay_setup_screen.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A quiet suggestion inside a PC's card, while the phone reaches that PC
/// directly and the PC has no way in from other networks: set up remote
/// access (the PC has no relay) or turn it on (its relay is off).
///
/// It is the moment the person can act — the PC is reachable, so the phone
/// can ask it — and the reason to: away from home, without it, the PC is out
/// of reach. It never blocks anything, and dismissing it hides it for this PC
/// for good ([remoteAccessHintDismissalProvider]). Renders nothing when
/// [remoteAccessHintProvider] has nothing to suggest.
class RemoteAccessHintCard extends ConsumerStatefulWidget {
  /// Creates the hint for the PC [deviceId].
  const RemoteAccessHintCard({
    required this.deviceId,
    this.margin = EdgeInsets.zero,
    super.key,
  });

  /// The PC's `macDeviceId`.
  final String deviceId;

  /// Space around the hint while it shows (none while it does not).
  final EdgeInsetsGeometry margin;

  @override
  ConsumerState<RemoteAccessHintCard> createState() =>
      _RemoteAccessHintCardState();
}

class _RemoteAccessHintCardState extends ConsumerState<RemoteAccessHintCard> {
  bool _busy = false;

  /// Turns the PC's relay on — the same `relay/set` the switch in the PC's
  /// *Remote access* section sends. The hint goes away once the PC shares the
  /// relay as on.
  Future<void> _turnOn() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    String? failure;
    try {
      await ref
          .read(relayManagerProvider)
          .setEnabled(deviceId: widget.deviceId, enabled: true);
    } on RpcError catch (error) {
      failure = error.message;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Turning the relay on got no answer', error, stackTrace);
      failure = l10n.relayActionNoAnswer;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (failure == null) return;
    messenger
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(failure)));
  }

  @override
  Widget build(BuildContext context) {
    final hint = ref.watch(remoteAccessHintProvider(widget.deviceId));
    if (hint == null) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final setUp = hint == RemoteAccessHint.setUp;

    return Container(
      margin: widget.margin,
      // One step up from the card it sits in, so it reads as an aside inside
      // the PC's card rather than a second card.
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
      ),
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.md,
        UxnanSpacing.sm,
        UxnanSpacing.xs,
        UxnanSpacing.sm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: UxnanSpacing.xs),
            child: UxIcon(
              UxIcons.public,
              size: UxnanSize.iconContentSmall,
              color: colors.primary,
            ),
          ),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: UxnanSpacing.xs),
                Text(l10n.remoteAccessHintTitle, style: textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(
                  setUp
                      ? l10n.remoteAccessHintSetUpBody
                      : l10n.remoteAccessHintTurnOnBody,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.xs),
                if (_busy)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
                    child: SizedBox.square(
                      dimension: UxnanSize.iconContent,
                      child: PolygonLoader(),
                    ),
                  )
                else
                  TextButton(
                    // Flush with the text above: the action belongs to it.
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(
                        UxnanSize.minTouchTarget,
                        UxnanSize.minTouchTarget,
                      ),
                      alignment: Alignment.centerLeft,
                    ),
                    onPressed:
                        setUp ? () => RelaySetupScreen.push(context) : _turnOn,
                    child: Text(
                      setUp
                          ? l10n.remoteAccessHintSetUpAction
                          : l10n.remoteAccessHintTurnOnAction,
                    ),
                  ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => ref
                .read(remoteAccessHintDismissalProvider.notifier)
                .dismiss(widget.deviceId),
            icon: const UxIcon(UxIcons.close, size: UxnanSize.iconContentSmall),
            color: colors.onSurfaceVariant,
            tooltip: l10n.remoteAccessHintDismiss,
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}
