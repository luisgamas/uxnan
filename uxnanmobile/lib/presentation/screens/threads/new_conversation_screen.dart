import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/threads/workspace_browser_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';

/// Full-screen Material 3 dialog to start a new conversation: pick the working
/// directory (defaults to the bridge's root; "Browse…" to descend), an agent
/// (cards with logo, name and capability chips), and an optional model. A
/// roomier surface than a bottom sheet for a multi-input creation task with
/// several agents to compare. Resolves with the new thread id (or null).
class NewConversationScreen extends ConsumerStatefulWidget {
  /// Creates a [NewConversationScreen].
  const NewConversationScreen({super.key});

  /// Pushes the screen as a full-screen dialog; resolves with the thread id.
  static Future<String?> show(BuildContext context) {
    return Navigator.of(context).push<String>(
      MaterialPageRoute<String>(
        fullscreenDialog: true,
        builder: (_) => const NewConversationScreen(),
      ),
    );
  }

  @override
  ConsumerState<NewConversationScreen> createState() =>
      _NewConversationScreenState();
}

class _NewConversationScreenState extends ConsumerState<NewConversationScreen> {
  final TextEditingController _model = TextEditingController();
  Project? _project;
  AgentDescriptor? _agent;
  bool _modelTouched = false;
  bool _starting = false;

  /// Absolute working dir chosen via the folder browser (overrides the default
  /// project root); null = use the default root.
  String? _browsedCwd;

  @override
  void dispose() {
    _model.dispose();
    super.dispose();
  }

  void _selectAgent(AgentDescriptor agent) {
    setState(() {
      _agent = agent;
      if (!_modelTouched) _model.text = agent.defaultModel ?? '';
    });
  }

