import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/settings/theme_export.dart';
import 'package:uxnan/presentation/screens/settings/theme_sheets.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/color_picker.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen editor for a [CustomTheme]. Drives every public Material 3
/// color role for both brightnesses, with import/export as JSON via the
/// system clipboard (no extra plugins — see [CustomTheme.toJsonString] and
/// [CustomTheme.fromJsonString] for the wire shape).
///
/// Persistence model: the editor owns a working copy of the theme. On
/// *Save* (or screen pop with unsaved changes) it commits via
/// [customThemesLibraryProvider]. The provider's `upsert` is the only
/// writer to the on-disk JSON — the library stays the single source of
/// truth, and the active-id selection is left untouched so editing the
/// active theme keeps it active after save.
class CustomThemeEditorScreen extends ConsumerStatefulWidget {
  /// Creates the editor starting from [initial]. Pass the user's current
  /// theme (or a fresh seed-derived one) when opening.
  /// [initialBrightness] selects which side of the role list is shown
  /// first; defaults to [Brightness.light].
  const CustomThemeEditorScreen({
    required this.initial,
    this.initialBrightness = Brightness.light,
    super.key,
  });

  /// The theme the editor opens with. Edited in place; persisted on save.
  final CustomTheme initial;

  /// The brightness tab the editor opens on. The picker doesn't change the
  /// applied theme — it's just the first side the user sees.
  final Brightness initialBrightness;

  /// Pushes the editor over [context] starting from [initial]. Returns
  /// the saved theme (or null if cancelled) so callers can chain follow-
  /// ups without re-reading the provider. [initialBrightness] selects
  /// which side of the role list is shown first (defaults to
  /// [Brightness.light]); pass it when the caller already knows the
  /// target brightness (e.g. the *+ New theme* dialog).
  static Future<CustomTheme?> push(
    BuildContext context, {
    required CustomTheme initial,
    Brightness initialBrightness = Brightness.light,
  }) async {
    return Navigator.of(context).push<CustomTheme?>(
      MaterialPageRoute<CustomTheme?>(
        builder: (_) => CustomThemeEditorScreen(
          initial: initial,
          initialBrightness: initialBrightness,
        ),
      ),
    );
  }

  @override
  ConsumerState<CustomThemeEditorScreen> createState() =>
      _CustomThemeEditorScreenState();
}

