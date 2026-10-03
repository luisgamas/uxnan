import 'package:uxnan/core/errors/relay_exception.dart';
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
/// [error]: the relay's reason when it was the relay that said no, and the
/// general "couldn't reach it" otherwise. Every "Connect" action in the app
/// says it through this, so the same failure reads the same everywhere.
String connectFailureText(
  AppLocalizations l10n,
  String deviceName,
  Object error,
) =>
    error is RelayException
        ? relayFailureText(l10n, error.failure)
        : l10n.deviceConnectFailed(deviceName);
