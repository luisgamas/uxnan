import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/settings/theme_manager_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// User-selectable theme mode (System / Light / Dark).
///
/// The three modes drive [MaterialApp.themeMode] for the brand baseline and
/// for a **dual** custom theme (letting the user flip which side shows). For a
/// **single**-brightness custom theme the brightness is forced and the picker
/// is disabled (see [themePickerEnabledProvider]).
enum ThemeModeOption {
  /// Follow the device setting.
  system,

  /// Always light.
  light,

  /// Always dark.
  dark,
}

/// Maps [option] to the [ThemeMode] the host `MaterialApp` should use.
ThemeMode _toMaterialThemeMode(ThemeModeOption option) => switch (option) {
      ThemeModeOption.system => ThemeMode.system,
      ThemeModeOption.light => ThemeMode.light,
      ThemeModeOption.dark => ThemeMode.dark,
    };

/// Maps the active [ThemeMode] to the matching [ThemeModeOption].
ThemeModeOption _toOption(ThemeMode mode) => switch (mode) {
      ThemeMode.system => ThemeModeOption.system,
      ThemeMode.light => ThemeModeOption.light,
      ThemeMode.dark => ThemeModeOption.dark,
    };

/// Appearance & language settings: theme mode (system/light/dark), the master
/// switch for custom themes + an entry to the full [ThemeManagerScreen], and
/// the app language. The custom-themes library (grid, create, import/export,
/// bulk actions) lives in its own screen so this one stays compact.
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
              _ThemeModeOptionSelector(
                // Enabled for the brand baseline and for DUAL custom themes
                // (so the user can flip which side shows); disabled only for a
                // single-brightness custom theme, whose brightness is forced.
                option: _toOption(themeMode),
                disabled: !ref.watch(themePickerEnabledProvider),
                onChanged: (next) => ref
                    .read(themeModeSettingProvider.notifier)
                    .set(_toMaterialThemeMode(next)),
              ),
              const SizedBox(height: UxnanSpacing.md),
              const _CustomThemeCard(),
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

/// The 3-option segmented button (System / Light / Dark). Disabled when a
/// single-brightness custom theme forces the brightness.
class _ThemeModeOptionSelector extends StatelessWidget {
  const _ThemeModeOptionSelector({
    required this.option,
    required this.disabled,
    required this.onChanged,
  });

  final ThemeModeOption option;
  final bool disabled;
  final ValueChanged<ThemeModeOption> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<ThemeModeOption>(
        showSelectedIcon: false,
        segments: [
          ButtonSegment(
            value: ThemeModeOption.system,
            icon: const Icon(Icons.brightness_auto_outlined),
            label: Text(l10n.themeSystem),
          ),
          ButtonSegment(
            value: ThemeModeOption.light,
            icon: const Icon(Icons.light_mode_outlined),
            label: Text(l10n.themeLight),
          ),
          ButtonSegment(
            value: ThemeModeOption.dark,
            icon: const Icon(Icons.dark_mode_outlined),
            label: Text(l10n.themeDark),
          ),
        ],
        selected: {option},
        onSelectionChanged:
            disabled ? null : (selection) => onChanged(selection.first),
      ),
    );
  }
}

/// The custom-theme card: a master switch plus an entry to the full theme
/// manager (which owns the library grid, create, import/export and bulk
/// actions). When a theme is active its name + a mini palette preview show
/// inline so the current choice is visible without opening the manager.
class _CustomThemeCard extends ConsumerWidget {
  const _CustomThemeCard();

  Future<void> _onToggle(WidgetRef ref, {required bool next}) async {
    await ref.read(useCustomThemeProvider.notifier).set(value: next);
    // Turning the switch on with nothing selected yet → activate the first
    // library theme so the change is immediately visible (the user can pick a
    // different one in the manager).
    if (next && ref.read(activeCustomThemeIdProvider) == null) {
      final library = ref.read(customThemesLibraryProvider);
      if (library.isNotEmpty) {
        await ref
            .read(activeCustomThemeIdProvider.notifier)
            .set(library.first.id);
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final useCustom = ref.watch(useCustomThemeProvider);
    final library = ref.watch(customThemesLibraryProvider);
    final activeId = ref.watch(activeCustomThemeIdProvider);
    CustomTheme? active;
    if (useCustom) {
      for (final theme in library) {
        if (theme.id == activeId) {
          active = theme;
          break;
        }
      }
    }

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SwitchListTile.adaptive(
            value: useCustom,
            onChanged: (next) => _onToggle(ref, next: next),
            title: Text(l10n.personalizationUseCustomThemeLabel),
            subtitle: Text(l10n.personalizationUseCustomThemeSubtitle),
            secondary: Icon(
              Icons.palette_outlined,
              color: colors.onSurfaceVariant,
            ),
          ),
          Divider(height: 1, color: colors.outlineVariant),
          ListTile(
            leading: Icon(
              Icons.collections_bookmark_outlined,
              color: colors.onSurfaceVariant,
            ),
            title: Text(l10n.personalizationCustomThemesHeader),
            subtitle: Text(
              active != null
                  ? active.name
                  : l10n.personalizationManageThemesSubtitle(library.length),
            ),
            trailing: active != null
                ? _MiniPalette(theme: active)
                : Icon(
                    Icons.chevron_right_rounded,
                    color: colors.onSurfaceVariant,
                  ),
            onTap: () => ThemeManagerScreen.push(context),
          ),
        ],
      ),
    );
  }
}

/// A compact 4-dot palette preview (light primary/surface + dark
/// primary/surface) shown next to the active theme name.
class _MiniPalette extends StatelessWidget {
  const _MiniPalette({required this.theme});

  final CustomTheme theme;

  @override
  Widget build(BuildContext context) {
    final outline = Theme.of(context).colorScheme.outline;
    final light = theme.lightColors;
    final dark = theme.darkColors;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _Dot(color: light.primary, outline: outline),
        _Dot(color: light.surface, outline: outline),
        _Dot(color: dark.primary, outline: outline),
        _Dot(color: dark.surface, outline: outline),
      ],
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.color, required this.outline});

  final Color color;
  final Color outline;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: UxnanSpacing.xs),
      child: Container(
        width: 14,
        height: 14,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(color: outline.withValues(alpha: 0.5)),
        ),
      ),
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

/// The native display name for a supported [locale]. Known languages get their
/// endonym; an unmapped locale falls back to its language code.
String _languageName(Locale locale) {
  const names = <String, String>{
    'en': 'English',
    'es': 'Español',
  };
  return names[locale.languageCode] ?? locale.languageCode.toUpperCase();
}
