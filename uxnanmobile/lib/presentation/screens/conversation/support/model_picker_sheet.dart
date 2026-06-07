import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

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
              child: Text(
                l10n.modelPickerTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            TextField(
              autofocus: true,
              onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
              decoration: InputDecoration(
                isDense: true,
                prefixIcon: const Icon(Icons.search_rounded, size: 20),
                hintText: l10n.modelPickerSearchHint,
                filled: true,
                fillColor: colors.surfaceContainerHighest,
                border: OutlineInputBorder(
                  borderRadius: const BorderRadius.all(UxnanRadius.lg),
                  borderSide: BorderSide(color: colors.outline),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: const BorderRadius.all(UxnanRadius.lg),
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
                loading: () => const Padding(
                  padding: EdgeInsets.all(UxnanSpacing.lg),
                  child: Center(
                    child: SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                ),
                error: (_, __) => Padding(
                  padding: const EdgeInsets.all(UxnanSpacing.md),
                  child: Text(l10n.modelPickerLoadFailed),
                ),
                data: (models) => _ModelList(
                  models: _query.isEmpty
                      ? models
                      : models
                          .where((m) => m.toLowerCase().contains(_query))
                          .toList(),
                  current: widget.current,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModelList extends StatelessWidget {
  const _ModelList({required this.models, required this.current});

  final List<String> models;
  final String? current;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    if (models.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        child: Text(AppLocalizations.of(context).modelPickerEmpty),
      );
    }
    return ListView.builder(
      shrinkWrap: true,
      itemCount: models.length,
      itemBuilder: (context, index) {
        final model = models[index];
        final selected = model == current;
        return ListTile(
          dense: true,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(UxnanRadius.md),
          ),
          selected: selected,
          selectedTileColor: colors.primaryContainer.withValues(alpha: 0.4),
          title: Text(model, style: UxnanTypography.codeSmall),
          trailing: selected
              ? Icon(Icons.check_rounded, color: colors.primary, size: 20)
              : null,
          onTap: () => Navigator.of(context).pop(model),
        );
      },
    );
  }
}
