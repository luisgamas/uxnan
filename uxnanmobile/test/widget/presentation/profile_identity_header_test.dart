import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/phone_details.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/profile_identity_header.dart';

TrustedDevice _pc(String id) => TrustedDevice(
      macDeviceId: id,
      displayName: id,
      macIdentityPublicKey: Uint8List(32),
      relayUrl: 'wss://relay.example',
      sessionId: 's-$id',
      pairedAt: DateTime(2026, 3),
    );

Widget _wrap({String? name}) => ProviderScope(
      overrides: [
        phoneNameProvider.overrideWith((ref) => Stream.value(name)),
        phoneDetailsProvider.overrideWith(
          (ref) async => const PhoneDetails(
            defaultName: 'Pixel 9',
            model: 'Pixel 9',
            platform: 'android',
            osVersion: '16',
          ),
        ),
        trustedDevicesProvider
            .overrideWith((ref) => Stream.value([_pc('a'), _pc('b')])),
        connectedDeviceProvider.overrideWith((ref) => Stream.value(_pc('a'))),
        memberSinceProvider.overrideWith((ref) => DateTime(2026, 3)),
      ],
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: ProfileIdentityHeader()),
      ),
    );

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(const {}));

  testWidgets("the one name is the phone's, with what it is and its PCs", (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(name: 'Jorge'));
    await tester.pumpAndSettle();
    expect(find.text('Jorge'), findsOneWidget);
    expect(find.text('Pixel 9 · Android 16'), findsOneWidget);
    expect(find.text('2 PCs'), findsOneWidget);
    expect(find.text('1 online now'), findsOneWidget);
    expect(find.text('Member since Mar 2026'), findsOneWidget);
    // No second name field anywhere: the pencil renames the phone.
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('until named, the phone goes by its own name', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    expect(find.text('Pixel 9'), findsOneWidget);
    // The model is not repeated under a name that already is the model.
    expect(find.text('Android 16'), findsOneWidget);
  });

  testWidgets('the pencil offers to rename the phone', (tester) async {
    await tester.pumpWidget(_wrap(name: 'Jorge'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Name this phone'));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget);
  });
}
