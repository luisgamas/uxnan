import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/agent_view.dart';

void main() {
  test('clamps page heights to the shared view range', () {
    expect(clampViewHeight(10), 80);
    expect(clampViewHeight(99999), 1600);
    expect(clampViewHeight(300.6), 301);
    expect(clampViewHeight(double.nan), 320);
  });

  test('validates bounded annotations', () {
    final valid = {
      'selector': 'main > button',
      'tag': 'button',
      'text': 'Save',
      'rect': {'x': 1, 'y': 2, 'width': 3, 'height': 4},
    };
    expect(isViewAnnotation(valid), isTrue);
    expect(isViewAnnotation({...valid, 'selector': ''}), isFalse);
    expect(isViewAnnotation({...valid, 'tag': 'Button<script>'}), isFalse);
    expect(isViewAnnotation({...valid, 'text': 'x' * 501}), isFalse);
    expect(
      isViewAnnotation({
        ...valid,
        'rect': {'x': 1, 'y': 2},
      }),
      isFalse,
    );
    expect(isViewAnnotation(null), isFalse);
    expect(ViewAnnotation.parse(valid)?.toJson(), valid);
  });

  test('formatViewAnnotations matches the shared TypeScript fixture', () {
    const annotation1 = ViewAnnotation(
      selector: '#total',
      tag: 'td',
      text: ' 42\n units ',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    );
    const annotation2 = ViewAnnotation(
      selector: 'svg',
      tag: 'svg',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    );
    expect(
      formatViewAnnotations('Usage', [
        (annotation: annotation1, note: ' should be bold '),
        (annotation: annotation2, note: ''),
      ]),
      [
        'On the view "Usage":',
        '',
        '1. `#total` (<td>)',
        '   Text:  42 units ',
        '   Note: should be bold',
        '',
        '2. `svg` (<svg>)',
      ].join('\n'),
    );
  });

  test('view notes add, replace, edit, delete and discard with numbered marks',
      () {
    const first = ViewAnnotation(
      selector: '#first',
      tag: 'button',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    );
    const second = ViewAnnotation(
      selector: '#second',
      tag: 'p',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    );
    var notes =
        const ViewAnnotationNotes().add(first, 'First').add(second, 'Second');
    expect(notes.items.map((item) => item.note), ['First', 'Second']);
    expect(notes.marks, [
      {'selector': '#first', 'label': '1'},
      {'selector': '#second', 'label': '2'},
    ]);

    notes = notes.edit(0, 'Updated');
    expect(notes.items.first.note, 'Updated');
    notes = notes.delete(0);
    expect(notes.marks, [
      {'selector': '#second', 'label': '1'},
    ]);
    notes = notes.add(second, 'Replaced');
    expect(notes.items, hasLength(1));
    expect(notes.items.single.note, 'Replaced');
    expect(notes.discard().items, isEmpty);
  });
}
