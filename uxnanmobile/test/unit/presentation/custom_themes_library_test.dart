import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// Lets the library notifier's async hydrate (SharedPreferences read +
/// reconcile + writeback) settle.
Future<void> _settle() async {
  for (var i = 0; i < 5; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a stale built-in with a broken dark side is healed from code on load',
      () async {
    // Simulate an old build's persisted Midnight: a LIGHT scheme in the dark
    // slot (the pre-fix bug — the "dark" side is actually bright).
    final broken = CustomTheme.fromDualSchemes(
      id: 'uxnan.builtin.midnight',
      name: 'Midnight (stale)',
      light: ColorScheme.fromSeed(seedColor: const Color(0xFF4A3FB8)),
      // A LIGHT scheme deliberately placed in the dark slot.
      dark: ColorScheme.fromSeed(seedColor: const Color(0xFF4A3FB8)),
    );
    // Sanity: the stale entry's dark side is indeed bright (broken).
    expect(broken.darkColors.surface.computeLuminance(), greaterThan(0.5));

    SharedPreferences.setMockInitialValues({
      'uxnan.appearance.customThemes': '[${broken.toJsonString()}]',
    });

    final container = ProviderContainer();
    addTearDown(container.dispose);
    // Trigger build() + async hydrate.
    container.read(customThemesLibraryProvider);
    await _settle();

    final library = container.read(customThemesLibraryProvider);
    final midnight =
        library.firstWhere((t) => t.id == 'uxnan.builtin.midnight');
    // Reconciled to the shipped definition: name restored + dark truly dark.
    expect(midnight.name, 'Midnight');
    expect(midnight.darkColors.surface.computeLuminance(), lessThan(0.5));
    // The other shipped built-in is present too.
    expect(
      library.any((t) => t.id == 'uxnan.builtin.sandstone'),
      isTrue,
    );
  });

  test('user-authored themes survive built-in reconciliation', () async {
    final mine = CustomTheme.fromDualSchemes(
      id: 'mine',
      name: 'Mine',
      light: ColorScheme.fromSeed(seedColor: const Color(0xFF1B6EF3)),
      dark: ColorScheme.fromSeed(
        seedColor: const Color(0xFF1B6EF3),
        brightness: Brightness.dark,
      ),
    );
    SharedPreferences.setMockInitialValues({
      'uxnan.appearance.customThemes': '[${mine.toJsonString()}]',
    });

    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(customThemesLibraryProvider);
    await _settle();

    final library = container.read(customThemesLibraryProvider);
    // The user's theme is preserved, and the shipped built-ins are appended.
    expect(library.any((t) => t.id == 'mine'), isTrue);
    expect(library.any((t) => t.id == 'uxnan.builtin.midnight'), isTrue);
    expect(library.any((t) => t.id == 'uxnan.builtin.sandstone'), isTrue);
  });
}
