import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/conversation/composer/mention_text_controller.dart';
import 'package:uxnan/presentation/theme/typography.dart';

void main() {
  testWidgets('renders @ mentions as monospace code-style spans',
      (tester) async {
    final controller =
        MentionTextController(text: 'see @lib/main.dart now mail@host');
    addTearDown(controller.dispose);

    late TextSpan span;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            span = controller.buildTextSpan(
              context: context,
              withComposing: false,
            );
            return const SizedBox();
          },
        ),
      ),
    );

    final children = span.children!.cast<TextSpan>();

    // The mention is its own span, in the monospace family.
    final mention = children.firstWhere((s) => s.text == '@lib/main.dart');
    expect(mention.style?.fontFamily, UxnanTypography.monoFontFamily);

    // Plain text segments are not styled as code.
    final plain = children.firstWhere((s) => s.text == 'see ');
    expect(plain.style?.fontFamily, isNot(UxnanTypography.monoFontFamily));

    // `mail@host` is not a mention (the @ isn't at a word boundary), so the
    // tail stays a single un-styled run.
    expect(
      children.any(
        (s) =>
            s.text != null &&
            s.text!.contains('mail@host') &&
            s.style?.fontFamily == UxnanTypography.monoFontFamily,
      ),
      isFalse,
    );
  });

  testWidgets('plain text without a mention yields a single span',
      (tester) async {
    final controller = MentionTextController(text: 'just a message');
    addTearDown(controller.dispose);

    late TextSpan span;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            span = controller.buildTextSpan(
              context: context,
              withComposing: false,
            );
            return const SizedBox();
          },
        ),
      ),
    );

    expect(span.children, isNull);
    expect(span.text, 'just a message');
  });
}
