import 'package:flutter/material.dart';
import 'package:uxnan/domain/enums/network_kind.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';

/// A small pill that labels the network path a live connection is using —
/// LAN, Tailscale, a direct address, or the relay — following the same
/// "type-specific icon + color pill" pattern as `CommitRefChip`
/// (`git/widgets/commit_ref_chip.dart`). While a connection attempt is in
/// flight and the kind isn't known yet, pass [detecting] instead of relying
/// on [kind] for a loading state; when neither applies ([kind] is
/// [NetworkKind.unknown] and [detecting] is false), the badge renders nothing.
///
/// Cross-fades between states with [AnimatedSwitcher] — honoring reduced
/// motion — so a kind flip mid-session (e.g. a reconnect that falls back from
/// Tailscale to the relay) reads as a transition, not a jump cut.
class TransportBadge extends StatelessWidget {
  /// Creates a [TransportBadge] for [kind], or a loading pill when
  /// [detecting] is true (in which case [kind] is ignored).
  const TransportBadge({
    required this.kind,
    this.detecting = false,
    this.dense = false,
    super.key,
  });

  /// The classified network path. Ignored while [detecting] is true.
  final NetworkKind kind;

  /// Shows a spinner + "Detecting…" pill instead of [kind] — for a connection
  /// attempt in flight whose path isn't resolved yet.
  final bool detecting;

  /// A tighter variant for dense rows.
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    final Widget child;
    if (detecting) {
      child = _Pill(
        key: const ValueKey('detecting'),
        dense: dense,
        background: colors.surfaceContainerHigh,
        foreground: colors.onSurfaceVariant,
        leading: PolygonLoader(
          size: dense ? 11 : 13,
          color: colors.onSurfaceVariant,
        ),
        label: l10n.transportDetecting,
      );
    } else if (kind == NetworkKind.unknown) {
      child = const SizedBox.shrink(key: ValueKey('hidden'));
    } else {
      final (icon, label) = _labelFor(kind, l10n);
      final (background, foreground) = _colorsFor(kind, colors);
      child = _Pill(
        key: ValueKey(kind),
        dense: dense,
        background: background,
        foreground: foreground,
        leading: Icon(icon, size: dense ? 11 : 13, color: foreground),
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

  (IconData, String) _labelFor(NetworkKind kind, AppLocalizations l10n) {
    return switch (kind) {
      NetworkKind.lan => (Icons.router_rounded, l10n.transportLan),
      NetworkKind.tailscale => (
          Icons.shield_rounded,
          l10n.transportTailscale,
        ),
      NetworkKind.direct => (Icons.link_rounded, l10n.connectionDirect),
      NetworkKind.relay => (Icons.cloud_outlined, l10n.connectionRelay),
      NetworkKind.unknown => (Icons.help_outline_rounded, ''),
    };
  }

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
