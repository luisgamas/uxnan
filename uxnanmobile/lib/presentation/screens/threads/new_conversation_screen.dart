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
import 'package:uxnan/presentation/screens/threads/workspace_browser_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen Material 3 dialog to start a new conversation: pick the working
/// directory, compare the available agents directly, choose an optional model,
/// and optionally create a worktree. The descriptive headline lives in the
/// content area so translated text never competes with the close and start
/// actions in the compact top bar. Resolves with the new thread id (or null).
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

    return NeScaffold(
      // M3 full-screen dialog: keep variable-length headlines in the content
      // area and reserve the top bar for dismissal + the affirmative action.
      leading: IconSurface(
        icon: Icons.close_rounded,
        tooltip: l10n.actionCancel,
        onPressed: () => Navigator.of(context).maybePop(),
      ),
      actions: [
        if (_starting)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: UxnanSpacing.md),
            child: Center(child: PolygonLoader()),
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
              constraints: const BoxConstraints(
                maxWidth: UxnanSpacing.maxContentWidth,
              ),
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
                    Padding(
                      padding: const EdgeInsets.only(
                        top: UxnanSpacing.sm,
                        bottom: UxnanSpacing.md,
                      ),
                      child: Text(
                        l10n.newThreadTitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
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
                      error: (_, __) =>
                          _Error(message: l10n.newThreadLoadFailed),
                      data: (items) {
                        // Hide the built-in Echo dev agent — not a real agent.
                        final visible =
                            items.where((a) => a.agentId != 'echo').toList();
                        if (visible.isEmpty) {
                          return _Empty(message: l10n.newThreadNoAgents);
                        }
                        return ExpressiveCardGroup(
                          count: visible.length,
                          itemBuilder: (context, index, position) {
                            final candidate = visible[index];
                            return _AgentCard(
                              agent: candidate,
                              position: position,
                              selected: candidate.agentId == _agent?.agentId,
                              onTap: candidate.available
                                  ? () => _selectAgent(candidate)
                                  : null,
                            );
                          },
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
                    if (workingCwd != null) ...[
                      const SizedBox(height: UxnanSpacing.lg),
                      _WorktreeCard(
                        enabled: _useWorktree,
                        managed: _worktreeManaged,
                        branch: _worktreeBranch,
                        onToggle: (v) => setState(() => _useWorktree = v),
                        onToggleManaged: (v) =>
                            setState(() => _worktreeManaged = v),
                      ),
                    ],
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

/// The selected working directory. The whole card opens the folder browser,
/// avoiding a second nested control with the same action.
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
                const SizedBox(height: UxnanSpacing.xs),
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
          Icon(
            Icons.chevron_right_rounded,
            color: colors.onSurfaceVariant,
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
/// the phone today). Uses the same calm surface and restrained expansion motion
/// as the rest of the dialog.
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
                    const SizedBox(height: UxnanSpacing.xs),
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

/// An agent option in a cohesive Neural Expressive card group. Every compact
/// header remains visible for direct comparison; selecting a card reveals only
/// its capability chips, so choosing another agent automatically collapses the
/// previous card. Selection uses a semantic tonal surface and a check mark,
/// while unavailable or signed-out states remain actionable and legible
/// without adding outline noise.
class _AgentCard extends ConsumerWidget {
  const _AgentCard({
    required this.agent,
    required this.position,
    required this.selected,
    required this.onTap,
  });

  final AgentDescriptor agent;
  final CardGroupPosition position;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final caps = _agentCapabilities(agent, l10n);
    final auth = ref.watch(authStatusProvider(agent.agentId));
    final requiresLogin =
        agent.available && (auth.value?.requiresLogin ?? false);
    final checking = requiresLogin && auth.isLoading;
    final foreground = requiresLogin
        ? colors.onErrorContainer
        : selected
            ? colors.onPrimaryContainer
            : colors.onSurface;
    final mutedForeground = foreground.withValues(alpha: 0.75);
    final background = requiresLogin
        ? colors.errorContainer
        : selected
            ? colors.primaryContainer
            : colors.surfaceContainer;
    final chipBackground = requiresLogin || selected
        ? colors.surface.withValues(alpha: 0.7)
        : colors.surfaceContainerHighest;

    return Semantics(
      button: agent.available,
      selected: selected,
      enabled: agent.available,
      child: Opacity(
        opacity: agent.available ? 1 : 0.55,
        child: ExpressiveCard(
          position: position,
          onTap: onTap,
          color: background,
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
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.titleMedium?.copyWith(color: foreground),
                    ),
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  if (!agent.available)
                    Text(
                      l10n.newThreadAgentUnavailable,
                      style: textTheme.bodySmall?.copyWith(
                        color: UxnanColors.disconnected,
                      ),
                    )
                  else if (selected)
                    Icon(
                      Icons.check_circle_rounded,
                      color: foreground,
                    ),
                ],
              ),
              if (caps.isNotEmpty)
                AnimatedSize(
                  duration: reduceMotion
                      ? Duration.zero
                      : const Duration(milliseconds: 200),
                  curve: Curves.easeOutCubic,
                  alignment: Alignment.topLeft,
                  child: selected
                      ? Padding(
                          padding: const EdgeInsets.only(
                            top: UxnanSpacing.md,
                          ),
                          child: Wrap(
                            spacing: UxnanSpacing.xs,
                            runSpacing: UxnanSpacing.xs,
                            children: [
                              for (final cap in caps)
                                _CapabilityChip(
                                  icon: cap.$1,
                                  label: cap.$2,
                                  background: chipBackground,
                                  foreground: mutedForeground,
                                ),
                            ],
                          ),
                        )
                      : const SizedBox(width: double.infinity),
                ),
              if (requiresLogin) ...[
                const SizedBox(height: UxnanSpacing.sm),
                _CheckSignInButton(
                  checking: checking,
                  onPressed: () =>
                      ref.invalidate(authStatusProvider(agent.agentId)),
                ),
              ],
            ],
          ),
        ),
      ),
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
    if (c.approvals) (Icons.verified_user_outlined, l10n.newThreadCapApprovals),
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
          ? PolygonLoader(size: 14, color: colors.error)
          : const Icon(Icons.login_rounded, size: 16),
      label: Text(l10n.agentCheckSignIn),
    );
  }
}

class _CapabilityChip extends StatelessWidget {
  const _CapabilityChip({
    required this.icon,
    required this.label,
    required this.background,
    required this.foreground,
  });

  final IconData icon;
  final String label;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: UxnanSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: foreground),
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            label,
            style: textTheme.labelSmall?.copyWith(color: foreground),
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
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(UxnanRadius.lg),
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
                const PolygonLoader(size: 16)
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
        label,
        style: textTheme.titleSmall?.copyWith(
          color: colors.onSurfaceVariant,
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
        child: Center(child: PolygonLoader(size: 22)),
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
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.md),
      child: Text(
        message,
        style: textTheme.bodyMedium?.copyWith(color: colors.onSurfaceVariant),
      ),
    );
  }
}
