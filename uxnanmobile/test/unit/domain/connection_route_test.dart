import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/connection_route.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';

const _relay = RelayEndpoint(
  url: 'wss://relay.example.workers.dev',
  routingId: '0123456789abcdef0123456789abcdef',
  enabled: true,
);

void main() {
  // The same vectors as `shared/test/relay-protocol.test.ts` → "isTailscaleAddress
  // and directRoute tell a tailnet address from the LAN", so the phone and the
  // bridge cannot classify one address two ways.
  group('isTailscaleAddress / directRoute (shared vectors)', () {
    for (final ip in [
      '100.64.0.1',
      '100.76.97.16',
      '100.127.255.254',
      '::ffff:100.100.1.1',
      '[fd7a:115c:a1e0::1]',
    ]) {
      test('$ip is a tailnet address', () {
        expect(isTailscaleAddress(ip), isTrue);
        expect(directRoute(ip), ConnectionRoute.tailscale);
      });
    }
    for (final ip in [
      '192.168.18.22',
      '100.63.255.255',
      '100.128.0.1',
      '10.0.0.5',
      '::1',
      'fe80::1',
      'host.local',
    ]) {
      test('$ip is the LAN', () {
        expect(isTailscaleAddress(ip), isFalse);
        expect(directRoute(ip), ConnectionRoute.lan);
      });
    }
  });

  group('ConnectionRoute.fromWire', () {
    test('reads the three wire values', () {
      expect(ConnectionRoute.fromWire('lan'), ConnectionRoute.lan);
      expect(ConnectionRoute.fromWire('tailscale'), ConnectionRoute.tailscale);
      expect(ConnectionRoute.fromWire('relay'), ConnectionRoute.relay);
    });

    test('anything else is unknown', () {
      expect(ConnectionRoute.fromWire(null), isNull);
      expect(ConnectionRoute.fromWire('direct'), isNull);
      expect(ConnectionRoute.fromWire(3), isNull);
    });
  });

  group('routeOfEndpoint', () {
    test('no endpoint is no route', () {
      expect(routeOfEndpoint(null, relay: _relay), isNull);
      expect(routeOfEndpoint('', relay: _relay), isNull);
    });

    test('a path under the relay is the relay', () {
      expect(
        routeOfEndpoint(
          'wss://relay.example.workers.dev/v1/connect/'
          '0123456789abcdef0123456789abcdef',
          relay: _relay,
        ),
        ConnectionRoute.relay,
      );
      expect(
        routeOfEndpoint(_relay.url, relay: _relay),
        ConnectionRoute.relay,
      );
    });

    test('a direct tailnet host is Tailscale', () {
      expect(
        routeOfEndpoint('ws://100.76.97.16:19850', relay: _relay),
        ConnectionRoute.tailscale,
      );
      expect(
        routeOfEndpoint('ws://[fd7a:115c:a1e0::1]:19850', relay: _relay),
        ConnectionRoute.tailscale,
      );
      // The bare `host:port` form the selector dials without a scheme.
      expect(
        routeOfEndpoint('100.64.1.2:19850', relay: _relay),
        ConnectionRoute.tailscale,
      );
    });

    test('any other direct host is the LAN', () {
      expect(
        routeOfEndpoint('ws://192.168.18.22:19850', relay: _relay),
        ConnectionRoute.lan,
      );
      expect(
        routeOfEndpoint('ws://my-pc.local:19850', relay: _relay),
        ConnectionRoute.lan,
      );
      expect(
        routeOfEndpoint('192.168.1.5:19850', relay: _relay),
        ConnectionRoute.lan,
      );
      // A public address reached directly is still not the relay or a tailnet.
      expect(
        routeOfEndpoint('ws://203.0.113.7:19850', relay: _relay),
        ConnectionRoute.lan,
      );
    });

    test('without a relay nothing is the relay', () {
      expect(
        routeOfEndpoint('wss://relay.example.workers.dev/v1/connect/x'),
        ConnectionRoute.lan,
      );
    });
  });
}
