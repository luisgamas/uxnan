import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_text_controller.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/attachment_chip.dart';

const _m = '￼';

ImageContent _image(String name) =>
    ImageContent(mimeType: 'image/png', name: name, base64Data: 'AAAA');

const _file = AttachedFileContent(
  name: 'notes.md',
  mimeType: 'text/markdown',
  bytes: 3,
  base64Data: 'AAEC',
);

/// What a keyboard does: the text and the caret it leaves.
void _type(ComposerTextController c, String text, int caret) {
  c.value = TextEditingValue(
    text: text,
    selection: TextSelection.collapsed(offset: caret),
  );
}

List<String?> _names(ComposerTextController c) =>
    [for (final a in c.attachments) a.name];

void main() {
  group('insertAttachments', () {
    test('writes chips at the caret, set apart by spaces', () {
      final c = ComposerTextController(text: 'in this image you see X');
      addTearDown(c.dispose);
      c
        ..selection = const TextSelection.collapsed(offset: 13)
        ..insertAttachments([_image('a.png'), _file]);

      expect(c.text, 'in this image $_m $_m you see X');
      expect(_names(c), ['a.png', 'notes.md']);
      expect(c.selection, const TextSelection.collapsed(offset: 17));
      expect(c.imageCount, 1);
      expect(c.fileCount, 1);
    });

    test('goes at the end before the field was ever focused', () {
      final c = ComposerTextController(text: 'look');
      addTearDown(c.dispose);
      c.insertAttachments([_image('a.png')]);
      expect(c.text, 'look $_m ');
    });

    test('keeps the order of chips already in the text', () {
      final c = ComposerTextController(text: 'first second');
      addTearDown(c.dispose);
      c
        ..selection = const TextSelection.collapsed(offset: 12)
        ..insertAttachments([_image('b.png')])
        ..selection = const TextSelection.collapsed(offset: 5)
        ..insertAttachments([_image('a.png')]);

      expect(c.text, 'first $_m second $_m ');
      expect(_names(c), ['a.png', 'b.png']);
    });

    test('replaces a selection, and the chips inside it', () {
      final c = ComposerTextController(text: 'x');
      addTearDown(c.dispose);
      c
        ..insertAttachments([_image('old.png')])
        ..selection = TextSelection(baseOffset: 0, extentOffset: c.text.length)
        ..insertAttachments([_image('new.png')]);
      expect(c.text, '$_m ');
      expect(_names(c), ['new.png']);
    });

    test('names an image that has none image-<n>', () {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c.insertAttachments([
        const ImageContent(mimeType: 'image/png', base64Data: 'AA'),
        const ImageContent(mimeType: 'image/jpeg', base64Data: 'BB'),
      ]);
      expect(_names(c), ['image-1.png', 'image-2.jpg']);
    });
  });

  group('editing', () {
    test('one backspace after a chip removes it and its attachment', () {
      final c = ComposerTextController(text: 'a ');
      addTearDown(c.dispose);
      c.insertAttachments([_image('a.png')]);
      expect(c.text, 'a $_m ');
      // Backspace with the caret right after the chip.
      _type(c, 'a  ', 2);
      expect(c.attachments, isEmpty);
      expect(c.text, 'a  ');
    });

    test('between two chips, backspace takes the one before the caret', () {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c
        ..setContents('a$_m${_m}b', [_image('first.png'), _image('second.png')])
        ..selection = const TextSelection.collapsed(offset: 2);
      // "a⟨1⟩|⟨2⟩b" → backspace → "a|⟨2⟩b".
      _type(c, 'a${_m}b', 1);
      expect(_names(c), ['second.png']);
    });

    test('forward delete before two chips takes the one after the caret', () {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c
        ..setContents('a$_m${_m}b', [_image('first.png'), _image('second.png')])
        ..selection = const TextSelection.collapsed(offset: 1);
      _type(c, 'a${_m}b', 1);
      expect(_names(c), ['second.png']);
    });

    test('typing around chips keeps them', () {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c.setContents('$_m and $_m', [_image('a.png'), _file]);
      _type(c, 'see $_m and $_m', 4);
      _type(c, 'see $_m and $_m too', 'see $_m and $_m too'.length);
      expect(_names(c), ['a.png', 'notes.md']);
    });

    test('deleting a range drops every chip inside it', () {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c.setContents('1 $_m 2 $_m 3 $_m', [_image('a'), _image('b'), _file]);
      // Select "⟨a⟩ 2 ⟨b⟩" and delete it.
      _type(c, '1  3 $_m', 2);
      expect(_names(c), ['notes.md']);
    });

    test('a marker that arrives in typed or pasted text is stripped', () {
      final c = ComposerTextController(text: 'x');
      addTearDown(c.dispose);
      c.insertAttachments([_image('a.png')]);
      // Pasting text copied from a composer with chips brings markers
      // without attachments.
      _type(c, 'x $_m pasted $_m$_m ', 'x $_m pasted $_m$_m '.length);
      expect(c.text, 'x $_m pasted  ');
      expect(_names(c), ['a.png']);
      expect(c.selection.baseOffset, c.text.length);
    });

    test('a seeded text never brings chips', () {
      final c = ComposerTextController(text: 'a $_m b');
      addTearDown(c.dispose);
      expect(c.text, 'a  b');
    });

    test('clear() takes every chip with the text', () {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c
        ..setContents(_m, [_image('a.png')])
        ..clear();
      expect(c.attachments, isEmpty);
      expect(c.hasAttachments, isFalse);
    });
  });

  group('removeAttachmentAt', () {
    test('removes the chip and the space it leaves doubled', () {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c
        ..setContents('a $_m b $_m', [_image('x.png'), _file])
        ..removeAttachmentAt(0);
      expect(c.text, 'a b $_m');
      expect(_names(c), ['notes.md']);
      c.removeAttachmentAt(0);
      expect(c.text, 'a b');
      expect(c.attachments, isEmpty);
    });

    test('ignores an index it does not hold', () {
      final c = ComposerTextController(text: 'a');
      addTearDown(c.dispose);
      c.removeAttachmentAt(3);
      expect(c.text, 'a');
    });
  });

  test('setContents fits the text to its attachments', () {
    final c = ComposerTextController();
    addTearDown(c.dispose);
    c.setContents('gone $_m and $_m', [_image('kept.png')]);
    expect(c.text, 'gone $_m and ');
    expect(c.markerOffset(0), 5);
    expect(c.markerOffset(1), -1);
    expect(c.selection, TextSelection.collapsed(offset: c.text.length));
  });

  group('buildTextSpan', () {
    Future<TextSpan> build(
      WidgetTester tester,
      ComposerTextController c, {
      bool composing = false,
    }) async {
      late TextSpan span;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              span = c.buildTextSpan(
                context: context,
                withComposing: composing,
              );
              return const SizedBox();
            },
          ),
        ),
      );
      return span;
    }

    testWidgets('draws one chip per marker, in order', (tester) async {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c.setContents('in $_m and $_m', [_image('a.png'), _file]);
      final span = await build(tester, c);
      final chips = span.children!
          .whereType<WidgetSpan>()
          .map((w) => (w.child as Padding).child! as AttachmentChip)
          .toList();
      final names = [for (final chip in chips) chip.attachment.name];
      expect(names, ['a.png', 'notes.md']);
      // A chip is exactly one character of the text.
      expect(span.toPlainText(), c.text);
    });

    testWidgets('renders @ mentions as monospace code-style spans',
        (tester) async {
      final c =
          ComposerTextController(text: 'see @lib/main.dart now mail@host');
      addTearDown(c.dispose);
      final children = (await build(tester, c)).children!.cast<TextSpan>();
      final mention = children.firstWhere((s) => s.text == '@lib/main.dart');
      expect(mention.style?.fontFamily, UxnanTypography.monoFontFamily);
      final plain = children.firstWhere((s) => s.text == 'see ');
      expect(plain.style?.fontFamily, isNot(UxnanTypography.monoFontFamily));
      expect(
        children.any(
          (s) =>
              (s.text?.contains('mail@host') ?? false) &&
              s.style?.fontFamily == UxnanTypography.monoFontFamily,
        ),
        isFalse,
      );
    });

    testWidgets('plain text without a mention yields a single span',
        (tester) async {
      final c = ComposerTextController(text: 'just a message');
      addTearDown(c.dispose);
      final span = await build(tester, c);
      expect(span.children, isNull);
      expect(span.text, 'just a message');
    });

    testWidgets('underlines what an IME is composing, chips still drawn',
        (tester) async {
      final c = ComposerTextController();
      addTearDown(c.dispose);
      c
        ..setContents('$_m nihon', [_image('a.png')])
        ..value = c.value.copyWith(
          composing: const TextRange(start: 2, end: 7),
        );
      final span = await build(tester, c, composing: true);
      expect(span.children!.whereType<WidgetSpan>(), hasLength(1));
      final composed = span.children!
          .whereType<TextSpan>()
          .firstWhere((s) => s.text == 'nihon');
      expect(composed.style?.decoration, TextDecoration.underline);
      expect(span.toPlainText(), c.text);
    });
  });
}
