import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/prompt_template.dart';
import 'package:uxnan/infrastructure/storage/prompt_templates_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  PromptTemplatesStore build(Map<String, Object> initial) {
    SharedPreferences.setMockInitialValues(initial);
    return PromptTemplatesStore(preferences: SharedPreferences.getInstance());
  }

  test('readTemplates returns null when the key was never written', () async {
    final store = build({});
    expect(await store.readTemplates(), isNull);
  });

  test('write then read round-trips the list', () async {
    final store = build({});
    const list = [
      PromptTemplate(id: 'a', label: 'A', body: 'body a'),
      PromptTemplate(id: 'b', label: 'B', body: 'body b'),
    ];
    await store.writeTemplates(list);
    expect(await store.readTemplates(), equals(list));
  });

  test('an empty stored list reads as empty (not null)', () async {
    final store = build({});
    await store.writeTemplates(const []);
    final read = await store.readTemplates();
    expect(read, isNotNull);
    expect(read, isEmpty);
  });

  test('malformed JSON degrades to an empty list', () async {
    final store = build({
      'uxnan.composer.promptTemplates': 'not-json',
    });
    expect(await store.readTemplates(), isEmpty);
  });

  test('non-list JSON degrades to an empty list', () async {
    final store = build({
      'uxnan.composer.promptTemplates': jsonEncode({'id': 'x'}),
    });
    expect(await store.readTemplates(), isEmpty);
  });
}
