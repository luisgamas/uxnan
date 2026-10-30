import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/inline_attachments.dart';

/// The phone's copy of the shared contract
/// (`shared/test/inline-attachments.test.ts`): the same cases, the same
/// answers.
void main() {
  const m = kAttachmentMarker;

  test('the marker is U+FFFC, one UTF-16 unit', () {
    expect(m, '￼');
    expect(m.length, 1);
  });

  test('countAttachmentMarkers counts every marker and nothing else', () {
    expect(countAttachmentMarkers(''), 0);
    expect(countAttachmentMarkers('no attachments here'), 0);
    expect(countAttachmentMarkers('in $m and $m$m'), 3);
    expect(countAttachmentMarkers('�​'), 0);
  });

  test('splitAtAttachmentMarkers gives one piece more than markers', () {
    expect(splitAtAttachmentMarkers('plain'), ['plain']);
    expect(splitAtAttachmentMarkers('a $m b $m'), ['a ', ' b ', '']);
    expect(splitAtAttachmentMarkers(m), ['', '']);
  });

  test('stripAttachmentMarkers removes markers and keeps the words', () {
    expect(stripAttachmentMarkers('see ${m}here$m'), 'see here');
    expect(stripAttachmentMarkers('untouched'), 'untouched');
  });

  test('fitAttachmentMarkers drops markers past the count, adds missing ones',
      () {
    expect(fitAttachmentMarkers('a $m b', 1), 'a $m b');
    expect(fitAttachmentMarkers('a $m b $m c', 1), 'a $m b  c');
    expect(fitAttachmentMarkers('a $m', 0), 'a ');
    expect(fitAttachmentMarkers('look', 2), 'look $m$m');
    expect(fitAttachmentMarkers('look ', 1), 'look $m');
    expect(fitAttachmentMarkers('', 1), m);
  });

  test('inlineAttachmentsPlainText names each attachment where it sat', () {
    expect(
      inlineAttachmentsPlainText(
        'in $m you see X, in $m Y',
        ['a.png', 'b.png'],
      ),
      'in [a.png] you see X, in [b.png] Y',
    );
    expect(
      inlineAttachmentsPlainText('$m $m $m', ['x.pdf', '  ']),
      '[x.pdf] [attachment] [attachment]',
    );
    expect(inlineAttachmentsPlainText(m, [], fallback: 'image'), '[image]');
    expect(inlineAttachmentsPlainText('words only', ['ignored']), 'words only');
  });
}
