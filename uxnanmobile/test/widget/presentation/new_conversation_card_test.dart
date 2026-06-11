import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/auth_status.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/threads/new_conversation_screen.dart';

Widget _wrap({required bool requiresLogin}) {
  return ProviderScope(
    overrides: [
      projectsProvider.overrideWith(
        (ref) async => const [Project(id: 'p1', name: 'App', cwd: '/app')],
      ),
      agentsProvider.overrideWith(
        (ref) async => const [
          AgentDescriptor(
            agentId: 'codex',
            displayName: 'Codex',
            available: true,
          ),
        ],
      ),
      agentModelsProvider.overrideWith((ref, id) async => const <AgentModel>[]),
      authStatusProvider.overrideWith(
        (ref, agentId) async => AuthStatus(
          agentId: agentId,
          requiresLogin: requiresLogin,
          loginInProgress: false,
        ),
      ),
    ],
    child: const MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: NewConversationScreen(),
    ),
  );
}

void main() {
  testWidgets('a not-signed-in agent shows the Check sign-in action', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap(requiresLogin: true));
    await tester.pumpAndSettle();

    expect(find.text('Codex'), findsOneWidget);
    // The warning text is replaced by an actionable re-check button.
    expect(find.widgetWithText(TextButton, 'Check sign-in'), findsOneWidget);
  });

  testWidgets('a signed-in agent shows no Check sign-in action', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap(requiresLogin: false));
    await tester.pumpAndSettle();

    expect(find.text('Codex'), findsOneWidget);
    expect(find.text('Check sign-in'), findsNothing);
  });
}
