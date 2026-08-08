import 'package:flutter/material.dart';
import 'package:uxnan/domain/enums/network_kind.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A small pill that labels the network path a live connection is using —
/// LAN, Tailscale, a direct address, or the relay — following the same
/// "type-specific icon + color pill" pattern as `CommitRefChip`
/// (`git/widgets/commit_ref_chip.dart`). When the path isn't known ([kind] is
/// [NetworkKind.unknown] — including while a connection attempt is still in
/// flight) the badge renders nothing; the in-flight state is carried by the
/// card's own status line, not by this pill.
///
/// Cross-fades between states with [AnimatedSwitcher] — honoring reduced
/// motion — so a kind flip mid-session (e.g. a reconnect that falls back from
/// Tailscale to the relay) reads as a transition, not a jump cut.
class TransportBadge extends StatelessWidget {
  /// Creates a [TransportBadge] for [kind].
  const TransportBadge({required this.kind, this.dense = false, super.key});

  /// The classified network path.
  final NetworkKind kind;

  /// A tighter variant for dense rows.
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    final Widget child;
    if (kind == NetworkKind.unknown) {
      child = const SizedBox.shrink(key: ValueKey('hidden'));
    } else {
      final (icon, label) = _labelFor(kind, l10n);
      final (background, foreground) = _colorsFor(kind, colors);
      child = _Pill(
        key: ValueKey(kind),
        dense: dense,
        background: background,
        foreground: foreground,
        leading: UxIcon(icon, size: dense ? 11 : 13, color: foreground),
        label: label,
      );
    }

    return AnimatedSwitcher(
      duration:
          reduceMotion ? Duration.zero : const Duration(milliseconds: 240),
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      transitionBuilder: (child, animation) =>
          FadeTransition(opacity: animation, child: child),
      child: child,
    );
  }

  (UxIconData, String) _labelFor(NetworkKind kind, AppLocalizations l10n) =>
      (networkKindIcon(kind), networkKindLabel(kind, l10n));

  (Color, Color) _colorsFor(NetworkKind kind, ColorScheme colors) {
    return switch (kind) {
      NetworkKind.lan => (
          colors.tertiaryContainer,
          colors.onTertiaryContainer,
        ),
      NetworkKind.tailscale => (
          colors.primaryContainer,
          colors.onPrimaryContainer,
        ),
      NetworkKind.direct => (
          colors.secondaryContainer,
          colors.onSecondaryContainer,
        ),
      NetworkKind.relay => (
          colors.surfaceContainerHighest,
          colors.onSurfaceVariant,
        ),
      NetworkKind.unknown => (
          colors.surfaceContainerHighest,
          colors.onSurfaceVariant,
        ),
    };
  }
}

class _Pill extends StatelessWidget {
  const _Pill({
    required this.background,
    required this.foreground,
    required this.leading,
    required this.label,
    required this.dense,
    super.key,
  });

  final Color background;
  final Color foreground;
  final Widget leading;
  final String label;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? UxnanSpacing.xs : UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          leading,
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            label,
            style: (dense ? textTheme.labelSmall : textTheme.labelMedium)
                ?.copyWith(color: foreground, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// The human name of a network path, shared by the badge and any surface that
/// spells the path out in words (the device card's connection cell). One
/// mapping, so a rename cannot leave the two disagreeing. Empty for
/// [NetworkKind.unknown] — callers decide what an unclassified live channel
/// should say.
String networkKindLabel(NetworkKind kind, AppLocalizations l10n) {
  return switch (kind) {
    NetworkKind.lan => l10n.transportLan,
    NetworkKind.tailscale => l10n.transportTailscale,
    NetworkKind.direct => l10n.connectionDirect,
    NetworkKind.relay => l10n.connectionRelay,
    NetworkKind.unknown => '',
  };
}

/// The glyph for a network path, shared by the badge and any surface that shows
/// the path on its own (the device card's connection badge). A LAN, a Tailscale
/// tunnel and the relay are different journeys, and one generic aerial for all
/// three told the reader nothing they did not already know.
UxIconData networkKindIcon(NetworkKind kind) => switch (kind) {
      NetworkKind.lan => UxIcons.router,
      NetworkKind.tailscale => UxIcons.shield,
      NetworkKind.direct => UxIcons.link,
      NetworkKind.relay => UxIcons.cloud,
      NetworkKind.unknown => UxIcons.help,
    };
