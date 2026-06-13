import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Appearance & language settings: theme mode (system/light/dark), accent
/// color, and the app language. The language list is derived from
/// [AppLocalizations.supportedLocales], so a newly added locale shows up here
/// automatically; the default follows the device language.
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

    return Scaffold(
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(
          parent: AlwaysScrollableScrollPhysics(),
        ),
        slivers: [
          SliverAppBar.large(
            floating: true,
            snap: true,
            title: Text(l10n.personalizationTitle),
          ),
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
                const _AccentComingSoon(),
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
      ),
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

/// Placeholder while custom accent colors are still in design — applying an
/// accent coherently across surfaces/secondary roles is a larger theming change
/// (tracked in FOR-DEV). The accent stays the brand default for now.
class _AccentComingSoon extends StatelessWidget {
  const _AccentComingSoon();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.lg),
        child: Row(
          children: [
            Icon(Icons.palette_outlined, color: colors.onSurfaceVariant),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.personalizationAccentComingSoon,
                    style: textTheme.titleSmall,
                  ),
                  const SizedBox(height: UxnanSpacing.xs),
                  Text(
                    l10n.personalizationAccentComingSoonBody,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
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
/// endonym; an unmapped (newly added) locale falls back to its language code so
/// it still appears in the list.
String _languageName(Locale locale) {
  const names = <String, String>{
    'en': 'English',
    'es': 'Español',
  };
  return names[locale.languageCode] ?? locale.languageCode.toUpperCase();
}
