import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';

void main() {
  group('Uint8ListExt', () {
    test('toHex encodes bytes as lowercase hex', () {
      final bytes = Uint8List.fromList([0x00, 0x0f, 0xff, 0xa0]);
      expect(bytes.toHex(), '000fffa0');
    });

    test('hex round-trips through fromHex', () {
      final bytes = Uint8List.fromList([1, 2, 3, 250, 128, 0]);
      expect(bytes.toHex().fromHex(), bytes);
    });

    test('base64 round-trips through fromBase64', () {
      final bytes =
          Uint8List.fromList(List<int>.generate(32, (i) => i * 7 % 256));
      expect(bytes.toBase64().fromBase64(), bytes);
    });
  });
}
