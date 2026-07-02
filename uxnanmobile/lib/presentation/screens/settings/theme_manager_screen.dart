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
import 'package:uxnan/presentation/screens/settings/theme_sheets.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/color_picker.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen library manager for the user's [CustomTheme]s.
///
/// A responsive grid of live preview cards (each painted with the theme's own
/// colors). Tapping a card activates that theme; long-pressing enters a
/// multi-select mode for bulk delete / export. New / Import / Export-all /
/// Reset live in the app bar. Replaces the old inline list inside
/// Personalization, which did not scale past a handful of themes.
class ThemeManagerScreen extends ConsumerStatefulWidget {
  /// Creates the theme manager screen.
  const ThemeManagerScreen({super.key});

  /// Pushes the manager onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const ThemeManagerScreen()),
    );
  }

  @override
  ConsumerState<ThemeManagerScreen> createState() => _ThemeManagerScreenState();
}

class _ThemeManagerScreenState extends ConsumerState<ThemeManagerScreen> {
  /// Selected theme ids while in multi-select mode (empty = normal mode).
  final Set<String> _selected = <String>{};

  bool get _selectionMode => _selected.isNotEmpty;

  void _clearSelection() => setState(_selected.clear);

  void _toggle(String id) {
    setState(() {
      if (!_selected.remove(id)) _selected.add(id);
    });
  }

  void _enterSelection(String id) {
    if (_selectionMode) return;
    setState(() => _selected.add(id));
  }

  // --- Activation ----------------------------------------------------------

  Future<void> _activate(CustomTheme theme) async {
    await ref.read(activeCustomThemeIdProvider.notifier).set(theme.id);
    await ref.read(useCustomThemeProvider.notifier).set(value: true);
  }

  // --- New / Import / Export / Delete --------------------------------------

  Future<void> _newTheme() async {
    final l10n = AppLocalizations.of(context);
    // New themes are created DUAL: pick one seed, generate a full Material 3
    // light + dark theme (the dark side derived from the light key colors).
    // The brightness toggle that used to live here is gone — a single-side
    // theme is something you *import*, not something you author from scratch.
    final seed = await ColorPickerSheet.show(
      context,
      initial: const Color(0xFF1B6EF3),
      title: l10n.customThemeEditorSeedHint,
    );
    if (seed == null || !mounted) return;
    final light = ColorScheme.fromSeed(seedColor: seed).copyWith(primary: seed);
    final fresh = CustomTheme(
      id: CustomTheme.freshId(),
      name: l10n.customThemeEditorDefaultName,
      colorScheme: light,
    );
    await CustomThemeEditorScreen.push(context, initial: fresh);
  }

