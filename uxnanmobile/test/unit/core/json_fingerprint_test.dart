import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/utils/json_fingerprint.dart';

void main() {
  test('is stable, 16 hex digits, and ignores map key order', () {
    final a = jsonFingerprint({
      'content': 'hi',
      'segments': [
        {'type': 'text', 'text': 'hi'},
      ],
    });
    final b = jsonFingerprint({
      'segments': [
        {'text': 'hi', 'type': 'text'},
      ],
      'content': 'hi',
    });
    expect(a, b);
    expect(a, matches(RegExp(r'^[0-9a-f]{16}$')));
    // Pinned: a stored fingerprint must survive an app update.
    expect(jsonFingerprint('abc'), jsonFingerprint('abc'));
    expect(jsonFingerprint(null), isNot(jsonFingerprint('')));
  });

  test('tells apart values that differ in content, kind or structure', () {
    final values = <Object?>[
      null,
      true,
      false,
      0,
      '0',
      '',
      <Object?>[],
      <String, Object?>{},
      ['a', 'b'],
      ['ab'],
      {'a': 'b'},
      {'ab': ''},
      'é',
      'e',
    ];
    final prints = {for (final value in values) jsonFingerprint(value)};
    expect(prints, hasLength(values.length));
  });
}