class _CustomThemeEditorScreenState
    extends ConsumerState<CustomThemeEditorScreen> {
  late CustomTheme _working;
  late Brightness _brightness;
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _working = widget.initial;
    // A single-brightness theme has only one editable side — open on it.
    _brightness =
        _working.isSingle ? _working.brightness : widget.initialBrightness;
    _nameController.text = _working.name;
    _descriptionController.text = _working.description;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  CustomThemeColors get _activeColors => switch (_brightness) {
        Brightness.light => _working.lightColors,
        Brightness.dark => _working.darkColors,
      };

  void _setActiveColors(CustomThemeColors next) {
    setState(() {
      _working = switch (_brightness) {
        Brightness.light => _working.withLightColors(next),
        Brightness.dark => _working.withDarkColors(next),
      };
    });
  }

  /// Promotes a single-brightness theme to dual by authoring the
  /// currently-derived opposite side, then switches the editor to it.
  void _addOtherSide() {
    final other = _working.brightness == Brightness.light
        ? Brightness.dark
        : Brightness.light;
    setState(() {
      _working = _working.withOtherSideDerived();
      _brightness = other;
    });
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    final description = _descriptionController.text.trim();
    var next = _working.withMetadata(
      name: name.isEmpty ? 'Custom theme' : name,
      description: description,
    );
    // Built-ins are shipped templates that are reconciled from code on every
    // load — editing one forks it into a new user theme instead of mutating
    // (and then silently losing) the shipped entry.
    if (isBuiltInCustomThemeId(next.id)) {
      next = next.withId(CustomTheme.freshId());
    }
    // Auto-activate a brand-new theme (its id is not yet in the library) so the
    // "+ New theme" → editor flow feels like a single gesture. We no longer
    // force the global theme mode: a single-brightness theme is forced to its
    // own side by `effectiveThemeModeProvider`, and a dual theme respects the
    // user's System/Light/Dark choice (which the editor must not clobber).
    final library = ref.read(customThemesLibraryProvider);
    final isNew = !library.any((t) => t.id == next.id);
    await ref.read(customThemesLibraryProvider.notifier).upsert(next);
    if (isNew) {
      await ref.read(activeCustomThemeIdProvider.notifier).set(next.id);
      await ref.read(useCustomThemeProvider.notifier).set(true);
    }
    if (mounted) Navigator.of(context).pop(next);
  }

  Future<void> _resetBrightness() async {
    final seed = _activeColors.primary;
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: _brightness,
    );
    setState(() {
      _working = switch (_brightness) {
        Brightness.light => _working.withLightColors(
            CustomThemeColors.fromScheme(scheme),
          ),
        Brightness.dark => _working.withDarkColors(
            CustomThemeColors.fromScheme(scheme),
          ),
      };
    });
  }

  Future<void> _deriveFromSeedSheet() async {
    final l10n = AppLocalizations.of(context);
    final seed = await ColorPickerSheet.show(
      context,
      initial: _activeColors.primary,
      title: l10n.customThemeEditorSeedHint,
    );
    if (seed == null || !mounted) return;
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: _brightness,
    );
    setState(() {
      _working = switch (_brightness) {
        Brightness.light => _working.withLightColors(
            CustomThemeColors.fromScheme(scheme),
          ),
        Brightness.dark => _working.withDarkColors(
            CustomThemeColors.fromScheme(scheme),
          ),
      };
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.customThemeEditorImported)),
      );
    }
  }

  Future<void> _exportSheet() async {
    final l10n = AppLocalizations.of(context);
    final text = _working.toJsonString();
    final choice = await showThemeExportSheet(
      context,
      title: l10n.customThemeEditorExportDialogTitle,
      copyLabel: l10n.personalizationCustomThemeExportCopy,
      fileLabel: l10n.personalizationCustomThemeExportFile,
    );
    if (choice == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    switch (choice) {
      case ThemeExportChoice.copy:
        await Clipboard.setData(ClipboardData(text: text));
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.customThemeEditorCopied)),
        );
      case ThemeExportChoice.file:
        final ok = await shareThemeJsonFile(
          fileName: 'uxnan-theme-${_slugify(_working.name)}.json',
          json: text,
          subject: _working.name,
        );
        if (!mounted) return;
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              ok
                  ? l10n.customThemeEditorSaved
                  : l10n.customThemeEditorSaveFailed,
            ),
          ),
        );
    }
  }

  Future<void> _importSheet() async {
    final l10n = AppLocalizations.of(context);
    final result = await showImportThemeSheet(
      context,
      title: l10n.customThemeEditorImportDialogTitle,
      body: l10n.customThemeEditorImportDialogBody,
      hint: l10n.customThemeEditorImportFieldHint,
    );
    if (result == null || result.trim().isEmpty) return;
    try {
      // Parse into separate light/dark sides so a single-brightness palette
      // patches only the side it describes (and a full theme replaces both).
      // Detection lives in [CustomTheme.parseImport] — native, Material Theme
      // Builder and flat single-scheme JSON are all understood.
      final parsed = CustomTheme.parseImport(result);
      setState(() {
        var next = _working;
        if (parsed.light != null) next = next.withLightColors(parsed.light!);
        if (parsed.dark != null) next = next.withDarkColors(parsed.dark!);
        // Preserve the current name/description; the imported file's metadata
        // is ignored — the user is customizing the existing theme.
        _working = next.withMetadata(
          name: _nameController.text,
          description: _descriptionController.text,
        );
        // A single-brightness import flips the visible tab to the side that
        // actually changed so the result is immediately visible.
        if (parsed.hasLight != parsed.hasDark) {
          _brightness = parsed.hasDark ? Brightness.dark : Brightness.light;
        }
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.customThemeEditorImported)),
      );
    } on Object catch (error, stackTrace) {
      AppLogger.warn('custom theme import failed', error, stackTrace);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.customThemeEditorImportFailed)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return NeScaffold(
      title: l10n.customThemeEditorTitle,
      actions: [
        IconSurface(
          icon: Icons.upload_file_outlined,
          tooltip: l10n.customThemeEditorExport,
          onPressed: _exportSheet,
        ),
        IconSurface(
          icon: Icons.download_outlined,
          tooltip: l10n.customThemeEditorImport,
          onPressed: _importSheet,
        ),
        const SizedBox(width: UxnanSpacing.xs),
      ],
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
              _NameField(
                controller: _nameController,
                label: l10n.customThemeEditorName,
                hint: l10n.customThemeEditorNameHint,
              ),
              const SizedBox(height: UxnanSpacing.md),
              _NameField(
                controller: _descriptionController,
                label: l10n.customThemeEditorDescription,
                hint: l10n.customThemeEditorDescriptionHint,
              ),
              const SizedBox(height: UxnanSpacing.xl),
              // The Light/Dark tabs only make sense for a dual theme. A single
              // theme shows its one side plus an affordance to add (and edit)
              // the other, which promotes it to dual.
              if (_working.isDual) ...[
                _BrightnessTabs(
                  brightness: _brightness,
                  onChanged: (b) => setState(() => _brightness = b),
                  lightLabel: l10n.customThemeEditorLight,
                  darkLabel: l10n.customThemeEditorDark,
                ),
                const SizedBox(height: UxnanSpacing.md),
              ] else ...[
                _SingleSideNotice(
                  brightness: _working.brightness,
                  onAddOtherSide: _addOtherSide,
                ),
                const SizedBox(height: UxnanSpacing.md),
              ],
              _RoleList(
                colors: _activeColors,
                onChanged: _setActiveColors,
                onResetBrightness: _resetBrightness,
                onDeriveFromSeed: _deriveFromSeedSheet,
                resetBrightnessLabel: l10n.customThemeEditorResetBrightness,
                deriveFromSeedLabel: l10n.customThemeEditorDeriveFromSeed,
              ),
              const SizedBox(height: UxnanSpacing.xl),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: colors.primary,
                  foregroundColor: colors.onPrimary,
                  minimumSize: const Size.fromHeight(48),
                ),
                icon: const Icon(Icons.check_rounded),
                label: const Text('Save'),
                onPressed: _save,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// A labeled text field used for the theme metadata (name + description).
