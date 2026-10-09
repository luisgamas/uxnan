import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_view_page.dart';
import 'package:uxnan/domain/repositories/i_agent_view_repository.dart';
import 'package:uxnan/domain/value_objects/agent_view.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/composer_handoff_provider.dart';
import 'package:uxnan/presentation/screens/conversation/messages/view_block.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:webview_flutter/webview_flutter.dart';

class _ViewRepository implements IAgentViewRepository {
  _ViewRepository(this.read);
  final Future<AgentViewPage> Function(String) read;
  @override
  Future<AgentViewPage> readView(String viewId) => read(viewId);
}

void main() {
  test('a view WebView loads its own document and nothing else', () {
    NavigationDecision decide(String url, {bool mainFrame = true}) =>
        viewNavigationDecision(
          NavigationRequest(url: url, isMainFrame: mainFrame),
        );
    expect(decide('about:blank'), NavigationDecision.navigate);
    expect(decide('https://example.com'), NavigationDecision.prevent);
    expect(decide('file:///etc/hosts'), NavigationDecision.prevent);
    expect(decide('about:blank', mainFrame: false), NavigationDecision.prevent);
  });

  const content = ViewContent(
    viewId: '0123456789abcdef0123456789abcdef',
    title: 'Usage',
    bytes: 20,
    height: 320,
  );

  testWidgets('shows loading, error and retry states', (tester) async {
    final load = Completer<AgentViewPage>();
    var attempts = 0;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          agentViewRepositoryProvider.overrideWithValue(
            _ViewRepository((_) {
              attempts++;
              if (attempts == 1) return load.future;
              return Future<AgentViewPage>.error(StateError('offline'));
            }),
          ),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: ViewBlock(content: content, threadId: 'thread')),
        ),
      ),
    );
    expect(find.byType(PolygonLoader), findsOneWidget);
    load.completeError(StateError('temporary'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Retry'), findsOneWidget);
    await tester.tap(find.textContaining('Retry'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Retry'), findsOneWidget);
    expect(attempts, 2);
  });

  testWidgets('notes header shows count and hands formatted notes to composer',
      (tester) async {
    const first = ViewAnnotation(
      selector: '#save',
      tag: 'button',
      text: 'Save',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    );
    const second = ViewAnnotation(
      selector: '#total',
      tag: 'p',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    );
    final notes = ValueNotifier(
      const ViewAnnotationNotes()
          .add(first, 'Make it primary')
          .add(second, 'Show the total'),
    );
    addTearDown(notes.dispose);
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: ViewNotesHeader(
              notes: notes,
              onAddToMessage: () {
                container.read(composerHandoffsProvider.notifier).offerText(
                      'thread',
                      formatViewAnnotations('Usage', notes.value.items),
                    );
              },
              onDiscard: () {},
            ),
          ),
        ),
      ),
    );

    expect(find.text('2 notes'), findsOneWidget);
    await tester.tap(find.text('Add to message'));
    final incoming =
        container.read(composerHandoffsProvider)['thread']?.incoming;
    expect(
      incoming?.text,
      'On the view "Usage":\n\n'
      '1. `#save` (<button>)\n'
      '   Text: Save\n'
      '   Note: Make it primary\n\n'
      '2. `#total` (<p>)\n'
      '   Note: Show the total',
    );
  });

  group('ViewHeights', () {
    setUp(ViewHeights.clear);
    tearDown(ViewHeights.clear);

    test('remembers the last height per view', () {
      expect(ViewHeights.of('a'), isNull);
      ViewHeights.remember('a', 900);
      ViewHeights.remember('a', 1200);
      expect(ViewHeights.of('a'), 1200);
    });

    test('keeps only the most recently reported views', () {
      ViewHeights.remember('first', 100);
      for (var i = 0; i < 255; i++) {
        ViewHeights.remember('v$i', 200);
      }
      // Reporting again makes `first` the newest, so `v0` is the oldest.
      ViewHeights.remember('first', 300);
      ViewHeights.remember('one-more', 400);
      expect(ViewHeights.of('first'), 300);
      expect(ViewHeights.of('v0'), isNull);
      expect(ViewHeights.of('v1'), 200);
    });

    testWidgets('a view mounts at the height it last reported', (tester) async {
      ViewHeights.remember(content.viewId, 900);
      final load = Completer<AgentViewPage>();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            agentViewRepositoryProvider.overrideWithValue(
              _ViewRepository((_) => load.future),
            ),
          ],
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: SingleChildScrollView(
                child: ViewBlock(content: content, threadId: 'thread'),
              ),
            ),
          ),
        ),
      );
      final body = find.ancestor(
        of: find.byType(PolygonLoader),
        matching: find.byType(SizedBox),
      );
      expect(tester.getSize(body.first).height, 900);
      load.completeError(StateError('done'));
      await tester.pumpAndSettle();
    });
  });

  group('keepScreenStill', () {
    Future<(ScrollController, StateSetter)> pumpList(
      WidgetTester tester, {
      required ValueNotifier<double> cardHeight,
    }) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      late StateSetter setCard;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListView(
              controller: controller,
              children: [
                const SizedBox(height: 100),
                StatefulBuilder(
                  key: const ValueKey('card'),
                  builder: (context, setState) {
                    setCard = setState;
                    return SizedBox(height: cardHeight.value);
                  },
                ),
                for (var i = 0; i < 30; i++)
                  SizedBox(
                    key: ValueKey('row$i'),
                    height: 100,
                    child: Text('row $i'),
                  ),
              ],
            ),
          ),
        ),
      );
      return (controller, setCard);
    }

    testWidgets('a card above the screen resizes without moving it',
        (tester) async {
      final height = ValueNotifier<double>(400);
      addTearDown(height.dispose);
      final (controller, setCard) = await pumpList(tester, cardHeight: height);
      // Scrolled past the card, which the list still keeps built.
      controller.jumpTo(600);
      await tester.pump();
      final before = tester.getTopLeft(find.byKey(const ValueKey('row5'))).dy;

      keepScreenStill(
        tester.renderObject(
          find.byKey(const ValueKey('card'), skipOffstage: false),
        ),
        controller.position,
        300,
      );
      setCard(() => height.value = 700);
      await tester.pump();

      expect(tester.getTopLeft(find.byKey(const ValueKey('row5'))).dy, before);
      expect(controller.offset, 900);
    });

    testWidgets('a card on the screen grows downwards', (tester) async {
      final height = ValueNotifier<double>(400);
      addTearDown(height.dispose);
      final (controller, setCard) = await pumpList(tester, cardHeight: height);
      controller.jumpTo(50);
      await tester.pump();

      keepScreenStill(
        tester.renderObject(
          find.byKey(const ValueKey('card'), skipOffstage: false),
        ),
        controller.position,
        300,
      );
      setCard(() => height.value = 700);
      await tester.pump();

      expect(controller.offset, 50);
    });

    testWidgets('a shrinking card never moves the list past its start',
        (tester) async {
      final height = ValueNotifier<double>(1200);
      addTearDown(height.dispose);
      final (controller, setCard) = await pumpList(tester, cardHeight: height);
      controller.jumpTo(150);
      await tester.pump();

      keepScreenStill(
        tester.renderObject(
          find.byKey(const ValueKey('card'), skipOffstage: false),
        ),
        controller.position,
        -1100,
      );
      setCard(() => height.value = 100);
      await tester.pump();

      expect(controller.offset, 0);
    });
  });
}
