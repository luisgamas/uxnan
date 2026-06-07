import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';

/// Bottom sheet to start a new conversation: pick a project, an agent and an
/// optional model, then `thread/start`. Resolves with the new thread id (or
/// null if dismissed). Matches the conversation/git sheet patterns.
class NewConversationSheet extends ConsumerStatefulWidget {
  /// Creates a [NewConversationSheet].
  const NewConversationSheet({super.key});

  /// Shows the sheet and resolves with the started thread id (or null).
  static Future<String?> show(BuildContext context) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const NewConversationSheet(),
    );
  }

  @override
  ConsumerState<NewConversationSheet> createState() =>
      _NewConversationSheetState();
}

class _NewConversationSheetState extends ConsumerState<NewConversationSheet> {
  final TextEditingController _model = TextEditingController();
  Project? _project;
  AgentDescriptor? _agent;
  bool _modelTouched = false;
  bool _starting = false;

  @override
  void dispose() {
    _model.dispose();
    super.dispose();
  }

  /// Preselects the agent's default model unless the user typed their own.
  void _selectAgent(AgentDescriptor agent) {
    setState(() {
      _agent = agent;
      if (!_modelTouched) {
        _model.text = agent.defaultModel ?? '';
      }
    });
  }

  bool get _canStart => _project != null && _agent != null && !_starting;

  Future<void> _start() async {
    final project = _project;
    final agent = _agent;
    if (project == null || agent == null) return;
    setState(() => _starting = true);
    try {
      final thread = await ref.read(threadManagerProvider).startThread(
            projectId: project.id,
            agentId: agent.agentId,
            model: _model.text.trim(),
            cwd: project.cwd,
          );
      if (mounted) Navigator.of(context).pop(thread.id);
    } on Object {
      if (!mounted) return;
      setState(() => _starting = false);
      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context).newThreadFailed)),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    final projects = ref.watch(projectsProvider);
    final agents = ref.watch(agentsProvider);
    final agent = _agent;
    final models =
        agent != null ? ref.watch(agentModelsProvider(agent.agentId)) : null;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          left: UxnanSpacing.lg,
          right: UxnanSpacing.lg,
          bottom: UxnanSpacing.lg + bottomInset,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
                child: Text(
                  l10n.newThreadTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              _SectionHeader(label: l10n.newThreadProject),
              _ProjectPicker(
                projects: projects,
                selected: _project,
                onSelected: (p) => setState(() => _project = p),
              ),
              const SizedBox(height: UxnanSpacing.lg),
              _SectionHeader(label: l10n.newThreadAgent),
              _AgentPicker(
                agents: agents,
                selected: _agent,
                onSelected: _selectAgent,
              ),
              const SizedBox(height: UxnanSpacing.lg),
              _SectionHeader(label: l10n.newThreadModel),
              _ModelField(
                controller: _model,
                enabled: agent != null,
                models: models,
                onChanged: (_) => _modelTouched = true,
              ),
              const SizedBox(height: UxnanSpacing.lg),
              FilledButton.icon(
                onPressed: _canStart ? _start : null,
                icon: _starting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.send_rounded, size: 18),
                label: Text(l10n.newThreadStart),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProjectPicker extends StatelessWidget {
  const _ProjectPicker({
    required this.projects,
    required this.selected,
    required this.onSelected,
  });

  final AsyncValue<List<Project>> projects;
  final Project? selected;
  final ValueChanged<Project> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return projects.when(
      loading: () => const _Loading(),
      error: (_, __) => _Error(message: l10n.newThreadLoadFailed),
      data: (items) {
        if (items.isEmpty) return _Empty(message: l10n.newThreadNoProjects);
        return Column(
          children: [
            for (final project in items)
              _OptionTile(
                title: project.name,
                subtitle: project.cwd.isEmpty ? null : project.cwd,
                leading: const Icon(Icons.folder_outlined, size: 22),
                selected: project.id == selected?.id,
                onTap: () => onSelected(project),
              ),
          ],
        );
      },
    );
  }
}

class _AgentPicker extends StatelessWidget {
  const _AgentPicker({
    required this.agents,
    required this.selected,
    required this.onSelected,
  });

  final AsyncValue<List<AgentDescriptor>> agents;
  final AgentDescriptor? selected;
  final ValueChanged<AgentDescriptor> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return agents.when(
      loading: () => const _Loading(),
      error: (_, __) => _Error(message: l10n.newThreadLoadFailed),
      data: (items) {
        if (items.isEmpty) return _Empty(message: l10n.newThreadNoAgents);
        return Column(
          children: [
            for (final agent in items)
              _OptionTile(
                title: agent.displayName,
                subtitle: _capabilityHint(agent, l10n),
                leading: _AgentLeading(agentId: agent.agentId),
                selected: agent.agentId == selected?.agentId,
                enabled: agent.available,
                trailing: agent.available
                    ? null
                    : Text(
                        l10n.newThreadAgentUnavailable,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: UxnanColors.disconnected),
                      ),
                onTap: agent.available ? () => onSelected(agent) : null,
              ),
          ],
        );
      },
    );
  }

  String? _capabilityHint(AgentDescriptor agent, AppLocalizations l10n) {
    final caps = <String>[
      if (agent.capabilities.streaming) l10n.newThreadCapStreaming,
      if (agent.capabilities.planMode) l10n.newThreadCapPlan,
      if (agent.capabilities.approvals) l10n.newThreadCapApprovals,
      if (agent.capabilities.images) l10n.newThreadCapImages,
    ];
    return caps.isEmpty ? null : caps.join(' · ');
  }
}

