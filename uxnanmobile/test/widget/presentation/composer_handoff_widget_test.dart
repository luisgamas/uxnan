import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/composer_handoff_provider.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';

/// The composer's half of the hand-off: text pushed into
/// [ComposerHandoffState.incoming] must actually land in the field.
///
/// The unit tests cover the state machine; this covers the wiring between it
/// and the widget, which is where "the draft was saved but the message never
/// appeared" lives.
Widget _wrap(ProviderContainer container) {
  return UncontrolledProviderScope(
    container: container,
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Align(
          alignment: Alignment.bottomCenter,
          child: ComposerBar(onSend: (_) {}, threadId: 'th1'),
        ),
      ),
    ),
  );
}

String _composerText(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!.text;

void main() {
  testWidgets('incoming text lands in the composer', (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(_wrap(container));
    await tester.pumpAndSettle();

    // What `ComposerHandoff.edit` does once the bridge confirms.
    container.read(composerHandoffsProvider.notifier).state = {
      'th1': const ComposerHandoffState(incoming: 'the queued wording'),
    };
    await tester.pumpAndSettle();

    expect(_composerText(tester), 'the queued wording');
    // And it is consumed, so a later rebuild does not re-apply it over
    // whatever the user has since typed.
    expect(
      container.read(composerHandoffProvider('th1')).incoming,
      isNull,
    );
  });

  testWidgets('incoming text replaces what the composer held', (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(_wrap(container));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'half-written');
    await tester.pumpAndSettle();
    // The composer mirrors its draft so the bubble's Edit action can tell it
    // would be overwriting something.
    expect(
      container.read(composerHandoffProvider('th1')).draft,
      'half-written',
    );

    container.read(composerHandoffsProvider.notifier).state = {
      'th1': const ComposerHandoffState(
        incoming: 'the queued wording',
        draft: 'half-written',
      ),
    };
    await tester.pumpAndSettle();

    expect(_composerText(tester), 'the queued wording');
  });

  testWidgets('the composer reports its draft as the user types',
      (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(_wrap(container));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'typing');
    await tester.pumpAndSettle();
    expect(container.read(composerHandoffProvider('th1')).draft, 'typing');

    await tester.enterText(find.byType(TextField), '');
    await tester.pumpAndSettle();
    expect(container.read(composerHandoffProvider('th1')).draft, '');
  });

  testWidgets('editing a queued message puts its text in the composer',
      (tester) async {
    // The real path: ComposerHandoff.edit() withdraws the turn through a
    // ThreadManager and then hands the text over — not a hand-set state.
    final db = UxnanDatabase.forTesting(NativeDatabase.memory());
    addTearDown(db.close);
    final events = StreamController<DomainEvent>.broadcast();
    addTearDown(events.close);
    final manager = ThreadManager(
      threadRepository: DriftThreadRepository(db),
      messageRepository: DriftMessageRepository(db),
      domainEvents: events.stream,
      sendRequest: (method, [params]) async =>
          RpcMessage.response(id: '1', result: const <String, dynamic>{}),
    );
    addTearDown(manager.dispose);
    final container = ProviderContainer(
      overrides: [threadManagerProvider.overrideWithValue(manager)],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(_wrap(container));
    await tester.pumpAndSettle();

    // The user is mid-sentence when they decide to edit a queued message.
    await tester.enterText(find.byType(TextField), 'half-written');
    await tester.pumpAndSettle();

    final outcome =
        await container.read(composerHandoffsProvider.notifier).edit(
              threadId: 'th1',
              turnId: 'turn-q1',
              text: 'the queued wording',
            );
    await tester.pumpAndSettle();

    expect(outcome, RecoverOutcome.restoredAndRescued);
    // Both halves must happen: the draft is saved AND the queued text lands.
    expect(
      container.read(composerHandoffProvider('th1')).rescued.single.text,
      'half-written',
    );
    expect(_composerText(tester), 'the queued wording');
  });
}
