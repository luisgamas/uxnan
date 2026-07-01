import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/prompt_template.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Settings screen that manages the user's `/` command-palette prompt
/// templates: create, edit, delete and reset to the shipped defaults. Templates
/// are single-language (whatever the user types) and persist locally.
class PromptTemplatesScreen extends ConsumerWidget {
  /// Creates a [PromptTemplatesScreen].
  const PromptTemplatesScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const PromptTemplatesScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final templates = ref.watch(promptTemplatesLibraryProvider);
    final library = ref.read(promptTemplatesLibraryProvider.notifier);

    return NeScaffold(
      title: l10n.promptTemplatesTitle,
      // Primary "create" action — the same M3 extended FAB the threads list
      // uses for "New conversation" (icon + label), not the circular
      // back-to-top affordance.
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(context, ref),
        icon: const Icon(Icons.note_add_outlined),
        label: Text(l10n.promptTemplatesAdd),
      ),
      actions: [
        if (templates.isNotEmpty)
          IconSurface(
            icon: Icons.restart_alt_rounded,
            tooltip: l10n.promptTemplatesReset,
            onPressed: () => _confirmReset(context, library),
          ),
      ],
      slivers: [
        if (templates.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: _EmptyState(onAdd: () => _edit(context, ref)),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.xxl,
            ),
            // Dynamic-corner card list (NE §4.6): a tight 3 dp gap + 24/4 radii
            // read the templates as one cohesive group.
            sliver: SliverList.separated(
              itemCount: templates.length,
              separatorBuilder: (_, __) => const SizedBox(height: 3),
              itemBuilder: (context, index) {
                final template = templates[index];
                return _TemplateCard(
                  template: template,
                  position: _positionFor(index, templates.length),
                  onEdit: () => _edit(context, ref, existing: template),
                  onDelete: () => _confirmDelete(context, library, template),
                );
              },
            ),
          ),
      ],
    );
  }

  /// Opens the editor sheet for a new or [existing] template and applies the
  /// result to the library.
  Future<void> _edit(
    BuildContext context,
    WidgetRef ref, {
    PromptTemplate? existing,
  }) async {
    final result = await showModalBottomSheet<PromptTemplate>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Theme.of(context).colorScheme.surfaceContainerHigh,
      builder: (_) => _TemplateEditorSheet(existing: existing),
    );
    if (result == null) return;
    final library = ref.read(promptTemplatesLibraryProvider.notifier);
    if (existing == null) {
      await library.add(result);
    } else {
      await library.update(result);
    }
  }

  Future<void> _confirmDelete(
    BuildContext context,
    PromptTemplatesLibrary library,
    PromptTemplate template,
  ) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(l10n.promptTemplatesDeleteTitle),
        content: Text(l10n.promptTemplatesDeleteBody(template.label)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.promptTemplatesDeleteConfirm),
          ),
        ],
      ),
    );
    if (ok ?? false) await library.remove(template.id);
  }

  Future<void> _confirmReset(
    BuildContext context,
    PromptTemplatesLibrary library,
  ) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(l10n.promptTemplatesResetTitle),
        content: Text(l10n.promptTemplatesResetBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.promptTemplatesReset),
          ),
        ],
      ),
    );
    if (ok ?? false) await library.resetToDefaults();
  }
}

/// The [CardGroupPosition] for item [index] in a list of [count] cards.
CardGroupPosition _positionFor(int index, int count) {
  if (count == 1) return CardGroupPosition.single;
  if (index == 0) return CardGroupPosition.first;
  if (index == count - 1) return CardGroupPosition.last;
  return CardGroupPosition.middle;
}

/// A single template row: its label + a one-line body preview, with edit
/// (whole-tile tap) and delete affordances. Rendered as a dynamic-corner
/// [ExpressiveCard] so the list reads as one cohesive group.
class _TemplateCard extends StatelessWidget {
  const _TemplateCard({
    required this.template,
    required this.position,
    required this.onEdit,
    required this.onDelete,
  });

  final PromptTemplate template;
  final CardGroupPosition position;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return ExpressiveCard(
      position: position,
      color: colors.surfaceContainer,
      onTap: onEdit,
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.md,
        UxnanSpacing.sm,
        UxnanSpacing.xs,
        UxnanSpacing.sm,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  template.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(
                  template.body,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.bodySmall
                      ?.copyWith(color: colors.onSurfaceVariant),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded),
            tooltip: l10n.promptTemplatesDeleteConfirm,
            color: colors.onSurfaceVariant,
            onPressed: onDelete,
          ),
        ],
      ),
    );
  }
}

/// Centered empty state (no templates) with a quick "add" action.
class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onAdd});
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.all(UxnanSpacing.xl),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.notes_rounded, size: 56, color: colors.onSurfaceVariant),
          const SizedBox(height: UxnanSpacing.lg),
          Text(
            l10n.promptTemplatesEmpty,
            style: textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: UxnanSpacing.sm),
          Text(
            l10n.promptTemplatesEmptyBody,
            style: textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: UxnanSpacing.lg),
          FilledButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.add_rounded),
            label: Text(l10n.promptTemplatesAdd),
          ),
        ],
      ),
    );
  }
}

/// Bottom-sheet editor for a single template: a label + a multi-line body. Pops
/// the navigator with the resulting [PromptTemplate], or null on cancel.
class _TemplateEditorSheet extends StatefulWidget {
  const _TemplateEditorSheet({this.existing});
  final PromptTemplate? existing;

  @override
  State<_TemplateEditorSheet> createState() => _TemplateEditorSheetState();
}

class _TemplateEditorSheetState extends State<_TemplateEditorSheet> {
  late final TextEditingController _label =
      TextEditingController(text: widget.existing?.label ?? '');
  late final TextEditingController _body =
      TextEditingController(text: widget.existing?.body ?? '');
  bool _valid = false;

  @override
  void initState() {
    super.initState();
    _valid = _compute();
    _label.addListener(_revalidate);
    _body.addListener(_revalidate);
  }

  @override
  void dispose() {
    _label.dispose();
    _body.dispose();
    super.dispose();
  }

  bool _compute() =>
      _label.text.trim().isNotEmpty && _body.text.trim().isNotEmpty;

  void _revalidate() {
    final next = _compute();
    if (next != _valid) setState(() => _valid = next);
  }

  void _save() {
    if (!_valid) return;
    final existing = widget.existing;
    // A new template gets a stable, collision-proof id; an edit keeps its id.
    final id = existing?.id ??
        'tpl-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
    Navigator.of(context).pop(
      PromptTemplate(
        id: id,
        label: _label.text.trim(),
        body: _body.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          UxnanSpacing.lg + bottomInset,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: UxnanSpacing.md),
              child: Text(
                widget.existing == null
                    ? l10n.promptTemplatesNewTitle
                    : l10n.promptTemplatesEditTitle,
                style: textTheme.titleMedium,
              ),
            ),
            TextField(
              controller: _label,
              autofocus: widget.existing == null,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: l10n.promptTemplatesLabelField,
                hintText: l10n.promptTemplatesLabelHint,
              ),
            ),
            const SizedBox(height: UxnanSpacing.md),
            TextField(
              controller: _body,
              minLines: 3,
              maxLines: 8,
              decoration: InputDecoration(
                labelText: l10n.promptTemplatesBodyField,
                hintText: l10n.promptTemplatesBodyHint,
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: UxnanSpacing.lg),
            FilledButton(
              onPressed: _valid ? _save : null,
              child: Text(l10n.actionSave),
            ),
          ],
        ),
      ),
    );
  }
}
