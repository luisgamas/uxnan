import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/devices/connect_failure_text.dart';

void main() {
  final en = lookupAppLocalizations(const Locale('en'));
  final es = lookupAppLocalizations(const Locale('es'));

  test('each relay refusal reads as one of four reasons a person can act on',
      () {
    expect(
      relayFailureText(en, RelayFailure.bridgeOffline),
      'Your PC is offline or its bridge is stopped.',
    );
    expect(
      relayFailureText(en, RelayFailure.bridgeTimeout),
      en.relayFailureBridgeOffline,
    );
    expect(
      relayFailureText(en, RelayFailure.notAllowed),
      'This phone is no longer paired with the PC — pair again.',
    );
    expect(
      relayFailureText(en, RelayFailure.revoked),
      en.relayFailureNotPaired,
    );
    expect(
      relayFailureText(en, RelayFailure.full),
      'Too many phones are connected through the relay.',
    );
    expect(
      relayFailureText(en, RelayFailure.unreachable),
      "Can't reach your relay.",
    );
    final reasons = {
      en.relayFailureBridgeOffline,
      en.relayFailureNotPaired,
      en.relayFailureFull,
      en.relayFailureUnreachable,
    };
    for (final failure in RelayFailure.values) {
      expect(reasons, contains(relayFailureText(en, failure)));
      expect(relayFailureText(es, failure), isNotEmpty);
    }
  });

  test('a relay refusal names its reason; anything else the generic line', () {
    expect(
      connectFailureText(
        en,
        'Studio',
        const RelayException(RelayFailure.revoked, 'revoked'),
      ),
      en.relayFailureNotPaired,
    );
    expect(
      connectFailureText(en, 'Studio', StateError('no route')),
      en.deviceConnectFailed('Studio'),
    );
  });
}
