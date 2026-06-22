import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/settings/custom_theme_editor_screen.dart';
import 'package:uxnan/presentation/screens/settings/theme_export.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// User-selectable theme mode (System / Light / Dark).
///
/// The three first-class modes always drive [MaterialApp.themeMode]. The
/// "Use a custom theme" master switch on the same screen flips the app to
/// the user's selected [CustomTheme] (see [useCustomThemeProvider]); when
/// it is on, the segmented picker is disabled because the custom theme is
/// the source of truth for both brightnesses.
enum ThemeModeOption { system, light, dark }

/// Maps [option] to the [ThemeMode] the host `MaterialApp` should use.
ThemeMode _toMaterialThemeMode(ThemeModeOption option) => switch (option) {
      ThemeModeOption.system => ThemeMode.system,
      ThemeModeOption.light => ThemeMode.light,
      ThemeModeOption.dark => ThemeMode.dark,
    };

/// Appearance & language settings: theme mode (system/light/dark), the
/// user's custom-themes library (collapsible list of built-in + authored
/// themes), and the app language. The custom theme editor is reached from
/// any list item via its popup menu; library-level Import / Export-all /
/// Reset live at the bottom of the collapsible.
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
              const _CustomThemesSection(),
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

/// Maps the active [ThemeMode] to the matching [ThemeModeOption].
ThemeModeOption _toOption(ThemeMode mode) => switch (mode) {
      ThemeMode.system => ThemeModeOption.system,
      ThemeMode.light => ThemeModeOption.light,
      ThemeMode.dark => ThemeModeOption.dark,
    };

/// The 3-option segmented button (System / Light / Dark). Disabled when
/// the user has flipped the *Use a custom theme* master switch on — the
/// custom theme is the source of truth in that mode, so the picker is
/// greyed out and ignores taps.
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

/// The collapsible custom-themes section: master switch on top, followed
/// by an ExpansionTile with every theme in the library (radio + name +
/// color preview + popup menu for Edit / Export / Delete), plus library-
/// level actions (Import / Export all / Reset) at the bottom of the tile.
class _CustomThemesSection extends ConsumerWidget {
  const _CustomThemesSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final useCustom = ref.watch(useCustomThemeProvider);
    final library = ref.watch(customThemesLibraryProvider);
    final activeId = ref.watch(activeCustomThemeIdProvider);
    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SwitchListTile.adaptive(
            value: useCustom,
            onChanged: (next) =>
                ref.read(useCustomThemeProvider.notifier).set(next),
            title: Text(l10n.personalizationUseCustomThemeLabel),
            subtitle: Text(l10n.personalizationUseCustomThemeSubtitle),
            secondary: Icon(
              Icons.palette_outlined,
              color: colors.onSurfaceVariant,
            ),
          ),
          if (useCustom && library.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.md + UxnanSpacing.xl,
                0,
                UxnanSpacing.md,
                UxnanSpacing.md,
              ),
              child: Text(
                l10n.personalizationCustomThemeDescription,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
              ),
            ),
          _CustomThemesCollapsible(
            themes: library,
            activeId: activeId,
            enabled: useCustom,
          ),
          // Library-level actions live OUTSIDE the collapsible so they're
          // always one tap away regardless of whether the themes list is
          // folded or open.
          Divider(height: 1, color: colors.outlineVariant),
          _CustomThemesNewThemeRow(enabled: useCustom),
          Divider(height: 1, color: colors.outlineVariant),
          _ImportThemeRow(enabled: useCustom),
          Divider(height: 1, color: colors.outlineVariant),
          _ExportAllThemesRow(
            themes: library,
            enabled: useCustom,
          ),
          Divider(height: 1, color: colors.outlineVariant),
          _ResetLibraryRow(enabled: useCustom),
        ],
      ),
    );
  }
}

