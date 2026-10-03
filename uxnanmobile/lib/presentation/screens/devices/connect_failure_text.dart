import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/entities/connection_recovery_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';

/// What to tell the person when the user's relay did not put this phone
/// through to its PC — one sentence they can act on, never a close code.
///
/// The relay's reasons collapse to four the person can do something about:
/// the PC (or its bridge) is not there, this phone is no longer trusted, the
/// relay is full, or the relay itself cannot be reached.
String relayFailureText(AppLocalizations l10n, RelayFailure failure) =>
    switch (failure) {
      RelayFailure.bridgeOffline ||
      RelayFailure.bridgeTimeout ||
      RelayFailure.peerClosed =>
        l10n.relayFailureBridgeOffline,
      RelayFailure.notAllowed ||
      RelayFailure.revoked ||
      RelayFailure.authFailed =>
        l10n.relayFailureNotPaired,
      RelayFailure.full => l10n.relayFailureFull,
      RelayFailure.authTimeout ||
      RelayFailure.badFrame ||
      RelayFailure.replaced ||
      RelayFailure.unreachable ||
      RelayFailure.protocol =>
        l10n.relayFailureUnreachable,
    };

/// What to tell the person when connecting to the PC [deviceName] failed with
/// [error]: the relay's reason when it was the relay that said no; that the
/// PC's remote access is off when no direct host answered and there was no
/// relay to try ([TransportErrorKind.noRoute]); the general "couldn't reach
/// it" otherwise. Every "Connect" action in the app says it through this, so
/// the same failure reads the same everywhere.
String connectFailureText(
  AppLocalizations l10n,
  String deviceName,
  Object error,
) =>
    switch (error) {
      RelayException(:final failure) => relayFailureText(l10n, failure),
      TransportException(kind: TransportErrorKind.noRoute) =>
        l10n.deviceNoRemoteRoute(deviceName),
      _ => l10n.deviceConnectFailed(deviceName),
    };

/// Why the reconnection loop's last attempt at the PC [deviceName] failed, in
/// the same words as [connectFailureText] — or `null` when there is nothing
/// more specific to say than "not connected".
String? recoveryFailureText(
  AppLocalizations l10n,
  String deviceName,
  ConnectionRecoveryState state,
) {
  final relay = state.lastRelayFailure;
  if (relay != null) return relayFailureText(l10n, relay);
  if (state.lastTransportFailure == TransportErrorKind.noRoute) {
    return l10n.deviceNoRemoteRoute(deviceName);
  }
  return null;
}
