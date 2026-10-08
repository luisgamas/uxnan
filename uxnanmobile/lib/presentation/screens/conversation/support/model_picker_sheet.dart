import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Bottom sheet that lists the models the bridge reports for an agent
/// (`agent/models`), with a search filter, and resolves with the picked model
/// id (or null if dismissed).
class ModelPickerSheet extends ConsumerStatefulWidget {
  /// Creates a [ModelPickerSheet].
  const ModelPickerSheet({required this.agentId, this.current, super.key});

  /// Wire id of the agent whose models to list.
  final String agentId;

  /// Currently selected model, highlighted in the list.
  final String? current;

  /// Shows the sheet and resolves with the selected model id (or null).
  static Future<String?> show(
    BuildContext context, {
    required String agentId,
    String? current,
  }) {
    return showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => ModelPickerSheet(agentId: agentId, current: current),
    );
  }

  @override
  ConsumerState<ModelPickerSheet> createState() => _ModelPickerSheetState();
}

class _ModelPickerSheetState extends ConsumerState<ModelPickerSheet> {
  String _query = '';

  bool _matchesQuery(AgentModel m) =>
      m.displayName.toLowerCase().contains(_query) ||
      m.id.toLowerCase().contains(_query) ||
      (m.description?.toLowerCase().contains(_query) ?? false);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final modelsAsync = ref.watch(agentModelsProvider(widget.agentId));
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          left: UxnanSpacing.lg,
          right: UxnanSpacing.lg,
          bottom: UxnanSpacing.lg + bottomInset,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.modelPickerTitle,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  // Manual re-sync with the bridge, so a model added on the
                  // PC (after updating the bridge) shows without reconnecting.
                  IconButton(
                    onPressed: () =>
                        ref.invalidate(agentModelsProvider(widget.agentId)),
                    icon: const UxIcon(UxIcons.refresh, size: 20),
                    tooltip: l10n.modelPickerRefresh,
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ),
            TextField(
              autofocus: true,
              onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
              decoration: InputDecoration(
                isDense: true,
                prefixIcon: const UxIcon(UxIcons.search, size: 20),
                hintText: l10n.modelPickerSearchHint,
                filled: true,
                fillColor: colors.surfaceContainerHighest,
                border: OutlineInputBorder(
                  borderRadius: const BorderRadius.all(UxnanRadius.full),
                  borderSide: BorderSide(color: colors.outline),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: const BorderRadius.all(UxnanRadius.full),
                  borderSide: BorderSide(color: colors.outline),
                ),
              ),
            ),
            const SizedBox(height: UxnanSpacing.md),
            ConstrainedBox(
              // Cap to half the space above the keyboard so the sheet never
              // overflows; the list scrolls within it.
              constraints: BoxConstraints(
                maxHeight:
                    ((MediaQuery.sizeOf(context).height - bottomInset) * 0.5)
                        .clamp(140.0, MediaQuery.sizeOf(context).height),
              ),
              child: modelsAsync.when(
                loading: () => const Center(
                  child: Padding(
                    padding: EdgeInsets.all(UxnanSpacing.xl),
                    child: PolygonLoader(size: 28),
                  ),
                ),
                error: (_, __) => Padding(
                  padding: const EdgeInsets.all(UxnanSpacing.md),
                  child: Text(l10n.modelPickerLoadFailed),
                ),
                data: (models) {
                  return _ModelList(
                    models: _query.isEmpty
                        ? models
                        : models.where(_matchesQuery).toList(),
                    current: widget.current,
                    searching: _query.isNotEmpty,
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The models, grouped by provider, with the ones the CLI calls older
/// ([AgentModel.isLegacy]) folded under one "Older models" row at the end —
/// open from the start when the current model is one of them, and flat in
/// the results while searching.
class _ModelList extends StatefulWidget {
  const _ModelList({
    required this.models,
    required this.current,
    required this.searching,
  });

  final List<AgentModel> models;
  final String? current;
  final bool searching;

  @override
  State<_ModelList> createState() => _ModelListState();
}

class _ModelListState extends State<_ModelList> {
  late bool _olderOpen = widget.models.any(
    (m) => m.isLegacy && m.id == widget.current,
  );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final models = widget.models;
    if (models.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        child: Text(l10n.modelPickerEmpty),
      );
    }
    final older = [
      for (final m in models)
        if (m.isLegacy) m,
    ];
    final current = [
      for (final m in models)
        if (!m.isLegacy) m,
    ];
    final olderShown = _olderOpen || widget.searching;
    // Group by provider so big multi-provider agents (pi, OpenCode) read as
    // sections. A single group (Claude/Codex bare ids) renders flat: we skip
    // the headers and the per-row provider stripping.
    final groups = groupModelsByProvider(current);
    final grouped = groups.length > 1;
    // Flatten to a single lazy list of header (String) + model rows (+ the
    // fold), so even hundreds of models stay cheap to build.
    final entries = <Object>[];
    if (grouped) {
      for (final group in groups) {
        entries
          ..add(group.provider)
          ..addAll(group.models);
      }
    } else {
      entries.addAll(current);
    }
    if (older.isNotEmpty) {
      if (olderShown) {
        entries
          ..add(l10n.modelPickerOlder)
          ..addAll(older);
      } else {
        entries.add(_OlderFold(count: older.length));
      }
    }
    return ListView.builder(
      shrinkWrap: true,
      itemCount: entries.length,
      itemBuilder: (context, index) {
        final entry = entries[index];
        if (entry is String) return _ProviderHeader(provider: entry);
        if (entry is _OlderFold) {
          return _OlderFoldTile(
            count: entry.count,
            onTap: () => setState(() => _olderOpen = true),
          );
        }
        final model = entry as AgentModel;
        return _ModelTile(
          model: model,
          grouped: grouped,
          selected: model.id == widget.current,
        );
      },
    );
  }
}

/// The folded "Older models" row's place in the list.
class _OlderFold {
  const _OlderFold({required this.count});

  final int count;
}

/// "Older models · N", which unfolds them in place.
class _OlderFoldTile extends StatelessWidget {
  const _OlderFoldTile({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return ListTile(
      dense: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(UxnanRadius.md),
      ),
      title: Text(l10n.modelPickerOlder, style: textTheme.bodyMedium),
      subtitle: Text(
        l10n.modelPickerOlderCount(count),
        style: textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
      ),
      trailing: UxIcon(
        UxIcons.expandMore,
        size: 20,
        color: colors.onSurfaceVariant,
      ),
      onTap: onTap,
    );
  }
}

/// A provider section header (M3 list subheader) over its models.
class _ProviderHeader extends StatelessWidget {
  const _ProviderHeader({required this.provider});

  final String provider;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.sm,
        UxnanSpacing.md,
        UxnanSpacing.sm,
        UxnanSpacing.xs,
      ),
      child: Text(
        provider.toUpperCase(),
        style: textTheme.labelMedium?.copyWith(
          color: colors.primary,
          letterSpacing: 0.6,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _ModelTile extends StatelessWidget {
  const _ModelTile({
    required this.model,
    required this.grouped,
    required this.selected,
  });

  final AgentModel model;
  final bool grouped;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final slash = model.id.indexOf('/');
    // Under a provider header, drop the redundant `provider/` prefix when the
    // display name is just the wire id (OpenCode); pi already shows the bare
    // model name.
    final title = grouped && model.displayName == model.id && slash > 0
        ? model.id.substring(slash + 1)
        : model.displayName;
    // Secondary line: the resolved version (for aliases) and/or the wire id
    // when it differs from the shown title, then any description. The provider
    // is already in the header when grouped, so it's omitted there.
    final detail = <String>[
      if (model.version != null && model.version != model.id)
        model.version!
      else if (model.id != title)
        model.id,
      if (!grouped && model.description != null) model.description!,
    ].join(' · ');
    return ListTile(
      dense: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(UxnanRadius.md),
      ),
      selected: selected,
      selectedTileColor: colors.primaryContainer.withValues(alpha: 0.4),
      title: Row(
        children: [
          Flexible(
            child: Text(
              title,
              style: textTheme.bodyMedium,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (model.isDefault) ...[
            const SizedBox(width: UxnanSpacing.sm),
            _DefaultBadge(label: l10n.modelPickerDefault),
          ],
        ],
      ),
      subtitle: detail.isEmpty
          ? null
          : Text(
              detail,
              style: UxnanTypography.codeSmall.copyWith(
                color: colors.onSurfaceVariant,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
      trailing: selected
          ? UxIcon(UxIcons.check, color: colors.primary, size: 20)
          : null,
      onTap: () => Navigator.of(context).pop(model.id),
    );
  }
}

class _DefaultBadge extends StatelessWidget {
  const _DefaultBadge({required this.label});

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
        borderRadius: const BorderRadius.all(UxnanRadius.sm),
      ),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: colors.onSecondaryContainer),
      ),
    );
  }
}
