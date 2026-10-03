import 'package:flutter/material.dart';
import 'package:uxnan/domain/enums/connection_route.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_badge.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A small pill that names how a live connection reaches its PC — LAN,
/// Tailscale or the relay — following the same "type-specific icon + color
/// pill" pattern as `CommitRefChip` (`git/widgets/commit_ref_chip.dart`).
/// When the route isn't known ([route] is null — including while a connection
/// attempt is still in flight) the badge renders nothing; the in-flight state
/// is carried by the surface's own status line, not by this pill.
///
/// Cross-fades between states with [AnimatedSwitcher] — honoring reduced
/// motion — so a route change mid-session (back home: the relay gives way to
/// the LAN) reads as a transition, not a jump cut.
class TransportBadge extends StatelessWidget {
  /// Creates a [TransportBadge] for [route].
  const TransportBadge({required this.route, this.dense = false, super.key});

  /// How the live channel reaches the PC, or null when unknown.
  final ConnectionRoute? route;

  /// A tighter variant for dense rows.
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final route = this.route;

    final Widget child;
    if (route == null) {
      child = const SizedBox.shrink(key: ValueKey('hidden'));
    } else {
      final (background, foreground) = _colorsFor(route, colors);
      child = _Pill(
        key: ValueKey(route),
        dense: dense,
        background: background,
        foreground: foreground,
        leading: UxIcon(
          connectionRouteIcon(route),
          size: dense ? 11 : 13,
          color: foreground,
        ),
        label: connectionRouteLabel(route, l10n),
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

  (Color, Color) _colorsFor(ConnectionRoute route, ColorScheme colors) {
    return switch (route) {
      ConnectionRoute.lan => (
          colors.tertiaryContainer,
          colors.onTertiaryContainer,
        ),
      ConnectionRoute.tailscale => (
          colors.primaryContainer,
          colors.onPrimaryContainer,
        ),
      ConnectionRoute.relay => (
          colors.secondaryContainer,
          colors.onSecondaryContainer,
        ),
    };
  }
}

/// A PC's connection status as one [NeBadge]: the live route while connected
/// (`LAN`, `Tailscale`, `Relay` — a plain "Connected" until the route is
/// known), `Detecting…` while its own attempt runs, `Disconnected` otherwise.
///
/// The device card on the home screen and the PC's details both wear this one,
/// so "connected" — and how — is one shape wherever a PC is shown.
class ConnectionStatusBadge extends StatelessWidget {
  /// Creates a [ConnectionStatusBadge].
  const ConnectionStatusBadge({
    required this.connected,
    this.connecting = false,
    this.route,
    super.key,
  });

  /// Whether this PC holds the live channel.
  final bool connected;

  /// Whether a connection attempt to this PC is in flight.
  final bool connecting;

  /// How the live channel reaches this PC, when [connected] and known.
  final ConnectionRoute? route;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final route = connected ? this.route : null;
    return NeBadge(
      icon: !connected
          ? UxIcons.cloudOff
          : route == null
              ? UxIcons.wifiTethering
              : connectionRouteIcon(route),
      label: !connected
          ? (connecting ? l10n.transportDetecting : l10n.connectionDisconnected)
          : route == null
              ? l10n.connectionConnected
              : connectionRouteLabel(route, l10n),
      tone: connected ? NeBadgeTone.live : NeBadgeTone.secondary,
    );
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

/// The human name of a route, shared by every surface that names one (the
/// drawer's pill, the PC's status badge). One mapping, so a rename cannot
/// leave two surfaces disagreeing.
String connectionRouteLabel(ConnectionRoute route, AppLocalizations l10n) {
  return switch (route) {
    ConnectionRoute.lan => l10n.transportLan,
    ConnectionRoute.tailscale => l10n.transportTailscale,
    ConnectionRoute.relay => l10n.connectionRelay,
  };
}

/// The glyph for a route. A LAN, a Tailscale tunnel and the relay are
/// different journeys, and one generic aerial for all three told the reader
/// nothing they did not already know.
UxIconData connectionRouteIcon(ConnectionRoute route) => switch (route) {
      ConnectionRoute.lan => UxIcons.router,
      ConnectionRoute.tailscale => UxIcons.shield,
      ConnectionRoute.relay => UxIcons.cloud,
    };