/// The ExpansionTile that hosts the per-theme rows (one per library
/// entry). Library-level actions (New / Import / Export all / Reset) live
/// as siblings of this tile, OUTSIDE the collapsible, so they're always
/// one tap away. The tile itself is always rendered (so the user can
/// preview colors and discover the affordances) but visually +
/// interactively disabled when the master switch is off — `enabled`
/// greys the tile out and [IgnorePointer] prevents accidental taps.
/// Expansion state is owned by the [customThemesExpandedProvider] so the
/// user's last choice (open vs folded) survives restarts and toggling
/// the master switch on/off.
class _CustomThemesCollapsible extends ConsumerStatefulWidget {
  const _CustomThemesCollapsible({
    required this.themes,
    required this.activeId,
    required this.enabled,
  });

  final List<CustomTheme> themes;
  final String? activeId;
  final bool enabled;

  @override
  ConsumerState<_CustomThemesCollapsible> createState() =>
      _CustomThemesCollapsibleState();
}

class _CustomThemesCollapsibleState
    extends ConsumerState<_CustomThemesCollapsible> {
  late final ExpansibleController _controller = ExpansibleController();
  bool _lastSyncedExpanded = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Imperatively syncs the [ExpansionTile]'s visible expansion state to
  /// [expanded] (driven by the persisted provider). No-op when already in
  /// sync so we don't ping-pong on every rebuild.
  void _syncController(bool expanded) {
    if (_controller.isExpanded == expanded) return;
    _lastSyncedExpanded = expanded;
    if (expanded) {
      _controller.expand();
    } else {
      _controller.collapse();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    // Drive expansion from the persisted provider; one-shot sync on the
    // first build lets the controller catch up to the user's last choice
    // on first mount (the provider hydrates from disk asynchronously).
    final expanded = ref.watch(customThemesExpandedProvider);
    if (!_lastSyncedExpanded || _controller.isExpanded != expanded) {
      _lastSyncedExpanded = expanded;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _syncController(expanded);
      });
    }
    final tile = Theme(
      // Strip the ExpansionTile's divider lines so it nests cleanly inside
      // the surrounding surface card.
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        controller: _controller,
        leading: Icon(
          Icons.collections_bookmark_outlined,
          color: colors.onSurfaceVariant,
        ),
        title: Text(l10n.personalizationCustomThemesHeader),
        subtitle: Text(
          '${widget.themes.length}',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
        ),
        childrenPadding: EdgeInsets.zero,
        onExpansionChanged: (next) {
          ref.read(customThemesExpandedProvider.notifier).set(next);
        },
        children: [
          for (var i = 0; i < widget.themes.length; i++) ...[
            if (i > 0) Divider(height: 1, color: colors.outlineVariant),
            _CustomThemeRow(
              theme: widget.themes[i],
              isActive: widget.themes[i].id == widget.activeId,
              enabled: widget.enabled,
            ),
          ],
        ],
      ),
    );
    if (widget.enabled) return tile;
    return IgnorePointer(
      child: Opacity(opacity: 0.55, child: tile),
    );
  }
}

/// A single theme in the library: leading radio, name + badges, color
/// preview dots, trailing popup menu (Edit / Export JSON / Delete).
class _CustomThemeRow extends ConsumerWidget {
  const _CustomThemeRow({
    required this.theme,
    required this.isActive,
    required this.enabled,
  });

  final CustomTheme theme;
  final bool isActive;
  final bool enabled;

  Future<void> _activate(WidgetRef ref) async {
    await ref.read(activeCustomThemeIdProvider.notifier).set(theme.id);
    await ref.read(useCustomThemeProvider.notifier).set(true);
  }

  Future<void> _openEditor(BuildContext context) async {
    await CustomThemeEditorScreen.push(context, initial: theme);
  }

