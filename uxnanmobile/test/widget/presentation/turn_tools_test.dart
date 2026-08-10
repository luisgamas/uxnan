import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/infrastructure/media/attachment_picker_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_context_bar.dart';
import 'package:uxnan/presentation/screens/conversation/composer/turn_control_shelf.dart';
import 'package:uxnan/presentation/screens/conversation/composer/turn_tools_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';
import '../../support/ux_icon_finder.dart';

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

    await tester.tap(findUxIcon(UxIcons.add));
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

    expect(findUxIcon(UxIcons.psychologyAlt), findsOneWidget);
    expect(findUxIcon(UxIcons.lockOpen), findsOneWidget);
    expect(find.text('Reasoning effort: Auto'), findsNothing);
    expect(find.text('Full access'), findsNothing);
    final chevronX =
        tester.getCenter(find.byKey(const ValueKey('turn-controls-toggle'))).dx;
    final reasoningX = tester.getCenter(findUxIcon(UxIcons.psychologyAlt)).dx;
    final approvalX = tester.getCenter(findUxIcon(UxIcons.lockOpen)).dx;
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
      tester.widget<UxIcon>(findUxIcon(UxIcons.psychologyAlt)).size,
      24,
    );

    await tester.tap(findUxIcon(UxIcons.lockOpen));
    expect(approvalTaps, 1);

    await tester.tap(find.byKey(const ValueKey('turn-controls-toggle')));
    await tester.pumpAndSettle();
    expect(findUxIcon(UxIcons.psychologyAlt), findsNothing);
    expect(findUxIcon(UxIcons.lockOpen), findsNothing);
    expect(find.byKey(const ValueKey('turn-controls-toggle')), findsOneWidget);
  });

  testWidgets(
    'expanded turn controls smoothly replace trailing info on a compact phone',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      var expanded = false;
      const options = [
        AgentModelOption(
          key: 'reasoning',
          kind: 'enum',
          label: 'Reasoning effort',
          values: [
            AgentModelOptionValue(value: 'high', label: 'High'),
          ],
        ),
        AgentModelOption(
          key: 'fast',
          kind: 'toggle',
          label: 'Fast mode',
        ),
      ];

      late StateSetter rebuild;
      await tester.pumpWidget(
        _wrap(
          StatefulBuilder(
            builder: (context, setState) {
              rebuild = setState;
              return Align(
                alignment: Alignment.bottomCenter,
                child: ComposerContextBar(
                  controlsExpanded: expanded,
                  controls: TurnControlShelf(
                    threadId: 'thread-1',
                    options: options,
                    showApproval: true,
                    approvalMode: ApprovalMode.requestApproval,
                    expanded: expanded,
                    onExpandedChanged: (value) {
                      expanded = value;
                      rebuild(() {});
                    },
                    onApprovalTap: () {},
                  ),
                  info: const SizedBox(
                    key: ValueKey('trailing-context-info'),
                    width: 132,
                    height: 38,
                    child: Text('+12 −3 · 42%'),
                  ),
                ),
              );
            },
          ),
        ),
      );

      final transition =
          find.byKey(const ValueKey('composer-context-info-transition'));
      expect(tester.getSize(transition).width, 140);
      expect(find.text('+12 −3 · 42%'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('turn-controls-toggle')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      final midWidth = tester.getSize(transition).width;
      expect(midWidth, greaterThan(0));
      expect(midWidth, lessThan(140));
      expect(tester.takeException(), isNull);

      await tester.pumpAndSettle();
      expect(tester.getSize(transition).width, 0);
      expect(findUxIcon(UxIcons.psychologyAlt), findsOneWidget);
      expect(findUxIcon(UxIcons.panTool), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(find.byKey(const ValueKey('turn-controls-toggle')));
      await tester.pumpAndSettle();
      expect(tester.getSize(transition).width, closeTo(140, 0.01));
      expect(find.text('+12 −3 · 42%'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('reduced motion swaps composer context info immediately',
      (tester) async {
    var expanded = false;
    late VoidCallback expand;

    await tester.pumpWidget(
      _wrap(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: StatefulBuilder(
            builder: (context, setState) {
              expand = () => setState(() => expanded = true);
              return ComposerContextBar(
                controlsExpanded: expanded,
                controls: const SizedBox(width: 48, height: 48),
                info: const SizedBox(width: 80, height: 38),
              );
            },
          ),
        ),
      ),
    );

    final transition =
        find.byKey(const ValueKey('composer-context-info-transition'));
    expect(tester.getSize(transition).width, 88);

    expand();
    await tester.pump();
    expect(tester.getSize(transition).width, 0);
  });

  testWidgets('approval icon color communicates the selected safety mode',
      (tester) async {
    const cases = [
      (ApprovalMode.approveForMe, UxIcons.verifiedUser, UxnanColors.success),
      (ApprovalMode.fullAccess, UxIcons.lockOpen, UxnanColors.error),
      (ApprovalMode.requestApproval, UxIcons.panTool, UxnanColors.warning),
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

      expect(tester.widget<UxIcon>(findUxIcon(icon)).color, color);
    }
  });

  testWidgets(
      'reasoning menu drops composer focus so the keyboard gets out '
      'of its way', (tester) async {
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

    await tester.tap(findUxIcon(UxIcons.psychologyAlt));
    await tester.pumpAndSettle();

    expect(find.text('High'), findsOneWidget);
    // The shelf sits directly above the keyboard and the menu is anchored to
    // it, so holding the composer's focus kept the keyboard up and left the
    // menu rendered underneath it, out of reach. Dropping focus is what puts
    // the menu back on screen; the composer's text is untouched.
    expect(focusNode.hasFocus, isFalse);
  });
}
