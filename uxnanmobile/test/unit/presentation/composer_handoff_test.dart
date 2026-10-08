import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/composer_handoff_provider.dart';

/// Cancelling a queued message hands its text back to the composer. The only
/// thing that can go wrong is destroying whatever the composer already held —
/// these pin down that it never does.
void main() {
  late UxnanDatabase db;
  late ProviderContainer container;
  late StreamController<DomainEvent> events;

  /// Whether the fake bridge accepts `turn/cancel`.
  late bool cancelSucceeds;

  /// Whether the fake bridge serves `turn/attachment`.
  late bool attachmentServed;

  /// Methods sent to the fake bridge, in order.
  late List<String> sent;

  ComposerHandoff notifier() =>
      container.read(composerHandoffsProvider.notifier);
  ComposerHandoffState stateOf(String threadId) =>
      container.read(composerHandoffProvider(threadId));

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    events = StreamController<DomainEvent>.broadcast();
    cancelSucceeds = true;
    attachmentServed = true;
    sent = [];
    final manager = ThreadManager(
      threadRepository: DriftThreadRepository(db),
      messageRepository: DriftMessageRepository(db),
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        sent.add(method);
        if (method == 'turn/attachment') {
          // TurnAttachmentData: the bytes, base64, with their type.
          return attachmentServed
              ? RpcMessage.response(
                  id: '1',
                  result: const {
                    'mimeType': 'image/png',
                    'base64Data': 'AAEC',
                  },
                )
              : RpcMessage.response(
                  id: '1',
                  error: const RpcError(
                    code: -32602,
                    message: 'attachment not found',
                  ),
                );
        }
        if (method == 'turn/cancel' && !cancelSucceeds) {
          return RpcMessage.response(
            id: '1',
            error: const RpcError(code: -32008, message: 'turn not found'),
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
    container = ProviderContainer(
      overrides: [threadManagerProvider.overrideWithValue(manager)],
    );
  });

  tearDown(() async {
    container.dispose();
    await events.close();
    await db.close();
  });

  test('view text enters an empty composer without sending', () {
    notifier().offerText('th1', 'view message');

    expect(stateOf('th1').incoming?.text, 'view message');
    expect(sent, isEmpty);
  });

  test('view text preserves pending handoffs and rescues the current draft',
      () {
    const image = ImageContent(mimeType: 'image/png', base64Data: 'AAEC');
    container.read(composerHandoffsProvider.notifier).state = {
      'th1': const ComposerHandoffState(
        draft: 'existing draft',
        incoming: ComposerIncoming(
          text: 'prior offered text',
          images: [image],
        ),
      ),
    };

    notifier().offerText('th1', 'view note');

    expect(stateOf('th1').incoming?.text, 'prior offered text\n\nview note');
    expect(stateOf('th1').incoming?.images, [image]);
    expect(stateOf('th1').rescued.single.text, 'existing draft');
    expect(sent, isEmpty);
  });

  test('editing a queued message hands its text to an empty composer',
      () async {
    final outcome = await notifier().edit(
      threadId: 'th1',
      turnId: 'turn-a',
      text: 'the queued wording',
    );

    expect(outcome, RecoverOutcome.restored);
    expect(stateOf('th1').incoming?.text, 'the queued wording');
    expect(stateOf('th1').rescued, isEmpty);
  });

  test('editing over a busy composer saves what was being written', () async {
    notifier().reportDraft('th1', 'half-written thought');

    final outcome = await notifier().edit(
      threadId: 'th1',
      turnId: 'turn-a',
      text: 'the queued wording',
    );

    expect(outcome, RecoverOutcome.restoredAndRescued);
    // The queued message wins the composer...
    expect(stateOf('th1').incoming?.text, 'the queued wording');
    // ...and the displaced draft is kept, not dropped.
    expect(stateOf('th1').rescued.single.text, 'half-written thought');
  });

  test('a refused withdrawal moves nothing at all', () async {
    cancelSucceeds = false;
    notifier().reportDraft('th1', 'still mine');

    final outcome = await notifier().edit(
      threadId: 'th1',
      turnId: 'turn-a',
      text: 'the queued wording',
    );

    expect(outcome, RecoverOutcome.failed);
    // Critical: the message is still queued to run, so putting its text in the
    // composer too would get it sent twice.
    expect(stateOf('th1').incoming, isNull);
    expect(stateOf('th1').rescued, isEmpty);
    expect(stateOf('th1').draft, 'still mine');
  });

  test('a rescued draft only returns to an empty composer', () async {
    notifier().reportDraft('th1', 'first draft');
    await notifier().edit(
      threadId: 'th1',
      turnId: 'turn-a',
      text: 'queued one',
    );
    final rescued = stateOf('th1').rescued.single;

    // The composer now holds the recovered message.
    notifier().reportDraft('th1', 'queued one');
    expect(notifier().restore('th1', rescued), isFalse);
    expect(stateOf('th1').rescued, hasLength(1), reason: 'nothing was lost');

    // Empty it and the draft comes back.
    notifier().reportDraft('th1', '');
    expect(notifier().restore('th1', rescued), isTrue);
    expect(stateOf('th1').incoming?.text, 'first draft');
    expect(stateOf('th1').rescued, isEmpty);
  });

  test('whitespace does not count as an occupied composer', () async {
    notifier().reportDraft('th1', '   \n  ');
    final outcome = await notifier().edit(
      threadId: 'th1',
      turnId: 'turn-a',
      text: 'queued one',
    );
    expect(outcome, RecoverOutcome.restored);
    expect(stateOf('th1').rescued, isEmpty);
  });

  test('rescued drafts stack newest-first and can be dismissed', () async {
    notifier().reportDraft('th1', 'draft one');
    await notifier().edit(threadId: 'th1', turnId: 'turn-a', text: 'queued a');
    notifier().reportDraft('th1', 'draft two');
    await notifier().edit(threadId: 'th1', turnId: 'turn-b', text: 'queued b');

    expect(
      stateOf('th1').rescued.map((d) => d.text).toList(),
      ['draft two', 'draft one'],
    );

    notifier().dismiss('th1', stateOf('th1').rescued.first);
    expect(stateOf('th1').rescued.single.text, 'draft one');
  });

  test('the composer consuming the incoming text clears it', () async {
    await notifier()
        .edit(threadId: 'th1', turnId: 'turn-a', text: 'queued one');
    expect(stateOf('th1').incoming, isNotNull);

    notifier().consumeIncoming('th1');
    expect(stateOf('th1').incoming, isNull);
  });

  test('hand-off state is per thread', () async {
    notifier().reportDraft('th1', 'thread one draft');
    await notifier()
        .edit(threadId: 'th2', turnId: 'turn-a', text: 'queued in two');

    expect(stateOf('th1').incoming, isNull);
    expect(stateOf('th1').draft, 'thread one draft');
    expect(stateOf('th2').incoming?.text, 'queued in two');
    // th2's composer was empty, so nothing of th1's was touched.
    expect(stateOf('th2').rescued, isEmpty);
  });

  test('editing hands the attachments back with the text', () async {
    // What a message sent from this phone holds: the bytes inline.
    const image = ImageContent(mimeType: 'image/png', base64Data: 'iVBO');
    const file = AttachedFileContent(
      name: 'notes.md',
      mimeType: 'text/markdown',
      bytes: 3,
      base64Data: 'AAEC',
    );

    final outcome = await notifier().edit(
      threadId: 'th1',
      turnId: 'turn-a',
      text: 'look at these',
      images: const [image],
      files: const [file],
    );

    expect(outcome, RecoverOutcome.restored);
    expect(
      stateOf('th1').incoming,
      const ComposerIncoming(
        text: 'look at these',
        images: [image],
        files: [file],
      ),
    );
  });

  test('an attachment held by reference is fetched before withdrawing',
      () async {
    final outcome = await notifier().edit(
      threadId: 'th1',
      turnId: 'turn-a',
      text: '',
      images: const [
        ImageContent(mimeType: 'image/png', attachmentId: 'att-1', width: 2),
      ],
      files: const [
        AttachedFileContent(
          name: 'log.txt',
          mimeType: 'text/plain',
          bytes: 3,
          attachmentId: 'att-2',
        ),
      ],
    );

    expect(outcome, RecoverOutcome.restored);
    // Fetched while the message is still queued, then withdrawn.
    expect(sent, ['turn/attachment', 'turn/attachment', 'turn/cancel']);
    final incoming = stateOf('th1').incoming!;
    expect(incoming.images.single.base64Data, 'AAEC');
    expect(incoming.images.single.width, 2);
    expect(incoming.files.single.name, 'log.txt');
    expect(incoming.files.single.base64Data, 'AAEC');
  });

  test('an attachment that cannot be fetched keeps the message queued',
      () async {
    attachmentServed = false;

    final outcome = await notifier().edit(
      threadId: 'th1',
      turnId: 'turn-a',
      text: 'with a picture',
      images: const [ImageContent(mimeType: 'image/png', attachmentId: 'x')],
    );

    expect(outcome, RecoverOutcome.failed);
    // Never withdrawn: editing must not silently drop part of the message.
    expect(sent, isNot(contains('turn/cancel')));
    expect(stateOf('th1').incoming, isNull);
  });
}