  /// Shows a small sheet that lets the user pick between copying the theme
  /// JSON to the clipboard or opening the native share sheet to save it to
  /// a file of their choice (Files / Drive / email / etc.).
  Future<void> _exportJson(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final action = await showModalBottomSheet<_ExportSheetAction>(
      context: context,
      showDragHandle: true,
      builder: (sheetCtx) => _ExportSheet(
        title: l10n.personalizationCustomThemeExport,
        copyLabel: l10n.personalizationCustomThemeExportCopy,
        fileLabel: l10n.personalizationCustomThemeExportFile,
      ),
    );
    if (action == null || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final text = theme.toJsonString();
    switch (action) {
      case _ExportSheetAction.copy:
        await Clipboard.setData(ClipboardData(text: text));
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.personalizationCustomThemesCopied)),
        );
      case _ExportSheetAction.file:
        final ok = await shareThemeJsonFile(
          fileName: _themeFileName(theme.name),
          json: text,
          subject: theme.name,
        );
        if (!context.mounted) return;
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              ok
                  ? l10n.personalizationCustomThemesSaved
                  : l10n.personalizationCustomThemesSaveFailed,
            ),
          ),
        );
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    // Capture notifiers + identity state BEFORE the first await: once the
    // user confirms the dialog and the library removes the theme, this row
    // is unmounted by the library's state change and `ref` becomes a dead
    // handle (Riverpod asserts). Working from the captured notifiers keeps
    // the post-delete `active`/`useCustom` cleanup safe.
    final libraryNotifier =
        ref.read(customThemesLibraryProvider.notifier);
    final activeNotifier =
        ref.read(activeCustomThemeIdProvider.notifier);
    final useCustomNotifier =
        ref.read(useCustomThemeProvider.notifier);
    final wasActive = isActive;
    final themeId = theme.id;
    if (isBuiltInCustomThemeId(themeId)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.personalizationCustomThemeDeleteFailed)),
      );
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.personalizationCustomThemeDeleteConfirmTitle),
        content: Text(l10n.personalizationCustomThemeDeleteConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
              foregroundColor: Theme.of(ctx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(l10n.personalizationCustomThemeDeleteConfirmAction),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final removed = await libraryNotifier.remove(themeId);
    if (removed && wasActive) {
      await activeNotifier.set(null);
      await useCustomNotifier.set(false);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      enabled: enabled,
      onTap: enabled ? () => _activate(ref) : null,
      leading: Icon(
        isActive ? Icons.radio_button_checked : Icons.radio_button_off,
        color: isActive ? colors.primary : colors.onSurfaceVariant,
      ),
      title: Row(
        children: [
          Flexible(
            child: Text(
              theme.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (isActive) ...[
            const SizedBox(width: UxnanSpacing.sm),
            _Badge(label: l10n.personalizationCustomThemeActiveBadge),
          ] else if (isBuiltInCustomThemeId(theme.id)) ...[
            const SizedBox(width: UxnanSpacing.sm),
            _Badge(label: l10n.personalizationCustomThemeBuiltInBadge),
          ],
        ],
      ),
      subtitle: _ColorDots(theme: theme),
      trailing: IconSurfaceMenu<_ThemeRowAction>(
        icon: Icons.more_vert_rounded,
        tooltip: l10n.personalizationCustomThemesHeader,
        enabled: enabled,
        onSelected: (action) async {
          switch (action) {
            case _ThemeRowAction.edit:
              await _openEditor(context);
            case _ThemeRowAction.export:
              await _exportJson(context);
            case _ThemeRowAction.delete:
              await _delete(context, ref);
          }
        },
        itemBuilder: (ctx) => [
          PopupMenuItem<_ThemeRowAction>(
            value: _ThemeRowAction.edit,
            child: ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: Text(l10n.personalizationCustomThemeEdit),
              contentPadding: EdgeInsets.zero,
            ),
          ),
          PopupMenuItem<_ThemeRowAction>(
            value: _ThemeRowAction.export,
            child: ListTile(
              leading: const Icon(Icons.upload_file_outlined),
              title: Text(l10n.personalizationCustomThemeExport),
              contentPadding: EdgeInsets.zero,
            ),
          ),
          PopupMenuItem<_ThemeRowAction>(
            value: _ThemeRowAction.delete,
            enabled: !isBuiltInCustomThemeId(theme.id),
            child: ListTile(
              leading: Icon(
                Icons.delete_outline_rounded,
                color: isBuiltInCustomThemeId(theme.id)
                    ? colors.onSurfaceVariant.withValues(alpha: 0.38)
                    : colors.error,
              ),
              title: Text(
                l10n.personalizationCustomThemeDelete,
                style: TextStyle(
                  color: isBuiltInCustomThemeId(theme.id)
                      ? colors.onSurface.withValues(alpha: 0.38)
                      : colors.error,
                ),
              ),
              contentPadding: EdgeInsets.zero,
            ),
          ),
        ],
      ),
    );
  }
}

enum _ThemeRowAction { edit, export, delete }

/// A small status pill rendered next to a theme's name (Active / Built-in).
class _Badge extends StatelessWidget {
  const _Badge({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: colors.secondaryContainer,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: colors.onSecondaryContainer,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

/// 4-dot color preview: light primary + dark primary + light surface + dark
/// surface. Doubles as a quick brightness hint (dark theme = darker dots).
class _ColorDots extends StatelessWidget {
  const _ColorDots({required this.theme});
  final CustomTheme theme;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final light = theme.colorScheme;
    final dark = theme.darkColorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: UxnanSpacing.xs),
      child: Row(
        children: [
          _Dot(color: light.primary, outline: scheme.outline),
          _Dot(color: dark.primary, outline: scheme.outline),
          _Dot(color: light.surface, outline: scheme.outline),
          _Dot(color: dark.surface, outline: scheme.outline),
        ],
      ),
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
      padding: const EdgeInsets.only(right: UxnanSpacing.xs),
      child: Container(
        width: 14,
        height: 14,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(
            color: outline.withValues(alpha: 0.5),
            width: 1,
          ),
        ),
      ),
    );
  }
}