class _NameField extends StatelessWidget {
  const _NameField({
    required this.controller,
    required this.label,
    required this.hint,
  });

  final TextEditingController controller;
  final String label;
  final String hint;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return TextField(
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        filled: true,
        fillColor: colors.surfaceContainerHigh,
        border: OutlineInputBorder(
          borderRadius: const BorderRadius.all(UxnanRadius.md),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.md,
          vertical: UxnanSpacing.md,
        ),
      ),
    );
  }
}

/// The Light / Dark tabs that swap which set of role colors the editor
/// shows. Selecting a tab is local state — it does not change the user's
/// theme until *Save*.
class _BrightnessTabs extends StatelessWidget {
  const _BrightnessTabs({
    required this.brightness,
    required this.onChanged,
    required this.lightLabel,
    required this.darkLabel,
  });

  final Brightness brightness;
  final ValueChanged<Brightness> onChanged;
  final String lightLabel;
  final String darkLabel;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<Brightness>(
        showSelectedIcon: false,
        segments: [
          ButtonSegment(
            value: Brightness.light,
            icon: const Icon(Icons.light_mode_outlined),
            label: Text(lightLabel),
          ),
          ButtonSegment(
            value: Brightness.dark,
            icon: const Icon(Icons.dark_mode_outlined),
            label: Text(darkLabel),
          ),
        ],
        selected: {brightness},
        onSelectionChanged: (s) => onChanged(s.first),
      ),
    );
  }
}

