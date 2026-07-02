import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/settings/theme_sheets.dart';

Widget _host({void Function(String?)? onResult}) {
  return MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: ElevatedButton(
            onPressed: () async {
              final r = await showThemeImportEditor(
                context,
                title: 'Import theme',
                body: 'Paste JSON',
                hint: 'Paste here',
              );
              onResult?.call(r);
            },
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets(
    'import editor is full-screen: paste field + file/URL sources + Import',
    (tester) async {
      await tester.pumpWidget(_host());
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      // A single paste field that fills the screen, plus both sources.
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('From file'), findsOneWidget);
      expect(find.text('From URL'), findsOneWidget);
      // Primary CTA at the bottom (not an app-bar action / FAB).
      expect(find.widgetWithText(FilledButton, 'Import theme'), findsOneWidget);
      expect(find.byType(FloatingActionButton), findsNothing);
    },
  );

  testWidgets('Import is disabled until there is text, then returns it', (
    tester,
  ) async {
    String? result;
    var called = false;
    await tester.pumpWidget(
      _host(
        onResult: (r) {
          result = r;
          called = true;
        },
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Empty → the Import button is disabled.
    final emptyButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Import theme'),
    );
    expect(emptyButton.onPressed, isNull);

    // Type JSON → Import enabled → returns the text.
    await tester.enterText(find.byType(TextField), '{"name":"X"}');
    await tester.pumpAndSettle();
    final importBtn = find.widgetWithText(FilledButton, 'Import theme');
    await tester.ensureVisible(importBtn);
    await tester.pumpAndSettle();
    await tester.tap(importBtn);
    await tester.pumpAndSettle();

    expect(called, isTrue);
    expect(result, '{"name":"X"}');
  });
}