/// Inline action row that opens the editor seeded with a fresh id. Lives
/// at the top of the library-level actions so the "+ New theme" affordance
/// is always one tap away from any list position. Tapping opens a small
/// dialog that lets the user pick a seed color AND the target brightness
/// (light or dark) so the resulting theme does not silently reuse the
/// active app palette.
class _CustomThemesNewThemeRow extends ConsumerWidget {
  const _CustomThemesNewThemeRow({required this.enabled});
  final bool enabled;

  Future<void> _onTap(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final initialSeed = ref.read(customThemesLibraryProvider).isEmpty
        ? Theme.of(context).colorScheme.primary
        : const Color(0xFF6750A4);
    final result = await showDialog<_NewThemeResult>(
      context: context,
      builder: (ctx) => _NewThemeDialog(
        title: l10n.personalizationCustomThemeNewDialogTitle,
        body: l10n.personalizationCustomThemeNewDialogBody,
        seedLabel: l10n.customThemeEditorSeedHint,
        lightLabel: l10n.customThemeEditorLight,
        darkLabel: l10n.customThemeEditorDark,
        cancelLabel: l10n.actionCancel,
        applyLabel: l10n.actionApply,
        initialSeed: initialSeed,
      ),
    );
    if (result == null || !context.mounted) return;
    final fresh = CustomTheme.fromDualSchemes(
      id: CustomTheme.freshId(),
      name: l10n.customThemeEditorDefaultName,
      light: _schemeFromSeed(result.seed, Brightness.light),
      dark: _schemeFromSeed(result.seed, Brightness.dark),
    );
    await CustomThemeEditorScreen.push(
      context,
      initial: fresh,
      initialBrightness: result.brightness,
    );
  }

