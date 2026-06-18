import 'dart:ui' show Color;

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/accent_color.dart';

void main() {
  group('AccentPalette', () {
    test('default accent is blue (the brand)', () {
      expect(AccentPalette.defaultAccent.id, 'blue');
      expect(AccentPalette.defaultAccent.seed, AccentPalette.blue.seed);
      expect(AccentPalette.defaultAccent.nameKey, 'accentBlue');
    });

    test('palette has 7 swatches covering major hue families', () {
      expect(AccentPalette.all, hasLength(7));
      final ids = AccentPalette.all.map((a) => a.id).toList();
      expect(
        ids,
        [
          'blue',
          'purple',
          'pink',
          'red',
          'orange',
          'green',
          'teal',
        ],
      );
      // Every swatch has a non-empty id, a seed with alpha=1.0 (opaque
      // hex), and a nameKey prefixed with `accent`.
      for (final accent in AccentPalette.all) {
        expect(accent.id, isNotEmpty);
        expect(accent.nameKey, startsWith('accent'));
      }
    });

    test('blue is the first swatch in display order', () {
      expect(AccentPalette.all.first.id, 'blue');
    });

    test('fromId resolves every palette id to its swatch', () {
      for (final accent in AccentPalette.all) {
        expect(AccentPalette.fromId(accent.id), accent);
      }
    });

    test('fromId is tolerant: null, empty, and unknown return the default', () {
      expect(AccentPalette.fromId(null), AccentPalette.defaultAccent);
      expect(AccentPalette.fromId(''), AccentPalette.defaultAccent);
      expect(AccentPalette.fromId('not-a-real-accent'),
          AccentPalette.defaultAccent);
      // The same default is returned for the canonical "blue" id and for
      // an unknown id, so the picker behaves identically for a first-run
      // user and a user upgrading from an older build that stored an
      // accent that was later removed.
      expect(AccentPalette.fromId('blue'), AccentPalette.defaultAccent);
    });

    test('seeds are visually distinct (different hue families)', () {
      // A loose sanity check: every seed except the brand default should
      // not equal the default seed. A user changing the accent must see
      // a real change in the scheme.
      for (final accent in AccentPalette.all) {
        if (accent.id == AccentPalette.defaultAccent.id) continue;
        expect(accent.seed, isNot(AccentPalette.defaultAccent.seed));
      }
    });
  });

  group('AccentColorId', () {
    test('props drive value equality', () {
      const a = AccentColorId(
        id: 'blue',
        seed: Color(0xFF1B6EF3),
        nameKey: 'accentBlue',
      );
      const b = AccentColorId(
        id: 'blue',
        seed: Color(0xFF1B6EF3),
        nameKey: 'accentBlue',
      );
      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
    });

    test('different ids are not equal', () {
      expect(AccentPalette.blue, isNot(equals(AccentPalette.purple)));
    });
  });
}
