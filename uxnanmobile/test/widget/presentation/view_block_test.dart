import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_view_page.dart';
import 'package:uxnan/domain/repositories/i_agent_view_repository.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
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
}
