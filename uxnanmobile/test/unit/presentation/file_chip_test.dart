import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/widgets/file_chip.dart';

void main() {
  test('a file reads back from JSON as a file', () {
    const file = AttachedFileContent(
      name: 'people.csv',
      mimeType: 'text/csv',
      bytes: 5,
      attachmentId: 'a-0.csv',
    );
    expect(MessageContent.fromJson(file.toJson()), file);
    expect(file.asPlainText, '[file: people.csv]');
  });

  test('sizes read like people say them', () {
    expect(formatFileSize(980), '980 B');
    expect(formatFileSize(12400), '12 KB');
    expect(formatFileSize((3.4 * 1024 * 1024).round()), '3.4 MB');
    expect(formatFileSize(15 * 1024 * 1024), '15 MB');
  });

  testWidgets('the chip shows the name and size, and removes on ✕',
      (tester) async {
    var removed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FileChip(
            file: const AttachedFileContent(
              name: 'people.csv',
              mimeType: 'text/csv',
              bytes: 5,
            ),
            onRemove: () => removed = true,
          ),
        ),
      ),
    );
    expect(find.text('people.csv'), findsOneWidget);
    expect(find.text('5 B'), findsOneWidget);
    await tester.tap(find.byType(IconButton));
    expect(removed, isTrue);
  });
}
