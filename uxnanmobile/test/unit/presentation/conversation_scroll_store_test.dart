import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/providers/conversation_scroll_store.dart';

void main() {
  test('positionFor returns null until a position is saved', () {
    final store = ConversationScrollStore();
    expect(store.positionFor('t1'), isNull);
  });

  test('save then positionFor round-trips the offset + atBottom flag', () {
    final store = ConversationScrollStore()
      ..save('t1', offset: 240.5, atBottom: false)
      ..save('t2', offset: 0, atBottom: true);

    expect(store.positionFor('t1'), (offset: 240.5, atBottom: false));
    expect(store.positionFor('t2'), (offset: 0.0, atBottom: true));
    // Unknown thread stays null.
    expect(store.positionFor('t3'), isNull);
  });

  test('save overwrites the previous position for a thread', () {
    final store = ConversationScrollStore()
      ..save('t1', offset: 100, atBottom: false)
      ..save('t1', offset: 999, atBottom: true);
    expect(store.positionFor('t1'), (offset: 999.0, atBottom: true));
  });
}
