import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/client_kind.dart';
import 'package:uxnan/domain/enums/connection_route.dart';
import 'package:uxnan/domain/value_objects/client_presence.dart';

void main() {
  test("reads a phone's route, as the bridge reports it", () {
    final presence = ClientPresence.listFromJson([
      {
        'id': 'phone-1',
        'kind': 'phone',
        'name': 'Pixel',
        'since': 1,
        'route': 'tailscale',
      },
      {'id': 'local:desktop-default', 'kind': 'desktop', 'name': 'Mac'},
      {'id': 'phone-2', 'kind': 'phone', 'name': 'Old', 'route': 'carrier'},
    ]);

    expect(presence.map((p) => p.route), [
      ConnectionRoute.tailscale,
      // The desktop has none; an unknown value reads as none.
      null,
      null,
    ]);
    expect(presence.first.kind, ClientKind.phone);
  });
}
