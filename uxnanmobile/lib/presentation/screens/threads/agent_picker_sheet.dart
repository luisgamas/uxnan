import 'package:flutter/material.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';

/// Bottom sheet that lists the wired agents **alphabetically**, with a search
/// filter, and resolves with the picked agent's wire id (or null if dismissed).
///
/// The combobox-style agent field on the New-conversation screen opens this; it
/// mirrors the model picker sheet so the agent and model pickers feel identical
/// and both scale as their lists grow. Unavailable agents are shown but dimmed
/// and not selectable.
class AgentPickerSheet extends StatefulWidget {
  /// Creates an [AgentPickerSheet].
  const AgentPickerSheet({required this.agents, this.selectedId, super.key});

  /// The agents to choose from (any order; sorted alphabetically for display).
  final List<AgentDescriptor> agents;

  /// Wire id of the currently-selected agent, highlighted in the list.
  final String? selectedId;

  /// Shows the sheet and resolves with the selected agent's wire id (or null).
  static Future<String?> show(
    BuildContext context, {
    required List<AgentDescriptor> agents,
    String? selectedId,
  }) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => AgentPickerSheet(agents: agents, selectedId: selectedId),
    );
  }

  @override
  State<AgentPickerSheet> createState() => _AgentPickerSheetState();
}

class _AgentPickerSheetState extends State<AgentPickerSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    // Alphabetical by display name (case-insensitive), then filtered by query.
    final sorted = [...widget.agents]..sort(
        (a, b) => a.displayName.toLowerCase().compareTo(
              b.displayName.toLowerCase(),
            ),
      );
    final visible = _query.isEmpty
        ? sorted
        : sorted
            .where(
              (a) =>
                  a.displayName.toLowerCase().contains(_query) ||
                  a.agentId.toLowerCase().contains(_query),
            )
            .toList();

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
                l10n.agentPickerTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            TextField(
              autofocus: true,
              onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
              decoration: InputDecoration(
                isDense: true,
                prefixIcon: const Icon(Icons.search_rounded, size: 20),
                hintText: l10n.agentPickerSearchHint,
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
              constraints: BoxConstraints(
                maxHeight:
                    ((MediaQuery.sizeOf(context).height - bottomInset) * 0.5)
                        .clamp(140.0, MediaQuery.sizeOf(context).height),
              ),
              child: visible.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(UxnanSpacing.md),
                      child: Text(l10n.newThreadNoAgents),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: visible.length,
                      itemBuilder: (context, i) => _AgentRow(
                        agent: visible[i],
                        selected: visible[i].agentId == widget.selectedId,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One agent row in the picker: logo + name, a selected check, and an
/// availability/sign-in hint. Unavailable agents are dimmed and not tappable.
class _AgentRow extends StatelessWidget {
  const _AgentRow({required this.agent, required this.selected});

  final AgentDescriptor agent;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final id = AgentIdParsing.fromWireId(agent.agentId);
    final logo = AgentVisuals.logoFor(id);

    return Opacity(
      opacity: agent.available ? 1 : 0.5,
      child: ListTile(
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(UxnanRadius.md),
        ),
        selected: selected,
        selectedTileColor: colors.primaryContainer.withValues(alpha: 0.4),
        leading: logo != null
            ? AgentLogoChip(asset: logo, size: 32)
            : Icon(Icons.smart_toy_outlined, color: AgentVisuals.colorFor(id)),
        title: Text(
          agent.displayName,
          style: textTheme.bodyLarge,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: agent.available
            ? null
            : Text(
                l10n.newThreadAgentUnavailable,
                style: textTheme.bodySmall
                    ?.copyWith(color: UxnanColors.disconnected),
              ),
        trailing: selected
            ? Icon(Icons.check_rounded, color: colors.primary, size: 20)
            : null,
        onTap: agent.available
            ? () => Navigator.of(context).pop(agent.agentId)
            : null,
      ),
    );
  }
}
