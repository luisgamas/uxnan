import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/turn_timeline_snapshot.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// A conversation reads its OWN timeline, never "whatever is in front".
///
/// The thread manager shows one conversation. A conversation left underneath
/// another — a notification's, a fork — used to render the other's messages
/// under its own title once you went back to it.
void main() {
  ProviderContainer containerShowing(String threadId) {
    final c = ProviderContainer(
      overrides: [
        activeTimelineProvider.overrideWith(
          (ref) => Stream.value(TurnTimelineSnapshot(threadId: threadId)),
        ),
      ],
    );
    addTearDown(c.dispose);
    return c;
  }

  test('the conversation in front gets its timeline', () async {
    final c = containerShowing('b')
      ..listen(threadTimelineProvider('b'), (_, __) {});
    await Future<void>.delayed(Duration.zero);
    expect(c.read(threadTimelineProvider('b')).value?.threadId, 'b');
  });

  test('any other conversation waits instead of showing it', () async {
    final c = containerShowing('b')
      ..listen(threadTimelineProvider('a'), (_, __) {});
    await Future<void>.delayed(Duration.zero);
    final timeline = c.read(threadTimelineProvider('a'));
    expect(timeline.isLoading, isTrue);
    expect(timeline.value, isNull);
    expect(c.read(railAnchorsProvider('a')).tickForId, isEmpty);
  });
}
