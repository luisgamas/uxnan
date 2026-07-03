import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/settings/licenses/licenses_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // Start each test from a clean registry so only the license we add is
  // collected (the default binding collector reads a NOTICES asset that isn't
  // present in the test bundle).
  setUp(LicenseRegistry.reset);

  testWidgets('renders the packages from the license registry', (tester) async {
    LicenseRegistry.addLicense(() async* {
      yield const LicenseEntryWithLineBreaks(
        ['demo_pkg'],
        'MIT license text',
      );
    });

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: LicensesScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('demo_pkg'), findsOneWidget);
    expect(find.text('1 license'), findsOneWidget);
  });
}