class _AgentLeading extends StatelessWidget {
  const _AgentLeading({required this.agentId});
  final String agentId;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final agent = AgentIdParsing.fromWireId(agentId);
    final logo = AgentVisuals.logoFor(agent);
    if (logo != null) return AgentLogoChip(asset: logo, size: 40);
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.md),
        border: Border.all(color: colors.outline),
      ),
      child: Icon(
        Icons.smart_toy_outlined,
        size: 20,
        color: AgentVisuals.colorFor(agent),
      ),
    );
  }
}

/// Model picker. When the bridge reports models for the selected agent it shows
/// a filterable M3 [DropdownMenu] (the user can still type a custom id); while
/// loading or when no list is available it falls back to a free-text field.
class _ModelField extends StatelessWidget {
  const _ModelField({
    required this.controller,
    required this.enabled,
    required this.models,
    required this.onChanged,
  });

  final TextEditingController controller;
  final bool enabled;
  final AsyncValue<List<String>>? models;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final list = models?.asData?.value;
    if (enabled && list != null && list.isNotEmpty) {
      return DropdownMenu<String>(
        controller: controller,
        enableFilter: true,
        requestFocusOnTap: true,
        expandedInsets: EdgeInsets.zero,
        menuHeight: 320,
        hintText: AppLocalizations.of(context).newThreadModelHint,
        leadingIcon: const Icon(Icons.auto_awesome_outlined, size: 18),
        initialSelection: controller.text.isEmpty ? null : controller.text,
        onSelected: (value) => onChanged(value ?? ''),
        dropdownMenuEntries: [
          for (final model in list)
            DropdownMenuEntry<String>(value: model, label: model),
        ],
      );
    }
    return _ModelTextField(
      controller: controller,
      enabled: enabled,
      loading: models?.isLoading ?? false,
      onChanged: onChanged,
    );
  }
}

class _ModelTextField extends StatelessWidget {
  const _ModelTextField({
    required this.controller,
    required this.enabled,
    required this.loading,
    required this.onChanged,
  });

  final TextEditingController controller;
  final bool enabled;
  final bool loading;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    return Container(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.md,
        vertical: 2,
      ),
      child: TextField(
        controller: controller,
        enabled: enabled,
        onChanged: onChanged,
        style: Theme.of(context).textTheme.bodyMedium,
        decoration: InputDecoration(
          isCollapsed: true,
          border: InputBorder.none,
          contentPadding:
              const EdgeInsets.symmetric(vertical: UxnanSpacing.md),
          icon: Icon(
            Icons.auto_awesome_outlined,
            size: 18,
            color: colors.onSurfaceVariant,
          ),
          suffixIcon: loading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: Padding(
                    padding: EdgeInsets.all(4),
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : null,
          hintText: l10n.newThreadModelHint,
          hintStyle: TextStyle(color: colors.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.title,
    required this.leading,
    required this.selected,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.enabled = true,
  });

  final String title;
  final String? subtitle;
  final Widget leading;
  final Widget? trailing;
  final bool selected;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
      child: Opacity(
        opacity: enabled ? 1 : 0.5,
        child: Material(
          color: selected
              ? colors.primaryContainer.withValues(alpha: 0.4)
              : colors.surfaceContainerHighest,
          borderRadius: const BorderRadius.all(UxnanRadius.lg),
          child: InkWell(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(UxnanSpacing.md),
              child: Row(
                children: [
                  leading,
                  const SizedBox(width: UxnanSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: textTheme.titleSmall,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (subtitle != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            subtitle!,
                            style: UxnanTypography.codeSmall.copyWith(
                              color: colors.onSurfaceVariant,
                            ),
                            overflow: TextOverflow.ellipsis,
                            maxLines: 1,
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (trailing != null) ...[
                    const SizedBox(width: UxnanSpacing.sm),
                    trailing!,
                  ],
                  if (selected) ...[
                    const SizedBox(width: UxnanSpacing.sm),
                    Icon(Icons.check_rounded, color: colors.primary),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
      child: Text(
        label.toUpperCase(),
        style: textTheme.bodySmall?.copyWith(
          color: colors.onSurfaceVariant,
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.all(UxnanSpacing.lg),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
}

class _Empty extends StatelessWidget {
  const _Empty({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.md),
      child: Text(
        message,
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: colors.onSurfaceVariant),
      ),
    );
  }
}

class _Error extends StatelessWidget {
  const _Error({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.md),
      child: Row(
        children: [
          const Icon(Icons.error_outline, size: 18, color: UxnanColors.error),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}