/// A scrollable, grouped list of color roles. Each row shows the role's
/// localized label, a color swatch, and the hex value; tapping the row
/// opens [ColorPickerSheet]. Reset / derive actions are exposed as small
/// text-buttons inside the card header.
class _RoleList extends StatelessWidget {
  const _RoleList({
    required this.colors,
    required this.onChanged,
    required this.onResetBrightness,
    required this.onDeriveFromSeed,
    required this.resetBrightnessLabel,
    required this.deriveFromSeedLabel,
  });

  final CustomThemeColors colors;
  final ValueChanged<CustomThemeColors> onChanged;
  final VoidCallback onResetBrightness;
  final VoidCallback onDeriveFromSeed;
  final String resetBrightnessLabel;
  final String deriveFromSeedLabel;

  static const List<_RoleGroup> _groups = [
    _RoleGroup('Primary', [
      _Role('primary', 'Primary'),
      _Role('onPrimary', 'On primary'),
      _Role('primaryContainer', 'Primary container'),
      _Role('onPrimaryContainer', 'On primary container'),
      _Role('primaryFixed', 'Primary fixed'),
      _Role('primaryFixedDim', 'Primary fixed dim'),
      _Role('onPrimaryFixed', 'On primary fixed'),
      _Role('onPrimaryFixedVariant', 'On primary fixed variant'),
    ]),
    _RoleGroup('Secondary', [
      _Role('secondary', 'Secondary'),
      _Role('onSecondary', 'On secondary'),
      _Role('secondaryContainer', 'Secondary container'),
      _Role('onSecondaryContainer', 'On secondary container'),
      _Role('secondaryFixed', 'Secondary fixed'),
      _Role('secondaryFixedDim', 'Secondary fixed dim'),
      _Role('onSecondaryFixed', 'On secondary fixed'),
      _Role('onSecondaryFixedVariant', 'On secondary fixed variant'),
    ]),
    _RoleGroup('Tertiary', [
      _Role('tertiary', 'Tertiary'),
      _Role('onTertiary', 'On tertiary'),
      _Role('tertiaryContainer', 'Tertiary container'),
      _Role('onTertiaryContainer', 'On tertiary container'),
      _Role('tertiaryFixed', 'Tertiary fixed'),
      _Role('tertiaryFixedDim', 'Tertiary fixed dim'),
      _Role('onTertiaryFixed', 'On tertiary fixed'),
      _Role('onTertiaryFixedVariant', 'On tertiary fixed variant'),
    ]),
    _RoleGroup('Error', [
      _Role('error', 'Error'),
      _Role('onError', 'On error'),
      _Role('errorContainer', 'Error container'),
      _Role('onErrorContainer', 'On error container'),
    ]),
    _RoleGroup('Surface', [
      _Role('surface', 'Surface'),
      _Role('onSurface', 'On surface'),
      _Role('surfaceDim', 'Surface dim'),
      _Role('surfaceBright', 'Surface bright'),
      _Role('surfaceContainerLowest', 'Surface container lowest'),
      _Role('surfaceContainerLow', 'Surface container low'),
      _Role('surfaceContainer', 'Surface container'),
      _Role('surfaceContainerHigh', 'Surface container high'),
      _Role('surfaceContainerHighest', 'Surface container highest'),
      _Role('onSurfaceVariant', 'On surface variant'),
    ]),
    _RoleGroup('Outline & inverse', [
      _Role('outline', 'Outline'),
      _Role('outlineVariant', 'Outline variant'),
      _Role('inverseSurface', 'Inverse surface'),
      _Role('onInverseSurface', 'On inverse surface'),
      _Role('inversePrimary', 'Inverse primary'),
      _Role('shadow', 'Shadow'),
      _Role('scrim', 'Scrim'),
      _Role('surfaceTint', 'Surface tint'),
    ]),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final group in _groups) ...[
          _GroupHeader(label: group.label),
          const SizedBox(height: UxnanSpacing.xs),
          _RoleCard(
            roles: group.roles,
            colors: colors,
            onChanged: onChanged,
          ),
          const SizedBox(height: UxnanSpacing.lg),
        ],
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onResetBrightness,
                icon: const Icon(Icons.refresh_rounded),
                label: Text(resetBrightnessLabel),
              ),
            ),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: FilledButton.tonalIcon(
                onPressed: onDeriveFromSeed,
                icon: const Icon(Icons.auto_awesome_outlined),
                label: Text(deriveFromSeedLabel),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _RoleGroup {
  const _RoleGroup(this.label, this.roles);
  final String label;
  final List<_Role> roles;
}

class _Role {
  const _Role(this.key, this.label);
  final String key;
  final String label;
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({required this.label});
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

/// The card of role rows for a single group. Each row is a tap target that
/// opens [ColorPickerSheet]; edits patch [colors] via [onChanged] without
/// disturbing the other groups.
class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.roles,
    required this.colors,
    required this.onChanged,
  });

  final List<_Role> roles;
  final CustomThemeColors colors;
  final ValueChanged<CustomThemeColors> onChanged;

  Color _valueOf(String key) => switch (key) {
        'primary' => colors.primary,
        'onPrimary' => colors.onPrimary,
        'primaryContainer' => colors.primaryContainer,
        'onPrimaryContainer' => colors.onPrimaryContainer,
        'primaryFixed' => colors.primaryFixed,
        'primaryFixedDim' => colors.primaryFixedDim,
        'onPrimaryFixed' => colors.onPrimaryFixed,
        'onPrimaryFixedVariant' => colors.onPrimaryFixedVariant,
        'secondary' => colors.secondary,
        'onSecondary' => colors.onSecondary,
        'secondaryContainer' => colors.secondaryContainer,
        'onSecondaryContainer' => colors.onSecondaryContainer,
        'secondaryFixed' => colors.secondaryFixed,
        'secondaryFixedDim' => colors.secondaryFixedDim,
        'onSecondaryFixed' => colors.onSecondaryFixed,
        'onSecondaryFixedVariant' => colors.onSecondaryFixedVariant,
        'tertiary' => colors.tertiary,
        'onTertiary' => colors.onTertiary,
        'tertiaryContainer' => colors.tertiaryContainer,
        'onTertiaryContainer' => colors.onTertiaryContainer,
        'tertiaryFixed' => colors.tertiaryFixed,
        'tertiaryFixedDim' => colors.tertiaryFixedDim,
        'onTertiaryFixed' => colors.onTertiaryFixed,
        'onTertiaryFixedVariant' => colors.onTertiaryFixedVariant,
        'error' => colors.error,
        'onError' => colors.onError,
        'errorContainer' => colors.errorContainer,
        'onErrorContainer' => colors.onErrorContainer,
        'surface' => colors.surface,
        'onSurface' => colors.onSurface,
        'surfaceDim' => colors.surfaceDim,
        'surfaceBright' => colors.surfaceBright,
        'surfaceContainerLowest' => colors.surfaceContainerLowest,
        'surfaceContainerLow' => colors.surfaceContainerLow,
        'surfaceContainer' => colors.surfaceContainer,
        'surfaceContainerHigh' => colors.surfaceContainerHigh,
        'surfaceContainerHighest' => colors.surfaceContainerHighest,
        'onSurfaceVariant' => colors.onSurfaceVariant,
        'outline' => colors.outline,
        'outlineVariant' => colors.outlineVariant,
        'inverseSurface' => colors.inverseSurface,
        'onInverseSurface' => colors.onInverseSurface,
        'inversePrimary' => colors.inversePrimary,
        'shadow' => colors.shadow,
        'scrim' => colors.scrim,
        'surfaceTint' => colors.surfaceTint,
        _ => colors.primary,
      };

  CustomThemeColors _withRole(
    CustomThemeColors c,
    String key,
    Color value,
  ) {
    return switch (key) {
      'primary' => _patch(c, primary: value),
      'onPrimary' => _patch(c, onPrimary: value),
      'primaryContainer' => _patch(c, primaryContainer: value),
      'onPrimaryContainer' => _patch(c, onPrimaryContainer: value),
      'primaryFixed' => _patch(c, primaryFixed: value),
      'primaryFixedDim' => _patch(c, primaryFixedDim: value),
      'onPrimaryFixed' => _patch(c, onPrimaryFixed: value),
      'onPrimaryFixedVariant' => _patch(c, onPrimaryFixedVariant: value),
      'secondary' => _patch(c, secondary: value),
      'onSecondary' => _patch(c, onSecondary: value),
      'secondaryContainer' => _patch(c, secondaryContainer: value),
      'onSecondaryContainer' => _patch(c, onSecondaryContainer: value),
      'secondaryFixed' => _patch(c, secondaryFixed: value),
      'secondaryFixedDim' => _patch(c, secondaryFixedDim: value),
      'onSecondaryFixed' => _patch(c, onSecondaryFixed: value),
      'onSecondaryFixedVariant' => _patch(c, onSecondaryFixedVariant: value),
      'tertiary' => _patch(c, tertiary: value),
      'onTertiary' => _patch(c, onTertiary: value),
      'tertiaryContainer' => _patch(c, tertiaryContainer: value),
      'onTertiaryContainer' => _patch(c, onTertiaryContainer: value),
      'tertiaryFixed' => _patch(c, tertiaryFixed: value),
      'tertiaryFixedDim' => _patch(c, tertiaryFixedDim: value),
      'onTertiaryFixed' => _patch(c, onTertiaryFixed: value),
      'onTertiaryFixedVariant' => _patch(c, onTertiaryFixedVariant: value),
      'error' => _patch(c, error: value),
      'onError' => _patch(c, onError: value),
      'errorContainer' => _patch(c, errorContainer: value),
      'onErrorContainer' => _patch(c, onErrorContainer: value),
      'surface' => _patch(c, surface: value),
      'onSurface' => _patch(c, onSurface: value),
      'surfaceDim' => _patch(c, surfaceDim: value),
      'surfaceBright' => _patch(c, surfaceBright: value),
      'surfaceContainerLowest' => _patch(c, surfaceContainerLowest: value),
      'surfaceContainerLow' => _patch(c, surfaceContainerLow: value),
      'surfaceContainer' => _patch(c, surfaceContainer: value),
      'surfaceContainerHigh' => _patch(c, surfaceContainerHigh: value),
      'surfaceContainerHighest' => _patch(c, surfaceContainerHighest: value),
      'onSurfaceVariant' => _patch(c, onSurfaceVariant: value),
      'outline' => _patch(c, outline: value),
      'outlineVariant' => _patch(c, outlineVariant: value),
      'inverseSurface' => _patch(c, inverseSurface: value),
      'onInverseSurface' => _patch(c, onInverseSurface: value),
      'inversePrimary' => _patch(c, inversePrimary: value),
      'shadow' => _patch(c, shadow: value),
      'scrim' => _patch(c, scrim: value),
      'surfaceTint' => _patch(c, surfaceTint: value),
      _ => c,
    };
  }

  /// Copy-with for the fields that don't need their own switch arm
  /// (most of them). [CustomThemeColors] itself is a const data class with
  /// no `copyWith`, so this is the editor's lightweight equivalent.
  CustomThemeColors _patch(
    CustomThemeColors c, {
    Color? primary,
    Color? onPrimary,
    Color? primaryContainer,
    Color? onPrimaryContainer,
    Color? primaryFixed,
    Color? primaryFixedDim,
    Color? onPrimaryFixed,
    Color? onPrimaryFixedVariant,
    Color? secondary,
    Color? onSecondary,
    Color? secondaryContainer,
    Color? onSecondaryContainer,
    Color? secondaryFixed,
    Color? secondaryFixedDim,
    Color? onSecondaryFixed,
    Color? onSecondaryFixedVariant,
    Color? tertiary,
    Color? onTertiary,
    Color? tertiaryContainer,
    Color? onTertiaryContainer,
    Color? tertiaryFixed,
    Color? tertiaryFixedDim,
    Color? onTertiaryFixed,
    Color? onTertiaryFixedVariant,
    Color? error,
    Color? onError,
    Color? errorContainer,
    Color? onErrorContainer,
    Color? surface,
    Color? onSurface,
    Color? surfaceDim,
    Color? surfaceBright,
    Color? surfaceContainerLowest,
    Color? surfaceContainerLow,
    Color? surfaceContainer,
    Color? surfaceContainerHigh,
    Color? surfaceContainerHighest,
    Color? onSurfaceVariant,
    Color? outline,
    Color? outlineVariant,
    Color? inverseSurface,
    Color? onInverseSurface,
    Color? inversePrimary,
    Color? shadow,
    Color? scrim,
    Color? surfaceTint,
  }) {
    return CustomThemeColors(
      primary: primary ?? c.primary,
      onPrimary: onPrimary ?? c.onPrimary,
      primaryContainer: primaryContainer ?? c.primaryContainer,
      onPrimaryContainer: onPrimaryContainer ?? c.onPrimaryContainer,
      primaryFixed: primaryFixed ?? c.primaryFixed,
      primaryFixedDim: primaryFixedDim ?? c.primaryFixedDim,
      onPrimaryFixed: onPrimaryFixed ?? c.onPrimaryFixed,
      onPrimaryFixedVariant: onPrimaryFixedVariant ?? c.onPrimaryFixedVariant,
      secondary: secondary ?? c.secondary,
      onSecondary: onSecondary ?? c.onSecondary,
      secondaryContainer: secondaryContainer ?? c.secondaryContainer,
      onSecondaryContainer: onSecondaryContainer ?? c.onSecondaryContainer,
      secondaryFixed: secondaryFixed ?? c.secondaryFixed,
      secondaryFixedDim: secondaryFixedDim ?? c.secondaryFixedDim,
      onSecondaryFixed: onSecondaryFixed ?? c.onSecondaryFixed,
      onSecondaryFixedVariant:
          onSecondaryFixedVariant ?? c.onSecondaryFixedVariant,
      tertiary: tertiary ?? c.tertiary,
      onTertiary: onTertiary ?? c.onTertiary,
      tertiaryContainer: tertiaryContainer ?? c.tertiaryContainer,
      onTertiaryContainer: onTertiaryContainer ?? c.onTertiaryContainer,
      tertiaryFixed: tertiaryFixed ?? c.tertiaryFixed,
      tertiaryFixedDim: tertiaryFixedDim ?? c.tertiaryFixedDim,
      onTertiaryFixed: onTertiaryFixed ?? c.onTertiaryFixed,
      onTertiaryFixedVariant:
          onTertiaryFixedVariant ?? c.onTertiaryFixedVariant,
      error: error ?? c.error,
      onError: onError ?? c.onError,
      errorContainer: errorContainer ?? c.errorContainer,
      onErrorContainer: onErrorContainer ?? c.onErrorContainer,
      surface: surface ?? c.surface,
      onSurface: onSurface ?? c.onSurface,
      surfaceDim: surfaceDim ?? c.surfaceDim,
      surfaceBright: surfaceBright ?? c.surfaceBright,
      surfaceContainerLowest:
          surfaceContainerLowest ?? c.surfaceContainerLowest,
      surfaceContainerLow: surfaceContainerLow ?? c.surfaceContainerLow,
      surfaceContainer: surfaceContainer ?? c.surfaceContainer,
      surfaceContainerHigh: surfaceContainerHigh ?? c.surfaceContainerHigh,
      surfaceContainerHighest:
          surfaceContainerHighest ?? c.surfaceContainerHighest,
      onSurfaceVariant: onSurfaceVariant ?? c.onSurfaceVariant,
      outline: outline ?? c.outline,
      outlineVariant: outlineVariant ?? c.outlineVariant,
      inverseSurface: inverseSurface ?? c.inverseSurface,
      onInverseSurface: onInverseSurface ?? c.onInverseSurface,
      inversePrimary: inversePrimary ?? c.inversePrimary,
      shadow: shadow ?? c.shadow,
      scrim: scrim ?? c.scrim,
      surfaceTint: surfaceTint ?? c.surfaceTint,
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < roles.length; i++) ...[
            if (i > 0) Divider(height: 1, color: scheme.outlineVariant),
            _RoleRow(
              role: roles[i],
              value: _valueOf(roles[i].key),
              onPicked: (color) =>
                  onChanged(_withRole(colors, roles[i].key, color)),
            ),
          ],
        ],
      ),
    );
  }
}