  /// Builds the [Brightness]-specific [ColorScheme] used to seed the new
  /// theme: every role is derived from the seed via Material 3, and the
  /// primary is then forced to the seed itself so the user sees exactly the
  /// color they picked in the picker (instead of the seed-derived offset).
  static ColorScheme _schemeFromSeed(Color seed, Brightness brightness) {
    final derived = ColorScheme.fromSeed(seedColor: seed, brightness: brightness);
    return derived.copyWith(primary: seed);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      enabled: enabled,
      leading: Icon(Icons.add_circle_outline_rounded, color: colors.primary),
      title: Text(l10n.personalizationCustomThemeAuthor),
      subtitle: Text(l10n.personalizationCustomThemeAuthorSubtitle),
      trailing: Icon(
        Icons.chevron_right_rounded,
        color: colors.onSurfaceVariant,
      ),
      onTap: enabled ? () => _onTap(context, ref) : null,
    );
  }
}

/// Library-level *Import* action. Accepts a single theme JSON or a JSON
/// array of themes (the typical "Export all" payload). New themes get
/// fresh ids so the existing library stays stable.
class _ImportThemeRow extends ConsumerWidget {
  const _ImportThemeRow({required this.enabled});
  final bool enabled;

  Future<void> _onTap(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => _ImportDialog(
        title: l10n.personalizationCustomThemesImportDialogTitle,
        body: l10n.personalizationCustomThemesImportDialogBody,
        hint: l10n.personalizationCustomThemesImportFieldHint,
      ),
    );
    if (result == null) return;
    if (!context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final libraryNotifier = ref.read(customThemesLibraryProvider.notifier);
    final existingLibrary = ref.read(customThemesLibraryProvider);
    final addedIds = <String>[];
    var failed = 0;
    try {
      final dynamic decoded = jsonDecode(result.trim());
      final List<dynamic> entries = switch (decoded) {
        List<dynamic> list => list,
        Map<String, dynamic> map => [map],
        _ => const <dynamic>[],
      };
      if (entries.isEmpty) {
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.personalizationCustomThemesImportFailed)),
        );
        return;
      }
      for (final entry in entries) {
        if (entry is! Map) {
          failed++;
          continue;
        }
        try {
          final imported = CustomTheme.fromJson(entry.cast<String, dynamic>());
          // Assign a fresh id when one is already in the library so an
          // import does not silently overwrite an existing theme. The
          // imported theme keeps both its light + dark schemes.
          final exists = existingLibrary.any((t) => t.id == imported.id);
          final theme = exists
              ? CustomTheme.fromDualSchemes(
                  id: CustomTheme.freshId(),
                  name: imported.name,
                  description: imported.description,
                  light: imported.colorScheme,
                  dark: imported.darkColorScheme,
                )
              : imported;
          await libraryNotifier.upsert(theme);
          addedIds.add(theme.id);
        } on Object catch (error, stackTrace) {
          failed++;
          AppLogger.warn('theme import entry failed', error, stackTrace);
        }
      }
    } on Object catch (error, stackTrace) {
      AppLogger.warn('theme import parse failed', error, stackTrace);
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.personalizationCustomThemesImportFailed)),
      );
      return;
    }
    if (addedIds.isEmpty) {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.personalizationCustomThemesImportFailed)),
      );
      return;
    }
    if (failed > 0) {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.personalizationCustomThemesImportPartial)),
      );
    } else {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            '${l10n.personalizationCustomThemesImportSuccess} '
            '(${addedIds.length})',
          ),
        ),
      );
    }
    // Auto-select the first imported theme if there was no active theme
    // yet — a first-time importer gets an immediate visible result.
    final hasActive = ref.read(activeCustomThemeIdProvider) != null;
    if (!hasActive) {
      await ref.read(activeCustomThemeIdProvider.notifier).set(addedIds.first);
      await ref.read(useCustomThemeProvider.notifier).set(true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      enabled: enabled,
      leading: Icon(Icons.file_download_outlined, color: colors.primary),
      title: Text(l10n.personalizationCustomThemesImportAction),
      subtitle: Text(l10n.personalizationCustomThemesImportActionSubtitle),
      trailing: Icon(
        Icons.chevron_right_rounded,
        color: colors.onSurfaceVariant,
      ),
      onTap: enabled ? () => _onTap(context, ref) : null,
    );
  }
}

