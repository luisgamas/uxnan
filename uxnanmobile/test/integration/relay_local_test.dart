import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:async/async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
import 'package:uxnan/infrastructure/transport/relay_client.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// The phone's relay client against the REAL relay: the Worker running on the
/// Workers runtime (Miniflare), with a stand-in bridge that authenticates on
/// the host route and echoes on each phone's channel
/// (`tool/relay_e2e/local_relay_host.mjs`).
///
/// Needs Node and the relay built (`npm run build -w uxnan-relay` from the
/// repository root), so it only runs when asked:
///
///   UXNAN_RELAY_E2E=1 flutter test test/integration/relay_local_test.dart
void main() {
  final enabled = Platform.environment['UXNAN_RELAY_E2E'] == '1';

  late Process host;
  late RelayEndpoint endpoint;
  late String ticket;
  late PhoneIdentity phone;

  RelayClient client() => RelayClient(
        createTransport: WebSocketChannelTransport.new,
        identity: () async => phone,
      );

  setUpAll(() async {
    if (!enabled) return;
    // Run from a scratch directory: the local Workers runtime keeps its state
    // (`.wrangler/`) in the working directory.
    final scratch = Directory.systemTemp.createTempSync('uxnan-relay-e2e-');
    addTearDown(() => scratch.delete(recursive: true));
    host = await Process.start(
      'node',
      [File('tool/relay_e2e/local_relay_host.mjs').absolute.path],
      workingDirectory: scratch.path,
    );
    unawaited(host.stderr.transform(utf8.decoder).forEach(stderr.write));
    final ready = await host.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .first
        .timeout(const Duration(seconds: 60));
    final info = jsonDecode(ready) as Map<String, dynamic>;
    endpoint = RelayEndpoint(
      url: info['url'] as String,
      routingId: info['routingId'] as String,
      enabled: true,
    );
    ticket = info['ticket'] as String;
    final keys = await KeyGeneration().generateIdentityKeyPair();
    phone = PhoneIdentity(
      phoneDeviceId: 'phone-e2e',
      publicKey: keys.publicKey,
      privateSeed: keys.privateSeed,
    );
  });

  tearDownAll(() async {
    if (!enabled) return;
    await host.stdin.close();
    await host.exitCode.timeout(
      const Duration(seconds: 15),
      onTimeout: () {
        host.kill();
        return -1;
      },
    );
  });

  Future<void> echoes(WebSocketTransport transport) async {
    final frames = StreamQueue<Uint8List>(transport.incoming);
    final hello = Uint8List.fromList(utf8.encode('{"kind":"clientHello"}'));
    await transport.send(hello);
    expect(await frames.next.timeout(const Duration(seconds: 10)), hello);
    await frames.cancel();
    await transport.disconnect();
  }

  group(
    'RelayClient against the real relay',
    skip: enabled ? false : 'Set UXNAN_RELAY_E2E=1 (needs Node + relay build)',
    () {
      test('an unpaired phone without a ticket is refused', () async {
        await expectLater(
          client().connect(endpoint),
          throwsA(
            isA<RelayException>()
                .having((e) => e.failure, 'failure', RelayFailure.notAllowed),
          ),
        );
      });

      test("pairs through the relay with the QR's ticket, once", () async {
        await echoes(await client().connect(endpoint, ticket: ticket));
        // The ticket is single-use.
        await expectLater(
          client().connect(endpoint, ticket: ticket),
          throwsA(
            isA<RelayException>()
                .having((e) => e.failure, 'failure', RelayFailure.notAllowed),
          ),
        );
      });

      test('a phone the bridge trusts gets in with its key alone', () async {
        host.stdin.writeln(
          jsonEncode({
            'allow': [phone.publicKey.toHex()],
          }),
        );
        await host.stdin.flush();
        // The allow list is applied as the relay reads the host's frame.
        await Future<void>.delayed(const Duration(milliseconds: 300));
        await echoes(await client().connect(endpoint));
      });

      test('the bridge gone from its relay: bridgeOffline', () async {
        host.stdin.writeln(jsonEncode({'drop': true}));
        await host.stdin.flush();
        await Future<void>.delayed(const Duration(milliseconds: 300));
        await expectLater(
          client().connect(endpoint),
          throwsA(
            isA<RelayException>().having(
              (e) => e.failure,
              'failure',
              RelayFailure.bridgeOffline,
            ),
          ),
        );
      });
    },
  );
}
