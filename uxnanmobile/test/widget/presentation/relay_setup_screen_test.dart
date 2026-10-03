import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/relay_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/relay_setup_screen.dart';

import '../../support/relay_fakes.dart';

/// Opens the setup page over a host page, as PC details does.
Future<({FakeRelayBridge bridge, List<Uri> opened})> _open(
  WidgetTester tester,
) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.625;
  addTearDown(tester.view.reset);
  final bridge = FakeRelayBridge(relayStatusJson());
  final opened = <Uri>[];
  final manager = RelayManager(
    sendRequest: bridge.send,
    sendCloudflareRequest: bridge.sendViaCloudflare,
    domainEvents: const Stream<DomainEvent>.empty(),
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [relayManagerProvider.overrideWithValue(manager)],
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => RelaySetupScreen(
                      openUrl: (url) async {
                        opened.add(url);
                        return true;
                      },
                    ),
                  ),
                ),
                child: const Text('host'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('host'));
  await tester.pumpAndSettle();
  return (bridge: bridge, opened: opened);
}

Finder _field(String label) => find.widgetWithText(TextField, label);

/// Scrolls [finder] into view (the form is taller than a phone) and taps it.
Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
}

void main() {
  testWidgets('says where to get the token and the account id', (tester) async {
    final setup = await _open(tester);

    expect(find.text('Set up your relay'), findsOneWidget);
    expect(
      find.textContaining('“Edit Cloudflare Workers”'),
      findsOneWidget,
    );
    expect(find.textContaining('dash.cloudflare.com/'), findsOneWidget);

    await _tap(tester, find.text('Open Cloudflare API tokens'));
    await tester.pump();
    expect(setup.opened, [
      Uri.parse('https://dash.cloudflare.com/profile/api-tokens'),
    ]);

    // The token is a secret: obscured until asked, and remembering it on the
    // PC is opt-in.
    final token = tester.widget<TextField>(_field('API token'));
    expect(token.obscureText, isTrue);
    expect(
      tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value,
      isFalse,
    );
  });

  testWidgets('both fields are needed before anything is sent', (tester) async {
    final setup = await _open(tester);

    await _tap(tester, find.text('Deploy relay'));
    await tester.pump();
    expect(find.text('Enter the account ID and the token.'), findsOneWidget);
    expect(setup.bridge.requests, isEmpty);
  });

  testWidgets('deploys with progress, then closes saying it is ready',
      (tester) async {
    final setup = await _open(tester);
    setup.bridge.holds['relay/setup'] = Completer<void>();

    await tester.enterText(_field('Account ID'), ' acc-1 ');
    await tester.enterText(_field('API token'), 'tok-1');
    await _tap(tester, find.text('Remember the token on the PC'));
    await tester.pump();
    await _tap(tester, find.text('Deploy relay'));
    await tester.pump();

    expect(find.text('Deploying…'), findsOneWidget);
    expect(
      find.text('This can take up to a minute. Keep the app open.'),
      findsOneWidget,
    );
    expect(setup.bridge.viaCloudflare, ['relay/setup']);
    expect(setup.bridge.requests.single.$2, {
      'provider': 'cloudflare',
      'accountId': 'acc-1',
      'apiToken': 'tok-1',
      'remember': true,
    });

    setup.bridge.release('relay/setup');
    await tester.pumpAndSettle();
    expect(find.byType(RelaySetupScreen), findsNothing);
    expect(find.text('Your relay is ready.'), findsOneWidget);
  });

  testWidgets(
      "a refusal shows inline in the bridge's words and the token is cleared",
      (tester) async {
    final setup = await _open(tester);
    setup.bridge.refusals['relay/setup'] =
        'That token cannot edit Workers on this account.';

    await tester.enterText(_field('Account ID'), 'acc-1');
    await tester.enterText(_field('API token'), 'tok-1');
    await _tap(tester, find.text('Deploy relay'));
    await tester.pumpAndSettle();

    expect(find.byType(RelaySetupScreen), findsOneWidget);
    expect(
      find.text('That token cannot edit Workers on this account.'),
      findsOneWidget,
    );
    final token = tester.widget<TextField>(_field('API token'));
    expect(token.controller!.text, isEmpty);
    final account = tester.widget<TextField>(_field('Account ID'));
    expect(account.controller!.text, 'acc-1');
  });
}
