import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/extensions/string_ext.dart';

void main() {
  group('truncateMiddle', () {
    test('keeps a short name whole', () {
      expect('a.png'.truncateMiddle(28), 'a.png');
      expect(''.truncateMiddle(4), '');
    });

    test('keeps the start and the end — the extension — of a long one', () {
      expect(
        'quarterly-report-final-version-2026.pdf'.truncateMiddle(28),
        'quarterly-repo…sion-2026.pdf',
      );
      expect('abcdefghij'.truncateMiddle(7), 'abc…hij');
      expect('abcdefghij'.truncateMiddle(7).runes.length, 7);
    });

    test('never cuts a character in two', () {
      final cut = '🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂.png'.truncateMiddle(8);
      expect(cut.runes.length, 8);
      expect(cut.endsWith('png'), isTrue);
    });

    test('falls back to cutting the end when there is no room for both', () {
      expect('abcdef'.truncateMiddle(2), 'ab…');
    });
  });
}
