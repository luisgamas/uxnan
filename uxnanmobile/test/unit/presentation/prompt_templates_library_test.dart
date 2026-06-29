import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/prompt_template.dart';
import 'package:uxnan/infrastructure/storage/prompt_templates_store.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';

const _key = 'uxnan.composer.promptTemplates';

ProviderContainer _container(Map<String, Object> initial) {
  SharedPreferences.setMockInitialValues(initial);
  final store =
      PromptTemplatesStore(preferences: SharedPreferences.getInstance());
  final container = ProviderContainer(
    overrides: [promptTemplatesStoreProvider.overrideWithValue(store)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('hydrates the stored templates without re-seeding', () async {
    final container = _container({
      _key: jsonEncode([
        {'id': 'a', 'label': 'A', 'body': 'body a'},
      ]),
    });
    // build() seeds an empty initial; hydrate then fills it asynchronously.
    expect(container.read(promptTemplatesLibraryProvider), isEmpty);
    await pumpEventQueue();
    expect(
      container.read(promptTemplatesLibraryProvider).map((t) => t.id),
      ['a'],
    );
  });

  test('seeds the localized defaults on a fresh install', () async {
    final container = _container({});
    final store = container.read(promptTemplatesStoreProvider);
    // build() seeds an empty initial; hydrate then seeds the defaults.
    expect(container.read(promptTemplatesLibraryProvider), isEmpty);
    await pumpEventQueue();
    const seeded = <String>['explain', 'review', 'fix', 'tests'];
    expect(
      container.read(promptTemplatesLibraryProvider).map((t) => t.id),
      containsAll(seeded),
    );
    // …and persisted them so a follow-up read is stable.
    final persisted = await store.readTemplates();
    expect(persisted!.map((t) => t.id), containsAll(seeded));
  });

  test('add / update / remove mutate state and persist', () async {
    final container = _container({});
    final notifier = container.read(promptTemplatesLibraryProvider.notifier);
    final store = container.read(promptTemplatesStoreProvider);

    // A mutation before hydrate finishes wins (and suppresses the seed).
    await notifier.add(const PromptTemplate(id: 'x', label: 'X', body: 'bx'));
    expect(container.read(promptTemplatesLibraryProvider).single.id, 'x');

    await notifier
        .update(const PromptTemplate(id: 'x', label: 'X2', body: 'bx2'));
    expect(container.read(promptTemplatesLibraryProvider).single.label, 'X2');
    expect((await store.readTemplates())!.single.body, 'bx2');

    final removed = await notifier.remove('x');
    expect(removed, isTrue);
    expect(container.read(promptTemplatesLibraryProvider), isEmpty);
    expect(await store.readTemplates(), isEmpty);

    expect(await notifier.remove('nope'), isFalse);
  });

  test('resetToDefaults restores the shipped defaults', () async {
    final container = _container({
      _key: jsonEncode([
        {'id': 'mine', 'label': 'Mine', 'body': 'b'},
      ]),
    });
    final notifier = container.read(promptTemplatesLibraryProvider.notifier);
    await notifier.resetToDefaults();
    expect(
      container.read(promptTemplatesLibraryProvider).map((t) => t.id),
      containsAll(<String>['explain', 'review', 'fix', 'tests']),
    );
  });
}
