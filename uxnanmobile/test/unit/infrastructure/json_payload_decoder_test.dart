import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/transport/json_payload_decoder.dart';

Uint8List _bytes(Object json) =>
    Uint8List.fromList(utf8.encode(jsonEncode(json)));

void main() {
  test('decodes a small payload in place', () async {
    var background = 0;
    final decoder = JsonPayloadDecoder(
      isolateThreshold: 1024,
      runInBackground: (work) async {
        background++;
        return work();
      },
    );
    expect(await decoder.decodeObject(_bytes({'a': 1})), {'a': 1});
    expect(background, 0);
  });

  test('decodes a large payload off the calling isolate', () async {
    var background = 0;
    final decoder = JsonPayloadDecoder(
      isolateThreshold: 16,
      runInBackground: (work) async {
        background++;
        return work();
      },
    );
    final big = {'text': 'x' * 100};
    expect(await decoder.decodeObject(_bytes(big)), big);
    expect(background, 1);
  });

  test('really runs on a background isolate by default', () async {
    const decoder = JsonPayloadDecoder(isolateThreshold: 8);
    final page = {
      'turns': [
        for (var i = 0; i < 50; i++) {'id': 't$i', 'content': 'é' * 50},
      ],
    };
    expect(await decoder.decodeObject(_bytes(page)), page);
  });

  test('refuses anything that is not a JSON object', () async {
    const decoder = JsonPayloadDecoder();
    await expectLater(
      decoder.decodeObject(_bytes([1, 2])),
      throwsFormatException,
    );
    await expectLater(
      decoder.decodeObject(Uint8List.fromList([0xff])),
      throwsFormatException,
    );
  });
}