/// Library-level *Export all* action: serializes the whole library as a
/// single JSON array. Tapping opens a small sheet so the user can choose
/// between copying the array to the clipboard or saving it to a file
/// through the native share sheet.
class _ExportAllThemesRow extends StatelessWidget {
  const _ExportAllThemesRow({required this.themes, required this.enabled});
  final List<CustomTheme> themes;
  final bool enabled;

  Future<void> _onTap(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final encoded = const JsonEncoder.withIndent('  ').convert(
      themes.map((t) => t.toJson()).toList(),
    );
    final action = await showModalBottomSheet<_ExportSheetAction>(
      context: context,
      showDragHandle: true,
      builder: (sheetCtx) => _ExportSheet(
        title: l10n.personalizationCustomThemesExportAllAction,
        copyLabel: l10n.personalizationCustomThemeExportCopy,
        fileLabel: l10n.personalizationCustomThemeExportFile,
      ),
    );
    if (action == null || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    switch (action) {
      case _ExportSheetAction.copy:
        await Clipboard.setData(ClipboardData(text: encoded));
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.personalizationCustomThemesCopiedAll)),
        );
      case _ExportSheetAction.file:
        final ok = await shareThemeJsonFile(
          fileName: _libraryFileName(),
          json: encoded,
          subject: l10n.personalizationCustomThemesExportAllAction,
        );
        if (!context.mounted) return;
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              ok
                  ? l10n.personalizationCustomThemesSaved
                  : l10n.personalizationCustomThemesSaveFailed,
            ),
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      enabled: enabled,
      leading: Icon(Icons.upload_file_outlined, color: colors.primary),
      title: Text(l10n.personalizationCustomThemesExportAllAction),
      subtitle: Text(l10n.personalizationCustomThemesExportAllActionSubtitle),
      trailing: Icon(
        Icons.chevron_right_rounded,
        color: colors.onSurfaceVariant,
      ),
      onTap: enabled ? () => _onTap(context) : null,
    );
  }
}

/// Library-level *Reset library* action: drops every authored theme and
/// restores the built-in seed. Built-in themes are always re-added; the
/// master switch flips off so the user lands on the brand baseline.
class _ResetLibraryRow extends ConsumerWidget {
  const _ResetLibraryRow({required this.enabled});
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      enabled: enabled,
      leading: Icon(Icons.restart_alt_rounded, color: colors.error),
      title: Text(
        l10n.personalizationCustomThemesResetAction,
        style: TextStyle(color: colors.error),
      ),
      subtitle: Text(l10n.personalizationCustomThemesResetActionSubtitle),
      trailing: Icon(
        Icons.chevron_right_rounded,
        color: colors.onSurfaceVariant,
      ),
      onTap: enabled
          ? () =>
              ref.read(customThemesLibraryProvider.notifier).resetToBuiltIns()
          : null,
    );
  }
}

/// Multi-line input dialog used by *Import*. The user pastes JSON; the
/// caller parses + dispatches (single theme vs array).
class _ImportDialog extends StatefulWidget {
  const _ImportDialog({
    required this.title,
    required this.body,
    required this.hint,
  });
  final String title;
  final String body;
  final String hint;

  @override
  State<_ImportDialog> createState() => _ImportDialogState();
}

