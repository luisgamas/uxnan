import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/infrastructure/media/attachment_picker_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/composer/turn_control_shelf.dart';
import 'package:uxnan/presentation/screens/conversation/composer/turn_tools_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';

Widget _wrap(Widget child) => ProviderScope(
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: child),
      ),
    );

void main() {
  testWidgets('attachment button opens a compact two-item menu',
      (tester) async {
    AttachmentSource? picked;
    await tester.pumpWidget(
      _wrap(
        TurnToolsMenuButton(
          onSelected: (source) => picked = source,
        ),
      ),
    );

    await tester.tap(find.byIcon(Icons.add_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Photo library'), findsOneWidget);
    expect(find.text('Take a photo'), findsOneWidget);

    await tester.tap(find.text('Photo library'));
    await tester.pumpAndSettle();
    expect(picked, AttachmentSource.gallery);
  });

  testWidgets('turn shelf exposes compact icons and folds to one control',
      (tester) async {
    var expanded = true;
    var approvalTaps = 0;
    const option = AgentModelOption(
      key: 'reasoning',
      kind: 'enum',
      label: 'Reasoning effort',
      values: [
        AgentModelOptionValue(value: 'high', label: 'High'),
      ],
    );

    late StateSetter rebuild;
    await tester.pumpWidget(
      _wrap(
        StatefulBuilder(
          builder: (context, setState) {
            rebuild = setState;
            return TurnControlShelf(
              threadId: 'thread-1',
              options: const [option],
              showApproval: true,
              approvalMode: ApprovalMode.fullAccess,
              expanded: expanded,
              onExpandedChanged: (value) {
                expanded = value;
                rebuild(() {});
              },
              onApprovalTap: () => approvalTaps++,
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.psychology_alt_outlined), findsOneWidget);
    expect(find.byIcon(Icons.lock_open_rounded), findsOneWidget);
    expect(find.text('Reasoning effort: Auto'), findsNothing);
    expect(find.text('Full access'), findsNothing);
    final chevronX =
        tester.getCenter(find.byKey(const ValueKey('turn-controls-toggle'))).dx;
    final reasoningX =
        tester.getCenter(find.byIcon(Icons.psychology_alt_outlined)).dx;
    final approvalX = tester.getCenter(find.byIcon(Icons.lock_open_rounded)).dx;
    expect(reasoningX - chevronX, lessThanOrEqualTo(52));
    expect(approvalX - reasoningX, lessThanOrEqualTo(52));
    final surfaces = find.byKey(const ValueKey('compact-control-surface'));
    expect(surfaces, findsNWidgets(3));
    for (final element in surfaces.evaluate()) {
      expect(
        tester.getSize(find.byElementPredicate((e) => e == element)),
        const Size.square(38),
      );
    }
    expect(
      tester.widget<Icon>(find.byIcon(Icons.psychology_alt_outlined)).size,
      24,
    );

    await tester.tap(find.byIcon(Icons.lock_open_rounded));
    expect(approvalTaps, 1);

    await tester.tap(find.byKey(const ValueKey('turn-controls-toggle')));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.psychology_alt_outlined), findsNothing);
    expect(find.byIcon(Icons.lock_open_rounded), findsNothing);
    expect(find.byKey(const ValueKey('turn-controls-toggle')), findsOneWidget);
  });

  testWidgets('approval icon color communicates the selected safety mode',
      (tester) async {
    const cases = [
      (
        ApprovalMode.approveForMe,
        Icons.verified_user_outlined,
        UxnanColors.success
      ),
      (ApprovalMode.fullAccess, Icons.lock_open_rounded, UxnanColors.error),
      (
        ApprovalMode.requestApproval,
        Icons.pan_tool_outlined,
        UxnanColors.warning
      ),
    ];

    for (final (mode, icon, color) in cases) {
      await tester.pumpWidget(
        _wrap(
          TurnControlShelf(
            threadId: 'thread-1',
            options: const [],
            showApproval: true,
            approvalMode: mode,
            expanded: true,
            onExpandedChanged: (_) {},
            onApprovalTap: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.widget<Icon>(find.byIcon(icon)).color, color);
    }
  });

  testWidgets('reasoning menu keeps composer focus and keyboard intent',
      (tester) async {
    final focusNode = FocusNode();
    addTearDown(focusNode.dispose);
    const option = AgentModelOption(
      key: 'reasoning',
      kind: 'enum',
      label: 'Reasoning effort',
      values: [
        AgentModelOptionValue(value: 'high', label: 'High'),
      ],
    );

    await tester.pumpWidget(
      _wrap(
        Column(
          children: [
            TextField(focusNode: focusNode),
            TurnControlShelf(
              threadId: 'thread-1',
              options: const [option],
              showApproval: false,
              approvalMode: ApprovalMode.fullAccess,
              expanded: true,
              onExpandedChanged: (_) {},
              onApprovalTap: () {},
            ),
          ],
        ),
      ),
    );

    await tester.tap(find.byType(TextField));
    await tester.pump();
    expect(focusNode.hasFocus, isTrue);

    await tester.tap(find.byIcon(Icons.psychology_alt_outlined));
    await tester.pumpAndSettle();

    expect(find.text('High'), findsOneWidget);
    expect(focusNode.hasFocus, isTrue);
  });
}
