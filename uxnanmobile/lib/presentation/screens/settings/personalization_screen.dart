import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/settings/theme_manager_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

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

/// Appearance & language settings, in the Neural Expressive settings style
/// (quiet section labels + dynamic-corner card groups): theme mode
/// (system/light/dark) as a Connected Button Group, the custom-themes master
/// switch + an entry to the full [ThemeManagerScreen], and the app language.
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
            UxnanSpacing.xxl,
          ),
          sliver: SliverList.list(
            children: [
              NeSectionHeader(
                label: l10n.personalizationThemeSection,
                first: true,
              ),
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
              const SizedBox(height: UxnanSpacing.sm),
              const _CustomThemeCard(),
              NeSectionHeader(label: l10n.personalizationLanguageSection),
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

/// Theme mode (System / Light / Dark) as a Connected Button Group — the M3E
/// replacement for the segmented button. Dimmed + non-interactive when a
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

    String labelFor(ThemeModeOption o) => switch (o) {
          ThemeModeOption.system => l10n.themeSystem,
          ThemeModeOption.light => l10n.themeLight,
          ThemeModeOption.dark => l10n.themeDark,
        };

    final group = ConnectedButtonGroup<ThemeModeOption>(
      values: const [
        ThemeModeOption.system,
        ThemeModeOption.light,
        ThemeModeOption.dark,
      ],
      selected: option,
      onChanged: onChanged,
      labelBuilder: (value, _) => Text(labelFor(value)),
    );

    if (!disabled) return group;
    return Opacity(
      opacity: 0.5,
      child: IgnorePointer(child: group),
    );
  }
}

/// The custom-theme card group: a master switch plus an entry to the full theme
/// manager. When a theme is active its name + a mini palette preview show
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
    final activeTheme = active;

    return ExpressiveCardGroup(
      count: 2,
      itemBuilder: (context, i, pos) => switch (i) {
        0 => NeSwitchTile(
            position: pos,
            icon: Icons.palette_outlined,
            title: l10n.personalizationUseCustomThemeLabel,
            subtitle: l10n.personalizationUseCustomThemeSubtitle,
            value: useCustom,
            onChanged: (next) => _onToggle(ref, next: next),
          ),
        _ => NeNavTile(
            position: pos,
            icon: Icons.collections_bookmark_outlined,
            title: l10n.personalizationCustomThemesHeader,
            subtitle: activeTheme != null
                ? activeTheme.name
                : l10n.personalizationManageThemesSubtitle(library.length),
            trailing:
                activeTheme != null ? _MiniPalette(theme: activeTheme) : null,
            onTap: () => ThemeManagerScreen.push(context),
          ),
      },
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

/// The language picker: a dynamic-corner card group of radio rows (system
/// default + each supported locale), no per-row dividers.
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
    return RadioGroup<String?>(
      groupValue: selectedTag,
      onChanged: (tag) => onChanged(tag == null ? null : Locale(tag)),
      child: ExpressiveCardGroup(
        count: locales.length + 1,
        itemBuilder: (context, i, pos) => ExpressiveCard(
          position: pos,
          color: colors.surfaceContainer,
          padding: EdgeInsets.zero,
          child: i == 0
              ? RadioListTile<String?>(
                  value: null,
                  title: Text(l10n.languageSystemDefault),
                  secondary: Icon(
                    Icons.smartphone_outlined,
                    color: colors.onSurfaceVariant,
                  ),
                )
              : RadioListTile<String?>(
                  value: locales[i - 1].languageCode,
                  title: Text(_languageName(locales[i - 1])),
                ),
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