class _ImportDialogState extends State<_ImportDialog> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 600),
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: UxnanSpacing.sm),
              Text(widget.body, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: UxnanSpacing.md),
              Expanded(
                child: TextField(
                  controller: _controller,
                  maxLines: null,
                  expands: true,
                  textAlignVertical: TextAlignVertical.top,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        fontFamily: 'JetBrainsMono',
                      ),
                  decoration: InputDecoration(
                    hintText: widget.hint,
                    filled: true,
                    fillColor: colors.surfaceContainerHigh,
                    border: OutlineInputBorder(
                      borderRadius: const BorderRadius.all(UxnanRadius.md),
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.all(UxnanSpacing.md),
                  ),
                ),
              ),
              const SizedBox(height: UxnanSpacing.md),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: colors.primary,
                      foregroundColor: colors.onPrimary,
                    ),
                    onPressed: () =>
                        Navigator.of(context).pop(_controller.text),
                    child: const Text('Import'),
                  ),
                ],
              ),
            ],
          ),
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

/// Result returned by [_NewThemeDialog]: the seed color the user picked and
/// the brightness the editor should open on.
class _NewThemeResult {
  const _NewThemeResult({required this.seed, required this.brightness});

  final Color seed;
  final Brightness brightness;
}

/// The dialog shown when tapping *+ New theme*. Lets the user pick a seed
/// color (HSV) and the brightness tab the new theme should target. The
/// caller seeds the [CustomTheme] from the result — the chosen brightness
/// becomes the editor's initial tab.
class _NewThemeDialog extends StatefulWidget {
  const _NewThemeDialog({
    required this.title,
    required this.body,
    required this.seedLabel,
    required this.lightLabel,
    required this.darkLabel,
    required this.cancelLabel,
    required this.applyLabel,
    required this.initialSeed,
  });

  final String title;
  final String body;
  final String seedLabel;
  final String lightLabel;
  final String darkLabel;
  final String cancelLabel;
  final String applyLabel;
  final Color initialSeed;

  @override
  State<_NewThemeDialog> createState() => _NewThemeDialogState();
}

class _NewThemeDialogState extends State<_NewThemeDialog> {
  late HSVColor _hsv;
  late Brightness _brightness;

  @override
  void initState() {
    super.initState();
    _hsv = HSVColor.fromColor(widget.initialSeed);
    _brightness = Brightness.light;
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 320,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.body, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: UxnanSpacing.md),
            Text(
              widget.seedLabel,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: UxnanSpacing.sm),
            Container(
              height: 48,
              decoration: BoxDecoration(
                color: _hsv.toColor(),
                borderRadius: const BorderRadius.all(UxnanRadius.lg),
              ),
            ),
            const SizedBox(height: UxnanSpacing.sm),
            _HueSlider(
              hue: _hsv.hue,
              onChanged: (h) => setState(() => _hsv = _hsv.withHue(h)),
            ),
            Slider(
              value: _hsv.saturation,
              max: 1,
              onChanged: (s) => setState(() => _hsv = _hsv.withSaturation(s)),
            ),
            Slider(
              value: _hsv.value,
              max: 1,
              onChanged: (v) => setState(() => _hsv = _hsv.withValue(v)),
            ),
            const SizedBox(height: UxnanSpacing.md),
            SizedBox(
              width: double.infinity,
              child: SegmentedButton<Brightness>(
                showSelectedIcon: false,
                segments: [
                  ButtonSegment(
                    value: Brightness.light,
                    icon: const Icon(Icons.light_mode_outlined),
                    label: Text(widget.lightLabel),
                  ),
                  ButtonSegment(
                    value: Brightness.dark,
                    icon: const Icon(Icons.dark_mode_outlined),
                    label: Text(widget.darkLabel),
                  ),
                ],
                selected: {_brightness},
                onSelectionChanged: (s) =>
                    setState(() => _brightness = s.first),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(widget.cancelLabel),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: colors.primary,
            foregroundColor: colors.onPrimary,
          ),
          onPressed: () => Navigator.of(context).pop(
            _NewThemeResult(seed: _hsv.toColor(), brightness: _brightness),
          ),
          child: Text(widget.applyLabel),
        ),
      ],
    );
  }
}

