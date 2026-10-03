import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/connection_route.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/transport_badge.dart';

import '../../support/ux_icon_finder.dart';

Widget _host(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: Center(child: child)),
    );

void main() {
  group('TransportBadge', () {
    for (final (route, label, icon) in [
      (ConnectionRoute.lan, 'LAN', UxIcons.router),
      (ConnectionRoute.tailscale, 'Tailscale', UxIcons.shield),
      (ConnectionRoute.relay, 'Relay', UxIcons.cloud),
    ]) {
      testWidgets('names $label with its own glyph', (tester) async {
        await tester.pumpWidget(_host(TransportBadge(route: route)));

        expect(find.text(label), findsOneWidget);
        expect(findUxIcon(icon), findsOneWidget);
      });
    }

    testWidgets('draws nothing while the route is unknown', (tester) async {
      await tester.pumpWidget(_host(const TransportBadge(route: null)));

      expect(find.byType(Text), findsNothing);
    });
  });

  group('ConnectionStatusBadge', () {
    testWidgets('connected: the route is the status', (tester) async {
      await tester.pumpWidget(
        _host(
          const ConnectionStatusBadge(
            connected: true,
            route: ConnectionRoute.relay,
          ),
        ),
      );
      expect(find.text('Relay'), findsOneWidget);
    });

    testWidgets('connected before the route is known reads "Connected"', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(const ConnectionStatusBadge(connected: true)),
      );
      expect(find.text('Connected'), findsOneWidget);
    });

    testWidgets('a route is never shown for a PC that is not connected', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          const ConnectionStatusBadge(
            connected: false,
            route: ConnectionRoute.lan,
          ),
        ),
      );
      expect(find.text('Disconnected'), findsOneWidget);
      expect(find.text('LAN'), findsNothing);
    });

    testWidgets('an attempt in flight reads "Detecting…"', (tester) async {
      await tester.pumpWidget(
        _host(const ConnectionStatusBadge(connected: false, connecting: true)),
      );
      expect(find.text('Detecting…'), findsOneWidget);
    });
  });
}
