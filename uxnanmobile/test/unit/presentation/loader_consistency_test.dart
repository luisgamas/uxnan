import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Guards the app's one loading language: every *indeterminate* spinner is the
/// shared `PolygonLoader` (the M3 Expressive shape morph), and the only
/// `CircularProgressIndicator`s left are the two that draw a **known value** —
/// which `PolygonLoader` cannot do, being indeterminate by design.
///
/// This is a source scan rather than a widget test on purpose: the thing worth
/// protecting is the *absence* of stray spinners across ~40 screens, which no
/// single pumped widget can observe. It also stops a future well-meaning sweep
/// from converting the two gauges and silently throwing away the numbers they
/// report.
void main() {
  /// The only call sites allowed to keep a `CircularProgressIndicator`, each
  /// because it renders a real fraction the user reads.
  const determinateGauges = <String, String>{
    'lib/presentation/screens/conversation/conversation_screen.dart':
        'context-usage ring (percent of the model window used)',
    'lib/presentation/screens/settings/sections/updates_section_screen.dart':
        'APK download progress (fraction downloaded)',
  };

  test('every indeterminate spinner is the shared PolygonLoader', () {
    final offenders = <String>[];

    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final path = entity.path.replaceAll(r'\', '/');
      if (determinateGauges.containsKey(path)) continue;

      final lines = entity.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        // Skip the prose in comments that names the widget.
        if (line.trimLeft().startsWith('//')) continue;
        if (line.contains('CircularProgressIndicator')) {
          offenders.add('$path:${i + 1}');
        }
      }
    }

    expect(
      offenders,
      isEmpty,
      reason: 'Use PolygonLoader for indeterminate loading. If a new site '
          'truly reports a known value, add it to `determinateGauges` with '
          'the reason.',
    );
  });

  test('the determinate gauges still report a value', () {
    determinateGauges.forEach((path, why) {
      final source = File(path).readAsStringSync();
      expect(
        source.contains('CircularProgressIndicator'),
        isTrue,
        reason:
            '$path no longer has the gauge it is exempted for ($why) — drop '
            'it from `determinateGauges` if the gauge is genuinely gone.',
      );
      expect(
        RegExp(r'value:\s').hasMatch(source),
        isTrue,
        reason:
            '$path is exempted as a gauge ($why) but passes no `value:`. An '
            'indeterminate spinner belongs in PolygonLoader.',
      );
    });
  });
}