  Future<void> _import() async {
    final l10n = AppLocalizations.of(context);
    final raw = await showThemeImportEditor(
      context,
      title: l10n.personalizationCustomThemesImportDialogTitle,
      body: l10n.personalizationCustomThemesImportDialogBody,
      hint: l10n.personalizationCustomThemesImportFieldHint,
    );
    if (raw == null || raw.trim().isEmpty || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final libraryNotifier = ref.read(customThemesLibraryProvider.notifier);
    // Track every id we'd clash with — the existing library AND themes added
    // earlier in this same batch — so a JSON that carries several themes (even
    // ones that share an id) keeps each as a distinct, separately-saved theme
    // instead of silently overwriting. Single- and dual-scheme themes are all
    // accepted (see [CustomTheme.fromJson]); a multi-theme JSON is a top-level
    // array of those theme objects.
    final seenIds = <String>{
      for (final t in ref.read(customThemesLibraryProvider)) t.id,
    };
    final addedIds = <String>[];
    var failed = 0;
    try {
      final decoded = jsonDecode(raw.trim());
      final entries = switch (decoded) {
        final List<dynamic> list => list,
        final Map<String, dynamic> map => [map],
        _ => const <dynamic>[],
      };
      if (entries.isEmpty) {
        _snack(messenger, l10n.personalizationCustomThemesImportFailed);
        return;
      }
      for (final entry in entries) {
        if (entry is! Map) {
          failed++;
          continue;
        }
        try {
          var imported = CustomTheme.fromJson(entry.cast<String, dynamic>());
          // Never let an import become a "built-in": a JSON exported from a
          // seeded theme (or hand-edited) carrying a `uxnan.builtin.*` id would
          // otherwise be undeletable AND not persisted (built-ins are seeded,
          // not stored). Reassign a fresh id for a built-in id or a collision.
          if (isBuiltInCustomThemeId(imported.id) ||
              seenIds.contains(imported.id)) {
            imported = imported.withId(CustomTheme.freshId());
          }
          seenIds.add(imported.id);
          await libraryNotifier.upsert(imported);
          addedIds.add(imported.id);
        } on Object catch (error, stackTrace) {
          failed++;
          AppLogger.warn('theme import entry failed', error, stackTrace);
        }
      }
    } on Object catch (error, stackTrace) {
      AppLogger.warn('theme import parse failed', error, stackTrace);
      _snack(messenger, l10n.personalizationCustomThemesImportFailed);
      return;
    }
    if (addedIds.isEmpty) {
      _snack(messenger, l10n.personalizationCustomThemesImportFailed);
      return;
    }
    _snack(
      messenger,
      failed > 0
          ? l10n.personalizationCustomThemesImportPartial
          : '${l10n.personalizationCustomThemesImportSuccess} '
              '(${addedIds.length})',
    );
    // First-time importer with nothing active yet → show an immediate result.
    if (ref.read(activeCustomThemeIdProvider) == null) {
      await ref.read(activeCustomThemeIdProvider.notifier).set(addedIds.first);
      await ref.read(useCustomThemeProvider.notifier).set(value: true);
    }
  }

  Future<void> _exportPayload(String payload, String subjectAndTitle) async {
    final l10n = AppLocalizations.of(context);
    final choice = await showThemeExportSheet(
      context,
      title: subjectAndTitle,
      copyLabel: l10n.personalizationCustomThemeExportCopy,
      fileLabel: l10n.personalizationCustomThemeExportFile,
    );
    if (choice == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    switch (choice) {
      case ThemeExportChoice.copy:
        await Clipboard.setData(ClipboardData(text: payload));
        _snack(messenger, l10n.personalizationCustomThemesCopied);
      case ThemeExportChoice.file:
        final ok = await shareThemeJsonFile(
          fileName: 'uxnan-theme-${_slugify(subjectAndTitle)}.json',
          json: payload,
          subject: subjectAndTitle,
        );
        if (!mounted) return;
        _snack(
          messenger,
          ok
              ? l10n.personalizationCustomThemesSaved
              : l10n.personalizationCustomThemesSaveFailed,
        );
    }
  }

  /// A theme in exportable form: a built-in gets a fresh, non-`uxnan.builtin.`
  /// id so the exported JSON re-imports as a normal (deletable, persisted)
  /// custom theme instead of a fake built-in. Authored themes export as-is.
  CustomTheme _exportable(CustomTheme theme) => isBuiltInCustomThemeId(theme.id)
      ? theme.withId(CustomTheme.freshId())
      : theme;

  Future<void> _exportOne(CustomTheme theme) =>
      _exportPayload(_exportable(theme).toJsonString(), theme.name);

  Future<void> _exportAll() async {
    final l10n = AppLocalizations.of(context);
    final themes = ref.read(customThemesLibraryProvider);
    final payload = const JsonEncoder.withIndent('  ')
        .convert(themes.map((t) => _exportable(t).toJson()).toList());
    await _exportPayload(
      payload,
      l10n.personalizationCustomThemesExportAllAction,
    );
  }

  Future<void> _exportSelected() async {
    final selected = ref
        .read(customThemesLibraryProvider)
        .where((t) => _selected.contains(t.id))
        .toList();
    if (selected.isEmpty) return;
    final l10n = AppLocalizations.of(context);
    final payload = const JsonEncoder.withIndent('  ')
        .convert(selected.map((t) => _exportable(t).toJson()).toList());
    await _exportPayload(
      payload,
      l10n.personalizationCustomThemesExportAllAction,
    );
    if (mounted) _clearSelection();
  }

  Future<void> _deleteOne(CustomTheme theme) async {
    final l10n = AppLocalizations.of(context);
    if (isBuiltInCustomThemeId(theme.id)) {
      _snack(
        ScaffoldMessenger.of(context),
        l10n.personalizationCustomThemeDeleteFailed,
      );
      return;
    }
    final confirmed = await _confirm(
      title: l10n.personalizationCustomThemeDeleteConfirmTitle,
      body: l10n.personalizationCustomThemeDeleteConfirmBody,
      action: l10n.personalizationCustomThemeDeleteConfirmAction,
    );
    if (confirmed != true) return;
    await _removeThemes({theme.id});
  }

  Future<void> _deleteSelected() async {
    final l10n = AppLocalizations.of(context);
    final deletable =
        _selected.where((id) => !isBuiltInCustomThemeId(id)).toSet();
    final hasBuiltIns = deletable.length != _selected.length;
    if (deletable.isEmpty) {
      _snack(
        ScaffoldMessenger.of(context),
        l10n.personalizationCustomThemeDeleteFailed,
      );
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await _confirm(
      title: l10n.themeManagerDeleteSelectedTitle,
      body: l10n.themeManagerDeleteSelectedBody(deletable.length),
      action: l10n.personalizationCustomThemeDeleteConfirmAction,
    );
    if (confirmed != true) return;
    await _removeThemes(deletable);
    if (hasBuiltIns && mounted) {
      _snack(messenger, l10n.themeManagerBuiltInsSkipped);
    }
    if (mounted) _clearSelection();
  }

  /// Removes [ids] from the library, capturing notifiers before the awaits
  /// (the rows unmount as the library state changes). Clears the active
  /// selection + master switch when the active theme was among those removed.
  Future<void> _removeThemes(Set<String> ids) async {
    final libraryNotifier = ref.read(customThemesLibraryProvider.notifier);
    final activeNotifier = ref.read(activeCustomThemeIdProvider.notifier);
    final useCustomNotifier = ref.read(useCustomThemeProvider.notifier);
    final activeId = ref.read(activeCustomThemeIdProvider);
    for (final id in ids) {
      await libraryNotifier.remove(id);
    }
    if (activeId != null && ids.contains(activeId)) {
      await activeNotifier.set(null);
      await useCustomNotifier.set(value: false);
    }
  }

  Future<void> _reset() async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await _confirm(
      title: l10n.personalizationCustomThemesResetAction,
      body: l10n.personalizationCustomThemesResetActionSubtitle,
      action: l10n.personalizationCustomThemeDeleteConfirmAction,
    );
    if (confirmed != true) return;
    await ref.read(customThemesLibraryProvider.notifier).resetToBuiltIns();
    if (mounted) _clearSelection();
  }

  // --- Helpers -------------------------------------------------------------

  Future<bool?> _confirm({
    required String title,
    required String body,
    required String action,
    bool destructive = true,
  }) {
    final l10n = AppLocalizations.of(context);
    return showDialog<bool>(
      context: context,
      builder: (ctx) {
        final colors = Theme.of(ctx).colorScheme;
        return AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(l10n.actionCancel),
            ),
            FilledButton(
              style: destructive
                  ? FilledButton.styleFrom(
                      backgroundColor: colors.error,
                      foregroundColor: colors.onError,
                    )
                  : null,
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(action),
            ),
          ],
        );
      },
    );
  }

  void _snack(ScaffoldMessengerState messenger, String text) {
    messenger
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  // --- Build ---------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final library = ref.watch(customThemesLibraryProvider);
    final activeId = ref.watch(activeCustomThemeIdProvider);
    final useCustom = ref.watch(useCustomThemeProvider);

    return NeScaffold(
      title: _selectionMode
          ? l10n.themeManagerSelectedCount(_selected.length)
          : l10n.themeManagerTitle,
      leading: _selectionMode
          ? IconSurface(
              icon: Icons.close_rounded,
              tooltip: l10n.themeManagerExitSelection,
              onPressed: _clearSelection,
            )
          : null,
      actions: _selectionMode
          ? [
              IconSurface(
                icon: Icons.select_all_rounded,
                tooltip: l10n.themeManagerSelectAll,
                onPressed: () => setState(
                  () => _selected.addAll(library.map((t) => t.id)),
                ),
              ),
              IconSurface(
                icon: Icons.ios_share_rounded,
                tooltip: l10n.personalizationCustomThemeExport,
                onPressed: _exportSelected,
              ),
              IconSurface(
                icon: Icons.delete_outline_rounded,
                tooltip: l10n.personalizationCustomThemeDelete,
                onPressed: _deleteSelected,
              ),
            ]
          : [
              IconSurface(
                icon: Icons.add_rounded,
                tooltip: l10n.personalizationCustomThemeAuthor,
                onPressed: _newTheme,
              ),
              IconSurface(
                icon: Icons.file_download_outlined,
                tooltip: l10n.personalizationCustomThemesImportAction,
                onPressed: _import,
              ),
              IconSurfaceMenu<_ManagerAction>(
                icon: Icons.more_vert_rounded,
                tooltip: l10n.themeManagerTitle,
                onSelected: (action) => switch (action) {
                  _ManagerAction.exportAll => _exportAll(),
                  _ManagerAction.reset => _reset(),
                },
                itemBuilder: (ctx) => [
                  PopupMenuItem(
                    value: _ManagerAction.exportAll,
                    child: ListTile(
                      leading: const Icon(Icons.upload_file_outlined),
                      title: Text(
                        l10n.personalizationCustomThemesExportAllAction,
                      ),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                  PopupMenuItem(
                    value: _ManagerAction.reset,
                    child: ListTile(
                      leading: Icon(
                        Icons.restart_alt_rounded,
                        color: Theme.of(ctx).colorScheme.error,
                      ),
                      title: Text(l10n.personalizationCustomThemesResetAction),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                ],
              ),
              const SizedBox(width: UxnanSpacing.xs),
            ],
      slivers: [
        if (library.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: _EmptyState(
              title: l10n.themeManagerEmptyTitle,
              body: l10n.themeManagerEmptyBody,
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.xl,
            ),
            sliver: SliverGrid.builder(
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 200,
                mainAxisSpacing: UxnanSpacing.md,
                crossAxisSpacing: UxnanSpacing.md,
                childAspectRatio: 0.78,
              ),
              itemCount: library.length,
              itemBuilder: (context, i) {
                final theme = library[i];
                return _ThemeCard(
                  theme: theme,
                  isActive: useCustom && theme.id == activeId,
                  selectionMode: _selectionMode,
                  isSelected: _selected.contains(theme.id),
                  onTap: () =>
                      _selectionMode ? _toggle(theme.id) : _activate(theme),
                  onLongPress: () => _enterSelection(theme.id),
                  onEdit: () =>
                      CustomThemeEditorScreen.push(context, initial: theme),
                  onExport: () => _exportOne(theme),
                  onDelete: () => _deleteOne(theme),
                );
              },
            ),
          ),
      ],
    );
  }
}

enum _ManagerAction { exportAll, reset }

enum _CardAction { edit, export, delete }

/// A single theme rendered as a live preview card: its own colors fill a mini
/// mock-up (split light|dark for a dual theme, a single panel otherwise), with
/// the name, a brightness chip and Active / Built-in badges below.
class _ThemeCard extends StatelessWidget {
  const _ThemeCard({
    required this.theme,
    required this.isActive,
    required this.selectionMode,
    required this.isSelected,
    required this.onTap,
    required this.onLongPress,
    required this.onEdit,
    required this.onExport,
    required this.onDelete,
  });

  final CustomTheme theme;
  final bool isActive;
  final bool selectionMode;
  final bool isSelected;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onEdit;
  final VoidCallback onExport;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isBuiltIn = isBuiltInCustomThemeId(theme.id);
    // The selection/active ring: active = primary, selected = primary, else a
    // hairline outline so every card has a defined edge on any surface.
    final ringColor =
        isSelected || isActive ? colors.primary : colors.outlineVariant;
    final ringWidth = isSelected || isActive ? 2.0 : 1.0;

    return Material(
      color: colors.surfaceContainerHighest,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        side: BorderSide(color: ringColor, width: ringWidth),
      ),
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // --- Live preview ------------------------------------------------
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _Preview(theme: theme),
                  if (selectionMode)
                    Positioned(
                      top: UxnanSpacing.xs,
                      right: UxnanSpacing.xs,
                      child: _SelectionDot(selected: isSelected),
                    )
                  else
                    Positioned(
                      top: 0,
                      right: 0,
                      child: _CardMenu(
                        isBuiltIn: isBuiltIn,
                        onEdit: onEdit,
                        onExport: onExport,
                        onDelete: onDelete,
                      ),
                    ),
                ],
              ),
            ),
            // --- Footer ------------------------------------------------------
            Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.sm,
                UxnanSpacing.sm,
                UxnanSpacing.sm,
                UxnanSpacing.sm,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    theme.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.titleSmall?.copyWith(
                      color: colors.onSurface,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: UxnanSpacing.xs),
                  Wrap(
                    spacing: UxnanSpacing.xs,
                    runSpacing: UxnanSpacing.xs,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      _Chip(label: _brightnessLabel(l10n, theme)),
                      if (isActive)
                        _Chip(
                          label: l10n.personalizationCustomThemeActiveBadge,
                          tone: _ChipTone.primary,
                        )
                      else if (isBuiltIn)
                        _Chip(
                          label: l10n.personalizationCustomThemeBuiltInBadge,
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _brightnessLabel(AppLocalizations l10n, CustomTheme theme) {
    if (theme.isDual) return l10n.themeBrightnessDual;
    return theme.brightness == Brightness.dark
        ? l10n.themeBrightnessDarkOnly
        : l10n.themeBrightnessLightOnly;
  }
}

/// The live mini mock-up: a dual theme shows light|dark side by side; a single
/// theme fills the whole area with its one authored side. Each panel paints a
/// faux title strip, the primary/secondary/tertiary swatches and an "Aa"
/// sample so the user reads the palette at a glance.
class _Preview extends StatelessWidget {
  const _Preview({required this.theme});

  final CustomTheme theme;

  @override
  Widget build(BuildContext context) {
    if (theme.isDual) {
      return Row(
        children: [
          Expanded(child: _PreviewPanel(colors: theme.lightColors)),
          Expanded(child: _PreviewPanel(colors: theme.darkColors)),
        ],
      );
    }
    final side = theme.brightness == Brightness.dark
        ? theme.darkColors
        : theme.lightColors;
    return _PreviewPanel(colors: side);
  }
}

class _PreviewPanel extends StatelessWidget {
  const _PreviewPanel({required this.colors});

  final CustomThemeColors colors;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: colors.surface,
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            // Faux title strip.
            Container(
              width: 34,
              height: 6,
              decoration: BoxDecoration(
                color: colors.primary,
                borderRadius: const BorderRadius.all(UxnanRadius.full),
              ),
            ),
            Row(
              children: [
                _Swatch(colors.primary),
                _Swatch(colors.secondary),
                _Swatch(colors.tertiary),
              ],
            ),
            Text(
              'Aa',
              style: TextStyle(
                color: colors.onSurface,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch(this.color);

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 14,
      height: 14,
      margin: const EdgeInsets.only(right: UxnanSpacing.xs),
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

/// The per-card overflow menu (Edit / Export / Delete). Sits in the preview's
/// top-right; a translucent scrim keeps the glyph legible over any palette.
class _CardMenu extends StatelessWidget {
  const _CardMenu({
    required this.isBuiltIn,
    required this.onEdit,
    required this.onExport,
    required this.onDelete,
  });

  final bool isBuiltIn;
  final VoidCallback onEdit;
  final VoidCallback onExport;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return PopupMenuButton<_CardAction>(
      tooltip: l10n.personalizationCustomThemesHeader,
      // The menu sits over the preview's own colors (the dark side for a dual
      // theme). A fixed neutral grey reads on both light and dark surfaces —
      // the app's `onSurface` would vanish into the dark preview in light mode.
      icon: const Icon(
        Icons.more_vert_rounded,
        size: 18,
        color: Color(0xFF9AA0A6),
      ),
      onSelected: (action) => switch (action) {
        _CardAction.edit => onEdit(),
        _CardAction.export => onExport(),
        _CardAction.delete => onDelete(),
      },
      itemBuilder: (ctx) => [
        PopupMenuItem(
          value: _CardAction.edit,
          child: ListTile(
            leading: const Icon(Icons.edit_outlined),
            title: Text(l10n.personalizationCustomThemeEdit),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        PopupMenuItem(
          value: _CardAction.export,
          child: ListTile(
            leading: const Icon(Icons.upload_file_outlined),
            title: Text(l10n.personalizationCustomThemeExport),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        PopupMenuItem(
          value: _CardAction.delete,
          enabled: !isBuiltIn,
          child: ListTile(
            leading: Icon(
              Icons.delete_outline_rounded,
              color: isBuiltIn
                  ? colors.onSurfaceVariant.withValues(alpha: 0.38)
                  : colors.error,
            ),
            title: Text(
              l10n.personalizationCustomThemeDelete,
              style: TextStyle(
                color: isBuiltIn
                    ? colors.onSurface.withValues(alpha: 0.38)
                    : colors.error,
              ),
            ),
            contentPadding: EdgeInsets.zero,
          ),
        ),
      ],
    );
  }
}

class _SelectionDot extends StatelessWidget {
  const _SelectionDot({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color:
            selected ? colors.primary : colors.surface.withValues(alpha: 0.7),
        shape: BoxShape.circle,
        border: Border.all(color: colors.primary, width: 2),
      ),
      child: Icon(
        selected ? Icons.check_rounded : Icons.circle_outlined,
        size: 18,
        color: selected ? colors.onPrimary : Colors.transparent,
      ),
    );
  }
}

enum _ChipTone { neutral, primary }

class _Chip extends StatelessWidget {
  const _Chip({required this.label, this.tone = _ChipTone.neutral});

  final String label;
  final _ChipTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final bg = tone == _ChipTone.primary
        ? colors.primaryContainer
        : colors.surfaceContainerHigh;
    final fg = tone == _ChipTone.primary
        ? colors.onPrimaryContainer
        : colors.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: fg,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.palette_outlined,
              size: 40,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(height: UxnanSpacing.md),
            Text(title, style: textTheme.titleMedium),
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              body,
              textAlign: TextAlign.center,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Replaces whitespace + non-alphanumerics with hyphens and lowercases the
/// result. Empty input falls back to "theme" so the filename is never blank.
String _slugify(String input) {
  final lower = input.toLowerCase().trim();
  final replaced = lower.replaceAll(RegExp('[^a-z0-9]+'), '-');
  final trimmed = replaced.replaceAll(RegExp(r'^-+|-+$'), '');
  return trimmed.isEmpty ? 'theme' : trimmed;
}
