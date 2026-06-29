import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/settings/prompt_templates_screen.dart';

void main() {
  setUp(() {
    // Seed one known template so the screen hydrates a small, stable list
    // (avoids the locale-dependent default seed).
    SharedPreferences.setMockInitialValues({
      'uxnan.composer.promptTemplates': jsonEncode([
        {'id': 'review', 'label': 'Review', 'body': 'Review this: '},
      ]),
    });
  });

  Widget app() => const ProviderScope(
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: PromptTemplatesScreen(),
        ),
      );

  testWidgets('lists the stored templates and adds a new one', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();

    expect(find.text('Review'), findsOneWidget);

    // Open the editor sheet from the add FAB (the M3 extended FAB).
    await tester.tap(find.widgetWithText(FloatingActionButton, 'New template'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'Summarize');
    await tester.enterText(find.byType(TextField).last, 'Summarize this: ');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    // The new template now appears in the list alongside the seeded one.
    expect(find.text('Summarize'), findsOneWidget);
    expect(find.text('Review'), findsOneWidget);
  });

  testWidgets('deletes a template after confirming', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();

    expect(find.text('Review'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.delete_outline_rounded));
    await tester.pumpAndSettle();

    // Confirm in the dialog.
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(find.text('Review'), findsNothing);
    expect(find.text('No templates'), findsOneWidget);
  });
}
