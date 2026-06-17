import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/notifications/push_notification_service.dart';

void main() {
  group('shouldSuppressForegroundPush', () {
    test('suppresses the conversation currently on screen', () {
      expect(
        shouldSuppressForegroundPush(
          threadId: 'A',
          foregroundThreadId: 'A',
          connected: true,
        ),
        isTrue,
      );
      // Still suppressed on-screen even if (somehow) disconnected.
      expect(
        shouldSuppressForegroundPush(
          threadId: 'A',
          foregroundThreadId: 'A',
          connected: false,
        ),
        isTrue,
      );
    });

    test('suppresses while connected (the live domain-event path notifies)',
        () {
      // A different agent/thread, but connected → the WS path raises it, so the
      // foreground FCM would duplicate → suppress.
      expect(
        shouldSuppressForegroundPush(
          threadId: 'B',
          foregroundThreadId: 'A',
          connected: true,
        ),
        isTrue,
      );
    });

    test('shows a different thread while disconnected (FCM is the only signal)',
        () {
      expect(
        shouldSuppressForegroundPush(
          threadId: 'B',
          foregroundThreadId: 'A',
          connected: false,
        ),
        isFalse,
      );
      // No conversation on screen + disconnected → show.
      expect(
        shouldSuppressForegroundPush(
          threadId: 'B',
          foregroundThreadId: null,
          connected: false,
        ),
        isFalse,
      );
    });
  });
}
