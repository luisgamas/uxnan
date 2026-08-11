import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// A screen reached by `/thing/:id` must be a DIFFERENT screen for a different
/// `id`.
///
/// That sounds automatic and is not. go_router derives a page's key from the
/// route **pattern** — `pageKey: ValueKey(newMatchedPath)`, where
/// `newMatchedPath` is `/thing/:id` — so every id produces the same page. Going
/// from one to another hands Flutter a page it considers identical, the element
/// is reused, and `initState` never runs again.
///
/// It stayed invisible while every screen was pushed (a phone). Beside a
/// permanent drawer, opening REPLACES the pane, and the conversation screen
/// kept rendering the thread you had left while its app bar showed the one you
/// picked — with the ThreadManager never told to switch, so streaming deltas
/// went on being attributed to the old thread.
void main() {
  /// Counts how many times a screen's `State` was created.
  var creations = <String>[];

  Widget app({required bool keyed}) {
    creations = [];
    final router = GoRouter(
      initialLocation: '/thing/a',
      routes: [
        GoRoute(
          path: '/thing/:id',
          builder: (context, state) {
            final id = state.pathParameters['id']!;
            return _Probe(
              key: keyed ? ValueKey(id) : null,
              id: id,
              onInit: creations.add,
            );
          },
        ),
      ],
    );
    return MaterialApp.router(routerConfig: router);
  }

  testWidgets('REGRESSION: an unkeyed screen is reused across parameters',
      (tester) async {
    await tester.pumpWidget(app(keyed: false));
    await tester.pumpAndSettle();
    expect(creations, ['a']);

    GoRouter.of(tester.element(find.byType(_Probe))).go('/thing/b');
    await tester.pumpAndSettle();

    // The widget updated — the body of a real screen reads this and looks
    // right — but the State behind it never restarted.
    expect(tester.widget<_Probe>(find.byType(_Probe)).id, 'b');
    expect(
      creations,
      ['a'],
      reason: 'go_router keys pages by PATTERN, so this is the same page',
    );
  });

  testWidgets('a keyed screen restarts for a new parameter', (tester) async {
    await tester.pumpWidget(app(keyed: true));
    await tester.pumpAndSettle();
    expect(creations, ['a']);

    GoRouter.of(tester.element(find.byType(_Probe))).go('/thing/b');
    await tester.pumpAndSettle();

    expect(tester.widget<_Probe>(find.byType(_Probe)).id, 'b');
    expect(
      creations,
      ['a', 'b'],
      reason: 'the key must force a fresh element, and a fresh initState',
    );
  });

  test('every parameterised route in the app keys its screen', () {
    // The mechanism above is invisible in review: a route that forgets its key
    // still compiles, still navigates, and only misbehaves once a pane
    // REPLACES instead of pushing — which is a tablet, and only for a screen
    // that keeps per-parameter state.
    //
    // Synchronous on purpose: `testWidgets` runs in a fake-async zone where a
    // real I/O future never completes, and the test simply hangs.
    final source =
        File('lib/presentation/router/app_router.dart').readAsStringSync();

    // Which AppRoutes constants are PATTERNS — resolved from their values, so
    // this keeps working whatever a future one is named.
    final patternNames = RegExp(r"String (\w+) = '([^']*)'")
        .allMatches(source)
        .where((m) => m.group(2)!.contains('/:'))
        .map((m) => m.group(1)!)
        .toSet();
    expect(
      patternNames,
      contains('conversationPattern'),
      reason: 'the constant scan stopped finding the route table',
    );

    // Each `GoRoute(...)` block, split on the `path:` that opens one.
    final blocks = source.split('GoRoute(').skip(1);
    final parameterised = blocks.where(
      (b) => patternNames.any((n) => b.contains('AppRoutes.$n')),
    );
    expect(
      parameterised.length,
      patternNames.length,
      reason: 'every pattern constant should have exactly one route',
    );

    for (final route in parameterised) {
      expect(
        route,
        contains('key: ValueKey(state.pathParameters['),
        reason: 'a parameterised route without a key reuses its screen — see '
            'the REGRESSION test above for what that looks like:\n'
            '${route.split('\n').take(4).join('\n')}',
      );
    }
  });
}

/// A screen that records every `State` creation under its id.
class _Probe extends StatefulWidget {
  const _Probe({required this.id, required this.onInit, super.key});

  final String id;
  final void Function(String id) onInit;

  @override
  State<_Probe> createState() => _ProbeState();
}

class _ProbeState extends State<_Probe> {
  @override
  void initState() {
    super.initState();
    widget.onInit(widget.id);
  }

  @override
  Widget build(BuildContext context) => Scaffold(body: Text(widget.id));
}