/// What the user picked in [_ExportSheet] — copy the JSON to the system
/// clipboard or open the native share sheet to save it as a file.
enum _ExportSheetAction { copy, file }

/// Bottom sheet that lets the user choose between copying the theme JSON
/// to the clipboard or saving it to a file via the platform share sheet.
class _ExportSheet extends StatelessWidget {
  const _ExportSheet({
    required this.title,
    required this.copyLabel,
    required this.fileLabel,
  });

  final String title;
  final String copyLabel;
  final String fileLabel;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: UxnanSpacing.xs,
                vertical: UxnanSpacing.sm,
              ),
              child: Text(
                title,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            const SizedBox(height: UxnanSpacing.sm),
            _ExportTile(
              icon: Icons.copy_rounded,
              label: copyLabel,
              color: colors,
              onTap: () => Navigator.of(context)
                  .pop(_ExportSheetAction.copy),
            ),
            const SizedBox(height: UxnanSpacing.xs),
            _ExportTile(
              icon: Icons.save_alt_rounded,
              label: fileLabel,
              color: colors,
              onTap: () => Navigator.of(context)
                  .pop(_ExportSheetAction.file),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExportTile extends StatelessWidget {
  const _ExportTile({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final ColorScheme color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.surfaceContainerHigh,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.md,
            vertical: UxnanSpacing.md,
          ),
          child: Row(
            children: [
              Icon(icon, color: color.onSurfaceVariant),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Inline hue slider (kept here so the dialog stays self-contained — the
/// editor uses the same widget under the same name).
class _HueSlider extends StatelessWidget {
  const _HueSlider({required this.hue, required this.onChanged});

  final double hue;
  final ValueChanged<double> onChanged;

  static const List<Color> _stops = [
    Color(0xFFFF0000),
    Color(0xFFFFFF00),
    Color(0xFF00FF00),
    Color(0xFF00FFFF),
    Color(0xFF0000FF),
    Color(0xFFFF00FF),
    Color(0xFFFF0000),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.all(UxnanRadius.full),
        gradient: LinearGradient(colors: _stops),
      ),
      child: SliderTheme(
        data: const SliderThemeData(
          trackHeight: 12,
          thumbColor: Colors.white,
          activeTrackColor: Colors.transparent,
          inactiveTrackColor: Colors.transparent,
          thumbShape: RoundSliderThumbShape(enabledThumbRadius: 10),
        ),
        child: Slider(
          value: hue,
          min: 0,
          max: 360,
          onChanged: onChanged,
        ),
      ),
    );
  }
}

/// Returns a filesystem-safe filename for a single exported theme. Falls
/// back to a slug of the theme name so users always get a recognizable
/// filename even for themed-with-no-name entries.
String _themeFileName(String themeName) {
  final slug = _slugify(themeName);
  return 'uxnan-theme-$slug.json';
}

/// Returns a stable filename for the exported library. The date keeps the
/// files distinguishable when a user exports more than once.
String _libraryFileName() {
  final now = DateTime.now();
  String two(int n) => n.toString().padLeft(2, '0');
  final stamp =
      '${now.year}${two(now.month)}${two(now.day)}-${two(now.hour)}${two(now.minute)}';
  return 'uxnan-themes-$stamp.json';
}

/// Replaces whitespace + non-alphanumerics with hyphens and lowercases the
/// result. Empty input falls back to "theme" so the filename is never
/// blank.
String _slugify(String input) {
  final lower = input.toLowerCase().trim();
  final replaced = lower.replaceAll(RegExp(r'[^a-z0-9]+'), '-');
  final trimmed = replaced.replaceAll(RegExp(r'^-+|-+$'), '');
  return trimmed.isEmpty ? 'theme' : trimmed;
}
