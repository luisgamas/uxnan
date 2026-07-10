import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/support/model_picker_sheet.dart';
import 'package:uxnan/presentation/screens/threads/agent_picker_sheet.dart';
import 'package:uxnan/presentation/screens/threads/workspace_browser_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

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
  final TextEditingController _worktreeBranch = TextEditingController();
  Project? _project;
  AgentDescriptor? _agent;
  bool _modelTouched = false;
  bool _starting = false;

  /// Whether to spin up an isolated worktree for this conversation; when on, a
  /// `git/createWorktree` runs before the thread starts and the thread's working
  /// directory points at the new checkout.
  bool _useWorktree = false;

  /// Forwarded as `managed` so the bridge can later own the worktree location;
  /// today the phone still derives an explicit sibling path (see
  /// [_worktreePath]).
  bool _worktreeManaged = false;

  /// Absolute working dir chosen via the folder browser (overrides the default
  /// project root); null = use the default root.
  String? _browsedCwd;

  @override
  void dispose() {
    _model.dispose();
    _worktreeBranch.dispose();
    super.dispose();
  }

  /// Derives a sibling worktree path from the repo [cwd] and [branch]. The
  /// bridge requires an explicit path (no managed worktrees yet); this keeps it
  /// next to the repo as `<repo>-<branch>` with unsafe chars folded to `-`.
  static String _worktreePath(String cwd, String branch) {
    final sep = cwd.contains(r'\') ? r'\' : '/';
    final trimmed = cwd.replaceAll(RegExp(r'[\\/]+$'), '');
    final idx = trimmed.lastIndexOf(RegExp(r'[\\/]'));
    final parent = idx < 0 ? '' : trimmed.substring(0, idx);
    final repo = idx < 0 ? trimmed : trimmed.substring(idx + 1);
    final slug = branch.replaceAll(RegExp('[^A-Za-z0-9._-]+'), '-');
    return parent.isEmpty ? '$repo-$slug' : '$parent$sep$repo-$slug';
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
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _starting = true);
    try {
      var workingCwd = cwd ?? project.cwd;
      final branch = _worktreeBranch.text.trim();
      // Optionally run the conversation in a fresh worktree, then point it at
      // the created checkout so the agent never touches the base working tree.
      String? createdWorktree;
      if (_useWorktree && branch.isNotEmpty) {
        final result = await ref.read(gitActionManagerProvider).createWorktree(
              GitWorktreeParams(
                cwd: workingCwd,
                branch: branch,
                path: _worktreePath(workingCwd, branch),
                managed: _worktreeManaged,
              ),
            );
        if (result == null) throw StateError('worktree');
        if (result.path.isNotEmpty) {
          workingCwd = result.path;
          createdWorktree = result.path;
        }
      }
      final coordinator = ref.read(sessionCoordinatorProvider);
      // Tag with the PC we actually hold a live channel to.
      final deviceId = coordinator.connectedDevice?.macDeviceId;
      final thread = await ref.read(threadManagerProvider).startThread(
            projectId: project.id,
            agentId: agent.agentId,
            model: _model.text.trim(),
            cwd: workingCwd,
            deviceId: deviceId,
            worktreePath: createdWorktree,
          );
      if (mounted) Navigator.of(context).pop(thread.id);
    } on Object {
      if (!mounted) return;
      setState(() => _starting = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(
            content: Text(
              _useWorktree && _worktreeBranch.text.trim().isNotEmpty
                  ? l10n.newThreadWorktreeFailed
                  : l10n.newThreadFailed,
            ),
          ),
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

    return NeScaffold(
      title: l10n.newThreadTitle,
      // Full-screen dialog: a close (✕) instead of a back arrow; the
      // affirmative action is a compact text button.
      leading: IconSurface(
        icon: Icons.close_rounded,
        tooltip: l10n.actionCancel,
        onPressed: () => Navigator.of(context).maybePop(),
      ),
      actions: [
        if (_starting)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: UxnanSpacing.md),
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
      slivers: [
        SliverToBoxAdapter(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  UxnanSpacing.lg,
                  UxnanSpacing.sm,
                  UxnanSpacing.lg,
                  UxnanSpacing.xl,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
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
                    if (workingCwd != null) ...[
                      const SizedBox(height: UxnanSpacing.sm),
                      _WorktreeCard(
                        enabled: _useWorktree,
                        managed: _worktreeManaged,
                        branch: _worktreeBranch,
                        onToggle: (v) => setState(() => _useWorktree = v),
                        onToggleManaged: (v) =>
                            setState(() => _worktreeManaged = v),
                      ),
                    ],
                    const SizedBox(height: UxnanSpacing.lg),
                    _SectionHeader(label: l10n.newThreadAgent),
                    agentsAsync.when(
                      loading: () => const _Loading(),
                      error: (_, __) =>
                          _Error(message: l10n.newThreadLoadFailed),
                      data: (items) {
                        // Hide the built-in Echo dev agent — not a real agent.
                        final visible =
                            items.where((a) => a.agentId != 'echo').toList();
                        if (visible.isEmpty) {
                          return _Empty(message: l10n.newThreadNoAgents);
                        }
                        return _AgentSelector(
                          agents: visible,
                          selected: _agent,
                          onSelect: _selectAgent,
                        );
                      },
                    ),
                    const SizedBox(height: UxnanSpacing.lg),
                    _SectionHeader(label: l10n.newThreadModel),
                    _ModelField(
                      controller: _model,
                      enabled: agent != null,
                      models: models,
                      agentId: agent?.agentId,
                      onChanged: (_) => setState(() => _modelTouched = true),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
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
    return NeCard(
      onTap: onBrowse,
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
    );
  }
}

/// Optional worktree toggle: when on, this conversation runs in a fresh
/// `git worktree` (an isolated branch checkout) instead of the chosen working
/// directory. Expands to reveal the branch name and a "managed by the bridge"
/// switch (forwarded for future bridge support; the path is still derived on
/// the phone today). Mirrors the collapsible agent card's surface and motion.
class _WorktreeCard extends StatelessWidget {
  const _WorktreeCard({
    required this.enabled,
    required this.managed,
    required this.branch,
    required this.onToggle,
    required this.onToggleManaged,
  });

  final bool enabled;
  final bool managed;
  final TextEditingController branch;
  final ValueChanged<bool> onToggle;
  final ValueChanged<bool> onToggleManaged;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    return NeCard(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.md,
        UxnanSpacing.xs,
        UxnanSpacing.sm,
        UxnanSpacing.xs,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.account_tree_outlined,
                size: 20,
                color: colors.onSurfaceVariant,
              ),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l10n.newThreadWorktree, style: textTheme.titleSmall),
                    const SizedBox(height: 2),
                    Text(
                      l10n.newThreadWorktreeDesc,
                      style: textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Switch(value: enabled, onChanged: onToggle),
            ],
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topLeft,
            child: enabled
                ? Padding(
                    padding: const EdgeInsets.only(
                      top: UxnanSpacing.sm,
                      bottom: UxnanSpacing.xs,
                      right: UxnanSpacing.xs,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        TextField(
                          controller: branch,
                          decoration: InputDecoration(
                            isDense: true,
                            labelText: l10n.newThreadWorktreeBranchHint,
                            border: const OutlineInputBorder(
                              borderRadius: BorderRadius.all(UxnanRadius.md),
                            ),
                          ),
                        ),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          visualDensity: VisualDensity.compact,
                          title: Text(
                            l10n.newThreadWorktreeManaged,
                            style: textTheme.bodyMedium,
                          ),
                          value: managed,
                          onChanged: onToggleManaged,
                        ),
                      ],
                    ),
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}

/// The agent selector: a combobox-style field (mirroring [`_ModelField`]) that
/// opens the searchable, alphabetical [AgentPickerSheet], with the SELECTED
/// agent's capability chips + sign-in status shown inline **below** it. This
/// keeps everything on one screen and scales as the agent list grows (the old
/// per-agent card stack didn't).
class _AgentSelector extends StatelessWidget {
  const _AgentSelector({
    required this.agents,
    required this.selected,
    required this.onSelect,
  });

  final List<AgentDescriptor> agents;
  final AgentDescriptor? selected;
  final ValueChanged<AgentDescriptor> onSelect;

  Future<void> _pick(BuildContext context) async {
    final picked = await AgentPickerSheet.show(
      context,
      agents: agents,
      selectedId: selected?.agentId,
    );
    if (picked == null) return;
    for (final a in agents) {
      if (a.agentId == picked) {
        onSelect(a);
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final agent = selected;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _AgentField(agent: agent, onTap: () => _pick(context)),
        if (agent != null) ...[
          const SizedBox(height: UxnanSpacing.md),
          _AgentDetail(agent: agent),
        ],
      ],
    );
  }
}

/// The combobox field showing the selected agent (logo + name) or a hint, with
/// an unfold chevron; tapping opens the [AgentPickerSheet].
class _AgentField extends StatelessWidget {
  const _AgentField({required this.agent, required this.onTap});

  final AgentDescriptor? agent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final a = agent;

    return Material(
      color: colors.surfaceContainerHighest,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        side: BorderSide(color: colors.outline),
      ),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.md),
          child: Row(
            children: [
              if (a != null)
                _AgentLeading(agentId: a.agentId)
              else
                Icon(
                  Icons.smart_toy_outlined,
                  size: 20,
                  color: colors.onSurfaceVariant,
                ),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Text(
                  a?.displayName ?? l10n.newThreadAgentHint,
                  style: textTheme.bodyLarge?.copyWith(
                    color: a == null ? colors.onSurfaceVariant : null,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Icon(
                Icons.unfold_more_rounded,
                size: 20,
                color: colors.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Below the combobox: the selected agent's capability chips, plus the sign-in
/// status (a "Check sign-in" action for an installed-but-not-signed-in agent,
/// re-querying `auth/status`, or an "unavailable" note).
class _AgentDetail extends ConsumerWidget {
  const _AgentDetail({required this.agent});

  final AgentDescriptor agent;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final caps = _agentCapabilities(agent, l10n);

    final auth = ref.watch(authStatusProvider(agent.agentId));
    final requiresLogin =
        agent.available && (auth.value?.requiresLogin ?? false);
    final checking = requiresLogin && auth.isLoading;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!agent.available)
          Text(
            l10n.newThreadAgentUnavailable,
            style: textTheme.bodySmall
                ?.copyWith(color: UxnanColors.disconnected),
          )
        else if (requiresLogin)
          Padding(
            padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
            child: _CheckSignInButton(
              checking: checking,
              onPressed: () =>
                  ref.invalidate(authStatusProvider(agent.agentId)),
            ),
          ),
        if (agent.available && caps.isNotEmpty)
          Wrap(
            spacing: UxnanSpacing.xs,
            runSpacing: UxnanSpacing.xs,
            children: [
              for (final cap in caps)
                _CapabilityChip(icon: cap.$1, label: cap.$2),
            ],
          ),
      ],
    );
  }
}

/// The agent's capabilities as (icon, label) pairs, in a stable order.
List<(IconData, String)> _agentCapabilities(
  AgentDescriptor agent,
  AppLocalizations l10n,
) {
  final c = agent.capabilities;
  return [
    if (c.streaming) (Icons.bolt_outlined, l10n.newThreadCapStreaming),
    if (c.planMode) (Icons.checklist_rtl_outlined, l10n.newThreadCapPlan),
    if (c.approvals)
      (Icons.verified_user_outlined, l10n.newThreadCapApprovals),
    if (c.autonomous)
      (Icons.auto_awesome_outlined, l10n.newThreadCapAutonomous),
    if (c.forking) (Icons.call_split_rounded, l10n.newThreadCapForking),
    if (c.images) (Icons.image_outlined, l10n.newThreadCapImages),
  ];
}

/// Trailing action on a not-signed-in agent card: an error-toned [TextButton]
/// that re-queries `auth/status` (the agent's card un-tints once the user signs
/// in on the PC). Shows a spinner while the re-check is in flight.
class _CheckSignInButton extends StatelessWidget {
  const _CheckSignInButton({required this.checking, required this.onPressed});

  final bool checking;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    return TextButton.icon(
      onPressed: checking ? null : onPressed,
      style: TextButton.styleFrom(
        foregroundColor: colors.error,
        visualDensity: VisualDensity.compact,
      ),
      icon: checking
          ? SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: colors.error,
              ),
            )
          : const Icon(Icons.login_rounded, size: 16),
      label: Text(l10n.agentCheckSignIn),
    );
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

/// Model picker. A tappable field that opens the shared [ModelPickerSheet]
/// (lazy, searchable, grouped by provider) rather than an inline dropdown —
/// agents like pi/OpenCode report hundreds of models, which made an inline
/// `DropdownMenu` janky to build. Shows the selected model id (or a hint), with
/// a spinner while the bridge's model list is still loading.
class _ModelField extends StatelessWidget {
  const _ModelField({
    required this.controller,
    required this.enabled,
    required this.models,
    required this.agentId,
    required this.onChanged,
  });

  final TextEditingController controller;
  final bool enabled;
  final AsyncValue<List<AgentModel>>? models;
  final String? agentId;
  final ValueChanged<String> onChanged;

  Future<void> _pick(BuildContext context) async {
    final id = agentId;
    if (id == null) return;
    final picked = await ModelPickerSheet.show(
      context,
      agentId: id,
      current: controller.text.isEmpty ? null : controller.text,
    );
    if (picked == null) return;
    controller.text = picked;
    onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final loading = models?.isLoading ?? false;
    final hasModel = controller.text.isNotEmpty;
    final tappable = enabled && agentId != null && !loading;

    return Material(
      color: colors.surfaceContainerHighest,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        side: BorderSide(color: colors.outline),
      ),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: tappable ? () => _pick(context) : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.md,
            vertical: UxnanSpacing.md,
          ),
          child: Row(
            children: [
              Icon(
                Icons.auto_awesome_outlined,
                size: 18,
                color: colors.onSurfaceVariant,
              ),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Text(
                  hasModel ? controller.text : l10n.newThreadModelHint,
                  style: textTheme.bodyMedium?.copyWith(
                    color: hasModel ? null : colors.onSurfaceVariant,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: UxnanSpacing.sm),
              if (loading)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else if (enabled && agentId != null)
                Icon(
                  Icons.unfold_more_rounded,
                  size: 20,
                  color: colors.onSurfaceVariant,
                ),
            ],
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
