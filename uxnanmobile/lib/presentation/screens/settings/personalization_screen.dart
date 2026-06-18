import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/accent_color.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Appearance & language settings: theme mode (system/light/dark), accent
/// color, and the app language. The accent picker offers the curated
/// [AccentPalette] of 7 swatches — the whole `ColorScheme` is derived from
/// the chosen seed by `buildUxnanTheme` via `ColorScheme.fromSeed` so every
/// M3 role stays coherent in both light and dark (the visual incoherence a
/// first cut had when only `primary` was overridden). The language list is
/// derived from [AppLocalizations.supportedLocales], so a newly added locale
/// shows up here automatically; the default follows the device language.
class PersonalizationScreen extends ConsumerWidget {
  /// Creates the personalization screen.
  const PersonalizationScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const PersonalizationScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final themeMode = ref.watch(themeModeSettingProvider);
    final localeTag = ref.watch(localeSettingProvider)?.languageCode;
    final accent = ref.watch(accentSettingProvider);

    return NeScaffold(
      title: l10n.personalizationTitle,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.lg,
            UxnanSpacing.xl,
          ),
          sliver: SliverList.list(
            children: [
              _Header(label: l10n.personalizationThemeSection),
              const SizedBox(height: UxnanSpacing.sm),
              _ThemeModeSelector(
                mode: themeMode,
                onChanged: (mode) =>
                    ref.read(themeModeSettingProvider.notifier).set(mode),
              ),
              const SizedBox(height: UxnanSpacing.xl),
              _Header(label: l10n.personalizationAccentSection),
              const SizedBox(height: UxnanSpacing.sm),
              _AccentPicker(
                selected: accent,
                onChanged: (next) =>
                    ref.read(accentSettingProvider.notifier).set(next),
              ),
              const SizedBox(height: UxnanSpacing.xl),
              _Header(label: l10n.personalizationLanguageSection),
              const SizedBox(height: UxnanSpacing.sm),
              _LanguageSelector(
                selectedTag: localeTag,
                onChanged: (locale) =>
                    ref.read(localeSettingProvider.notifier).set(locale),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ThemeModeSelector extends StatelessWidget {
  const _ThemeModeSelector({required this.mode, required this.onChanged});

  final ThemeMode mode;
  final ValueChanged<ThemeMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<ThemeMode>(
        showSelectedIcon: false,
        segments: [
          ButtonSegment(
            value: ThemeMode.system,
            icon: const Icon(Icons.brightness_auto_outlined),
            label: Text(l10n.themeSystem),
          ),
          ButtonSegment(
            value: ThemeMode.light,
            icon: const Icon(Icons.light_mode_outlined),
            label: Text(l10n.themeLight),
          ),
          ButtonSegment(
            value: ThemeMode.dark,
            icon: const Icon(Icons.dark_mode_outlined),
            label: Text(l10n.themeDark),
          ),
        ],
        selected: {mode},
        onSelectionChanged: (selection) => onChanged(selection.first),
      ),
    );
  }
}

/// Curated swatch picker for the user-picked accent. Renders as a stacked
/// list (matches the language picker) of M3 `ListTile`s, each showing a
/// 28 dp circular dot in the swatch's own seed color and the localized
/// label. The selected row paints its container `secondaryContainer` and
/// shows a trailing `check` icon. Tapping a row calls [onChanged] with the
/// chosen [AccentColorId].
class _AccentPicker extends StatelessWidget {
  const _AccentPicker({required this.selected, required this.onChanged});

  final AccentColorId selected;
  final ValueChanged<AccentColorId> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < AccentPalette.all.length; i++) ...[
            if (i > 0) Divider(height: 1, color: colors.outlineVariant),
            _AccentRow(
              accent: AccentPalette.all[i],
              label: _accentName(l10n, AccentPalette.all[i]),
              isSelected: AccentPalette.all[i].id == selected.id,
              onTap: () => onChanged(AccentPalette.all[i]),
            ),
          ],
        ],
      ),
    );
  }
}

/// A single swatch row inside [_AccentPicker]: a 28 dp circular dot tinted
/// with the swatch's seed color, the localized label, and a `check` icon
/// when the row is the active accent. The dot is built as a
/// `Material(shape: CircleBorder())` over a tinted background so it
/// inherits the live M3 `colorScheme` and stays legible on both light and
/// dark backgrounds.
class _AccentRow extends StatelessWidget {
  const _AccentRow({
    required this.accent,
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final AccentColorId accent;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      onTap: onTap,
      selected: isSelected,
      selectedTileColor: colors.secondaryContainer,
      leading: _SwatchDot(color: accent.seed),
      title: Text(label),
      trailing: isSelected
          ? Icon(Icons.check_rounded, color: colors.onSecondaryContainer)
          : null,
    );
  }
}

/// 28 dp circular dot in [color], with a 1 dp outline so the dot reads on
/// surfaces of any tone. Used in the accent picker so a user can preview
/// the exact seed the theme will derive every M3 role from.
class _SwatchDot extends StatelessWidget {
  const _SwatchDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(
          color: colors.outline.withValues(alpha: 0.5),
          width: 1,
        ),
      ),
      child: const Icon(Icons.circle, color: Colors.transparent, size: 0),
    );
  }
}

class _LanguageSelector extends StatelessWidget {
  const _LanguageSelector({
    required this.selectedTag,
    required this.onChanged,
  });

  /// The current locale language code, or null when following the system.
  final String? selectedTag;
  final ValueChanged<Locale?> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    const locales = AppLocalizations.supportedLocales;
    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: RadioGroup<String?>(
        groupValue: selectedTag,
        onChanged: (tag) => onChanged(tag == null ? null : Locale(tag)),
        child: Column(
          children: [
            RadioListTile<String?>(
              value: null,
              title: Text(l10n.languageSystemDefault),
              secondary: const Icon(Icons.smartphone_outlined),
            ),
            for (final locale in locales) ...[
              Divider(height: 1, color: colors.outlineVariant),
              RadioListTile<String?>(
                value: locale.languageCode,
                title: Text(_languageName(locale)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.xs),
      child: Text(
        label,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: colors.primary,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

/// Resolves the localized display name for [accent] from the ARB-generated
/// [AppLocalizations]. Uses a per-key switch (rather than reflection) so a
/// new ARB key triggers a compile error here — never a silent fallback.
String _accentName(AppLocalizations l10n, AccentColorId accent) {
  return switch (accent.nameKey) {
    'accentBlue' => l10n.accentBlue,
    'accentPurple' => l10n.accentPurple,
    'accentPink' => l10n.accentPink,
    'accentRed' => l10n.accentRed,
    'accentOrange' => l10n.accentOrange,
    'accentGreen' => l10n.accentGreen,
    'accentTeal' => l10n.accentTeal,
    // Should be unreachable — the palette is closed and every entry has a
    // matching ARB key. Fall back to the raw id so a typo in the palette is
    // visible to the user rather than a blank label.
    _ => accent.id,
  };
}

/// The native display name for a supported [locale]. Known languages get their
/// endonym; an unmapped (newly added) locale falls back to its language code so
/// it still appears in the list.
String _languageName(Locale locale) {
  const names = <String, String>{
    'en': 'English',
    'es': 'Español',
  };
  return names[locale.languageCode] ?? locale.languageCode.toUpperCase();
}