/// A single role row inside [_RoleCard].
class _RoleRow extends StatelessWidget {
  const _RoleRow({
    required this.role,
    required this.value,
    required this.onPicked,
  });

  final _Role role;
  final Color value;
  final ValueChanged<Color> onPicked;

  String _hex(Color color) {
    final r = (color.r * 255.0).round() & 0xFF;
    final g = (color.g * 255.0).round() & 0xFF;
    final b = (color.b * 255.0).round() & 0xFF;
    String two(int n) => n.toRadixString(16).padLeft(2, '0').toUpperCase();
    return '#${two(r)}${two(g)}${two(b)}';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: () async {
        final picked = await ColorPickerSheet.show(
          context,
          initial: value,
          title: role.label,
        );
        if (picked != null) onPicked(picked);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.md,
          vertical: UxnanSpacing.md,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                role.label,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Text(
              _hex(value),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontFamily: 'JetBrainsMono',
                  ),
            ),
            const SizedBox(width: UxnanSpacing.md),
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: value,
                shape: BoxShape.circle,
                border: Border.all(
                  color: scheme.outline.withValues(alpha: 0.5),
                  width: 1,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shown in the editor when the theme defines only one brightness side: a note
/// explaining the other side is auto-generated, plus an affordance to author
/// (and then edit) it — promoting the theme to dual.
class _SingleSideNotice extends StatelessWidget {
  const _SingleSideNotice({
    required this.brightness,
    required this.onAddOtherSide,
  });

  final Brightness brightness;
  final VoidCallback onAddOtherSide;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final isLight = brightness == Brightness.light;
    final sideLabel = isLight ? l10n.themeLight : l10n.themeDark;
    final addLabel = isLight
        ? l10n.customThemeEditorAddDarkSide
        : l10n.customThemeEditorAddLightSide;
    return Container(
      padding: const EdgeInsets.all(UxnanSpacing.md),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                isLight ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
                size: 18,
                color: colors.onSurfaceVariant,
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Text(
                  l10n.customThemeEditorSingleNote(sideLabel),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                ),
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.md),
          FilledButton.tonalIcon(
            onPressed: onAddOtherSide,
            icon: const Icon(Icons.add_rounded),
            label: Text(addLabel),
          ),
        ],
      ),
    );
  }
}

/// Replaces whitespace + non-alphanumerics with hyphens and lowercases the
/// result. Empty input falls back to "theme" so the filename is never
/// blank. Used by the export-to-file flow.
String _slugify(String input) {
  final lower = input.toLowerCase().trim();
  final replaced = lower.replaceAll(RegExp(r'[^a-z0-9]+'), '-');
  final trimmed = replaced.replaceAll(RegExp(r'^-+|-+$'), '');
  return trimmed.isEmpty ? 'theme' : trimmed;
}
