import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/providers/conversation_auto_follow_policy.dart';

void main() {
  test('follows streaming content until the user starts dragging', () {
    final policy = ConversationAutoFollowPolicy();

    expect(policy.shouldFollow, isTrue);
    policy.beginUserScroll();

    expect(policy.shouldFollow, isFalse);
    expect(policy.isDetached, isTrue);
  });

  test('stays detached when a manual scroll ends away from the bottom', () {
    final policy = ConversationAutoFollowPolicy()
      ..beginUserScroll()
      ..endUserScroll(nearBottom: false);

    expect(policy.shouldFollow, isFalse);
  });

  test('resumes when a manual scroll settles near the bottom', () {
    final policy = ConversationAutoFollowPolicy()
      ..beginUserScroll()
      ..endUserScroll(nearBottom: true);

    expect(policy.shouldFollow, isTrue);
  });

  test(
      'resume overrides an in-progress drag/fling (jump-to-latest always '
      'follows)', () {
    final policy = ConversationAutoFollowPolicy()..beginUserScroll();
    expect(policy.shouldFollow, isFalse);

    // Tapping "jump to latest" mid-fling (before the scroll settled) must
    // resume following instead of being swallowed by the drag state.
    policy.resume();
    expect(policy.shouldFollow, isTrue);
  });

  test('explicit resume and saved bottom state restore following', () {
    final policy = ConversationAutoFollowPolicy()
      ..restore(atBottom: false)
      ..resume();

    expect(policy.shouldFollow, isTrue);

    final restored = ConversationAutoFollowPolicy()..restore(atBottom: true);
    expect(restored.shouldFollow, isTrue);
  });
}