  /// Opens the folder browser; the chosen directory is resolved to a project
  /// (`project/resolve`) and used as the thread's working directory.
  Future<void> _browseFolder() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final cwd = await WorkspaceBrowserSheet.show(context);
    if (cwd == null || !mounted) return;
    final project = await ref.read(threadManagerProvider).resolveProject(cwd);
    if (!mounted) return;
    if (project == null) {
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.newThreadLoadFailed)));
      return;
    }
    setState(() {
      _project = project;
      _browsedCwd = cwd;
    });
  }

  Future<void> _start(Project project, String? cwd) async {
    final agent = _agent;
    if (agent == null) return;
    setState(() => _starting = true);
    try {
      final coordinator = ref.read(sessionCoordinatorProvider);
      // Tag with the PC we actually hold a live channel to.
      final deviceId = coordinator.connectedDevice?.macDeviceId;
      final thread = await ref.read(threadManagerProvider).startThread(
            projectId: project.id,
            agentId: agent.agentId,
            model: _model.text.trim(),
            cwd: cwd ?? project.cwd,
            deviceId: deviceId,
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

  static String _basename(String path) {
    final parts =
        path.split(RegExp(r'[\\/]')).where((s) => s.isNotEmpty).toList();
    return parts.isEmpty ? path : parts.last;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;

    final projects = ref.watch(projectsProvider);
    final agentsAsync = ref.watch(agentsProvider);

    // Default the working directory to the bridge's root (first project) until
    // the user browses to a sub-folder. No manual project list to pick from.
    final defaultProject = projects.value?.firstOrNull;
    final activeProject = _project ?? defaultProject;
    final workingCwd = _browsedCwd ?? activeProject?.cwd;

    final agent = _agent;
    final models =
        agent != null ? ref.watch(agentModelsProvider(agent.agentId)) : null;
    final canStart = activeProject != null && agent != null && !_starting;

    return Scaffold(
      // M3 full-screen dialog: keep the app bar text minimal (a long headline
      // here truncates). The headline lives in the content area below; the
      // affirmative action is a compact text button, not a wide filled one.
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          tooltip: l10n.actionCancel,
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        actions: [
          if (_starting)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: UxnanSpacing.lg),
              child: Center(
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(right: UxnanSpacing.sm),
              child: TextButton(
                onPressed:
                    canStart ? () => _start(activeProject, workingCwd) : null,
                child: Text(l10n.newThreadStart),
              ),
            ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.xl,
            ),
            children: [
              // Headline in the content area (not the app bar) per M3 guidance.
              Padding(
                padding: const EdgeInsets.only(bottom: UxnanSpacing.md),
                child: Text(
                  l10n.newThreadTitle,
                  style: textTheme.headlineSmall,
                ),
              ),
              _SectionHeader(label: l10n.newThreadWorkingDir),
              if (projects.isLoading && workingCwd == null)
                const _Loading()
              else if (workingCwd == null)
                _Error(message: l10n.newThreadLoadFailed)
              else
                _WorkingDirCard(
                  name: _basename(workingCwd),
                  path: workingCwd,
                  onBrowse: _browseFolder,
                ),
              const SizedBox(height: UxnanSpacing.lg),
              _SectionHeader(label: l10n.newThreadAgent),
              agentsAsync.when(
                loading: () => const _Loading(),
                error: (_, __) => _Error(message: l10n.newThreadLoadFailed),
                data: (items) {
                  // Hide the built-in Echo dev agent — it's not a real agent.
                  final visible =
                      items.where((a) => a.agentId != 'echo').toList();
                  if (visible.isEmpty) {
                    return _Empty(message: l10n.newThreadNoAgents);
                  }
                  return Column(
                    children: [
                      for (final a in visible)
                        _AgentCard(
                          agent: a,
                          selected: a.agentId == _agent?.agentId,
                          onTap: a.available ? () => _selectAgent(a) : null,
                        ),
                    ],
                  );
                },
              ),
              const SizedBox(height: UxnanSpacing.lg),
              _SectionHeader(label: l10n.newThreadModel),
              _ModelField(
                controller: _model,
                enabled: agent != null,
                models: models,
                onChanged: (_) => _modelTouched = true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The selected working directory, with a "Change" action that opens the
/// folder browser.
class _WorkingDirCard extends StatelessWidget {
  const _WorkingDirCard({
    required this.name,
    required this.path,
    required this.onBrowse,
  });

  final String name;
  final String path;
  final VoidCallback onBrowse;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: onBrowse,
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.md),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: colors.secondaryContainer,
                  borderRadius: const BorderRadius.all(UxnanRadius.md),
                ),
                child: Icon(
                  Icons.folder_outlined,
                  color: colors.onSecondaryContainer,
                ),
              ),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: textTheme.titleSmall,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      path,
                      style: UxnanTypography.codeSmall.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: UxnanSpacing.sm),
              TextButton.icon(
                onPressed: onBrowse,
                icon: const Icon(Icons.folder_open_outlined, size: 18),
                label: Text(AppLocalizations.of(context).newThreadChangeFolder),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// An agent option: logo, name, availability, and capability chips, with a
/// selected state. Unavailable agents are dimmed and not selectable.
class _AgentCard extends StatelessWidget {
  const _AgentCard({
    required this.agent,
    required this.selected,
    required this.onTap,
  });

  final AgentDescriptor agent;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final caps = _capabilities(agent, l10n);

    return Padding(
      padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
      child: Opacity(
        opacity: agent.available ? 1 : 0.5,
        child: Material(
          color: selected
              ? colors.primaryContainer.withValues(alpha: 0.45)
              : colors.surfaceContainerHighest,
          shape: RoundedRectangleBorder(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            side: selected
                ? BorderSide(color: colors.primary, width: 1.5)
                : BorderSide(color: colors.outlineVariant),
          ),
          child: InkWell(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(UxnanSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _AgentLeading(agentId: agent.agentId),
                      const SizedBox(width: UxnanSpacing.md),
                      Expanded(
                        child: Text(
                          agent.displayName,
                          style: textTheme.titleMedium,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (!agent.available)
                        Text(
                          l10n.newThreadAgentUnavailable,
                          style: textTheme.bodySmall?.copyWith(
                            color: UxnanColors.disconnected,
                          ),
                        )
                      else if (selected)
                        Icon(Icons.check_circle_rounded, color: colors.primary),
                    ],
                  ),
                  if (caps.isNotEmpty) ...[
                    const SizedBox(height: UxnanSpacing.md),
                    Wrap(
                      spacing: UxnanSpacing.xs,
                      runSpacing: UxnanSpacing.xs,
                      children: [
                        for (final cap in caps)
                          _CapabilityChip(icon: cap.$1, label: cap.$2),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  static List<(IconData, String)> _capabilities(
    AgentDescriptor agent,
    AppLocalizations l10n,
  ) {
    final c = agent.capabilities;
    return [
      if (c.streaming) (Icons.bolt_outlined, l10n.newThreadCapStreaming),
      if (c.planMode) (Icons.checklist_rtl_outlined, l10n.newThreadCapPlan),
      if (c.approvals)
        (Icons.verified_user_outlined, l10n.newThreadCapApprovals),
      if (c.forking) (Icons.call_split_rounded, l10n.newThreadCapForking),
      if (c.images) (Icons.image_outlined, l10n.newThreadCapImages),
    ];
  }
}

class _CapabilityChip extends StatelessWidget {
  const _CapabilityChip({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: 4,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: colors.onSurfaceVariant),
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
          ),
        ],
      ),
    );
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
  final AsyncValue<List<AgentModel>>? models;
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
            DropdownMenuEntry<String>(
              value: model.id,
              label: model.displayName,
            ),
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
          contentPadding: const EdgeInsets.symmetric(vertical: UxnanSpacing.md),
          icon: Icon(
            Icons.auto_awesome_outlined,
            size: 18,
            color: colors.onSurfaceVariant,
          ),
          suffixIconConstraints:
              const BoxConstraints(maxHeight: 20, maxWidth: 36),
          suffixIcon: loading
              ? const Padding(
                  padding: EdgeInsets.only(right: 10),
                  child: SizedBox(
                    width: 16,
                    height: 16,
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

class _Error extends StatelessWidget {
  const _Error({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.md),
      child: Text(message, style: TextStyle(color: colors.error)),
    );
  }
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
            .bodyMedium
            ?.copyWith(color: colors.onSurfaceVariant),
      ),
    );
  }
}
