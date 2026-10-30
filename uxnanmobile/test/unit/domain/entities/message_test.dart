import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

Message _user(List<MessageContent> contents) => Message(
      id: 'm',
      threadId: 'th',
      turnId: 't',
      role: MessageRole.user,
      contents: contents,
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

void main() {
  const image = ImageContent(mimeType: 'image/png', name: 'a.png');
  const file = AttachedFileContent(
    name: 'notes.md',
    mimeType: 'text/markdown',
    bytes: 3,
  );

  test('attachments are the images and files, in marker order', () {
    final m = _user(const [TextContent('￼ then ￼'), file, image]);
    expect(m.attachments, [file, image]);
    expect(m.text, '￼ then ￼');
  });

  test('wordsText and previewText name each chip where it sat', () {
    final m = _user(
      const [TextContent('in ￼ you see\n\nX, in ￼ Y'), image, file],
    );
    expect(m.wordsText, 'in [a.png] you see\n\nX, in [notes.md] Y');
    expect(m.previewText, 'in [a.png] you see X, in [notes.md] Y');
  });

  test('an attachment-only message previews as its names', () {
    final m = _user(const [TextContent('￼'), image]);
    expect(m.previewText, '[a.png]');
    // One stored before markers: its attachments' own projection.
    expect(_user(const [image, file]).previewText, '[a.png] [notes.md]');
  });
}
