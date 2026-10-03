import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/core/utils/clock_format.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/screens/conversation/support/model_picker_sheet.dart';
import 'package:uxnan/presentation/screens/threads/workspace_browser_sheet.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/motion.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_badge.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/path_text.dart';
import 'package:uxnan/presentation/widgets/session_handoff_message.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Wire ids of agents hidden from the new-conversation picker even when the
/// connected bridge advertises them via `agent/list`. The bridge is the sole
/// source of truth for which agents exist; this set is only a client-side
/// curtain drawn over that list.
///
///  * `echo` — the built-in dev/reference agent, never a real choice.
///
/// Retired agents are filtered at the application boundary, before this screen
/// receives them; this local set only covers non-product development adapters.
const Set<String> _hiddenAgentIds = {
  'echo',
};

/// Material 3 dialog to start a new conversation: the folder it runs in — the
/// project it was opened from, or the PC's start folder — shown as one card
/// that opens onto the other choices (the PC's registered projects, the same
/// list Uxnan Desktop shows, architecture/02a §5.8.17, and adding one); then
/// compare the available agents directly, choose an optional model, and
/// optionally create a worktree.
/// Full-screen on a phone, bounded on a wide
/// window — see [show]. The descriptive headline lives in the
/// content area so translated text never competes with the close and start
/// actions in the compact top bar. Resolves with the new thread id (or null).
class NewConversationScreen extends ConsumerStatefulWidget {
  /// Creates a [NewConversationScreen].
  const NewConversationScreen({this.initialCwd, super.key});

  /// Folder to start in, when the screen was opened from somewhere that
  /// already knows one — a project's "+" in the spaces list. Null starts in the
  /// PC's start folder (the first project while that is not known yet).
  final String? initialCwd;

  /// Opens the form and resolves with the new thread id.
  ///
  /// **Full-screen on a phone, bounded on a wide window.** M3's full-screen
  /// dialog is a compact-window pattern: past `expanded` the same form stops
  /// being a screen and becomes a dialog over whatever is there. Spreading a
  /// three-answer form across 1600 px is not a form, it is a room — the eye
  /// has to cross the whole monitor between the agent list and the Start
  /// button, and the drawer it covers stops being a place you are.
  ///
  /// The content is identical either way; only its container changes.
  static Future<String?> show(BuildContext context, {String? initialCwd}) {
    if (UxnanBreakpoint.of(context).usesPermanentPane) {
      return showDialog<String>(
        context: context,
        builder: (_) => Dialog(
          // Clipped, or the scaffold inside paints its background square over
          // the dialog's rounded corners.
          clipBehavior: Clip.antiAlias,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560, maxHeight: 720),
            child: NewConversationScreen(initialCwd: initialCwd),
          ),
        ),
      );
    }
    return Navigator.of(context).push<String>(
      MaterialPageRoute<String>(
        fullscreenDialog: true,
        builder: (_) => NewConversationScreen(initialCwd: initialCwd),
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
  AgentDescriptor? _agent;

  @override
  void initState() {
    super.initState();
    // Opened from a project (or one of its worktrees): start in that folder.
    _cwd = widget.initialCwd;
  }

  bool _modelTouched = false;
  bool _starting = false;

  /// The session being picked up (`agentId:sessionId`), while it is.
  String? _pickingSession;

  /// Whether to spin up an isolated worktree for this conversation; when on, a
  /// `git/createWorktree` runs before the thread starts and the thread's working
  /// directory points at the new checkout.
  bool _useWorktree = false;

  /// Forwarded as `managed`, which is what lets the bridge own the location and
  /// record the worktree as one uxnan placed.
  bool _worktreeManaged = false;

  /// The folder the conversation will run in, once chosen: a project's, the
  /// start folder, or the folder the screen was opened for. Null = the PC's
  /// start folder.
  String? _cwd;

  /// Registering a folder picked in the browser is in flight.
  bool _adding = false;

  @override
  void dispose() {
    _model.dispose();
    _worktreeBranch.dispose();
    super.dispose();
  }

  void _selectAgent(AgentDescriptor agent) {
    setState(() {
      _agent = agent;
      if (!_modelTouched) _model.text = agent.defaultModel ?? '';
    });
  }

  /// Adds a project: browse the PC from its start folder, register the chosen
  /// folder in the PC's registry (`project/add`) — so it shows in Uxnan
  /// Desktop too — and select it.
  Future<void> _addProject() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final cwd = await WorkspaceBrowserSheet.show(context);
    if (cwd == null || !mounted) return;
    setState(() => _adding = true);
    try {
      final project = await ref.read(bridgeReplicaProvider).addProject(cwd);
      if (!mounted) return;
      setState(() => _cwd = project?.cwd ?? cwd);
    } on Object {
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.newThreadAddProjectFailed)));
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  Future<void> _start(String cwd) async {
    final agent = _agent;
    if (agent == null) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _starting = true);
    try {
      var workingCwd = cwd;
      final branch = _worktreeBranch.text.trim();
      // Optionally run the conversation in a fresh worktree, then point it at
      // the created checkout so the agent never touches the base working tree.
      String? createdWorktree;
      if (_useWorktree && branch.isNotEmpty) {
        // Let the bridge place it whenever it can: it groups a repository's
        // checkouts the same way the desktop does, so the same project does not
        // end up split across two folder schemes. Only an older bridge, which
        // requires a `path`, gets the derived one.
        final managedByBridge =
            ref.read(bridgeSupportsManagedWorktreesProvider);
        final result = await ref.read(gitActionManagerProvider).createWorktree(
              GitWorktreeParams(
                cwd: workingCwd,
                branch: branch,
                path: managedByBridge
                    ? null
                    : managedWorktreePath(workingCwd, branch),
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

  /// Continue one of the agents' own sessions in this folder as the new
  /// conversation (architecture/02a §5.8.19). One open in a terminal on the PC
  /// is asked for first — the desktop closes the agent there once it is idle —
  /// so the session never has two writers.
  Future<void> _continueSession(AgentSessionSummary session) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _pickingSession = session.key);
    try {
      final holds = ref.read(agentSessionHoldsProvider).value ?? const {};
      if (holds[session.key] != null || session.hold != null) {
        final outcome = await ref.read(bridgeReplicaProvider).requestHandoff(
              agentId: session.agentId,
              sessionId: session.sessionId,
            );
        if (!outcome.isFree) {
          if (!mounted) return;
          messenger
            ..clearSnackBars()
            ..showSnackBar(
              SnackBar(content: Text(handoffMessage(l10n, outcome))),
            );
          return;
        }
      }
      final coordinator = ref.read(sessionCoordinatorProvider);
      final thread = await ref.read(threadManagerProvider).startThread(
            agentId: session.agentId,
            cwd: session.cwd,
            title: session.title,
            agentSessionId: session.sessionId,
            deviceId: coordinator.connectedDevice?.macDeviceId,
          );
      if (mounted) Navigator.of(context).pop(thread.id);
    } on Object {
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.newThreadFailed)));
    } finally {
      if (mounted) setState(() => _pickingSession = null);
    }
  }

  static bool _samePath(String a, String b) =>
      a.replaceAll(RegExp(r'[\\/]+$'), '') ==
      b.replaceAll(RegExp(r'[\\/]+$'), '');

  static String _basename(String path) {
    final parts =
        path.split(RegExp(r'[\\/]')).where((s) => s.isNotEmpty).toList();
    return parts.isEmpty ? path : parts.last;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;

    // A conversation starts on the connected PC, among ITS projects.
    final connectedId = ref.watch(connectedDeviceProvider).value?.macDeviceId;
    final projects = connectedId == null
        ? const AsyncValue<List<Project>>.data([])
        : ref.watch(projectsProvider(connectedId));
    final home = ref.watch(bridgeHomeProvider).value;
    final agentsAsync = ref.watch(agentsProvider);

    // The PC's start folder until another is chosen — what a conversation
    // started from nowhere in particular has always opened on.
    final projectList = projects.value ?? const <Project>[];
    final workingCwd = _cwd ?? home ?? projectList.firstOrNull?.cwd;

    final agent = _agent;
    final models =
        agent != null ? ref.watch(agentModelsProvider(agent.agentId)) : null;
    final canStart = workingCwd != null && agent != null && !_starting;

    return NeScaffold(
      // M3 full-screen dialog: keep variable-length headlines in the content
      // area and reserve the top bar for dismissal + the affirmative action.
      leading: IconSurface(
        icon: UxIcons.close,
        tooltip: l10n.actionCancel,
        onPressed: context.closePane,
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
              onPressed: canStart ? () => _start(workingCwd) : null,
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
                        // A full-screen dialog's title IS that screen's
                        // headline, so it takes the headline rung, not the
                        // region rung below it.
                        style: textTheme.headlineMedium,
                      ),
                    ),
                    _SectionHeader(label: l10n.newThreadProject),
                    if (workingCwd == null &&
                        (projects.isLoading || home == null) &&
                        projectList.isEmpty)
                      const _Loading()
                    else
                      _ProjectPicker(
                        selected: workingCwd,
                        projects: projectList,
                        home: home,
                        adding: _adding,
                        onSelect: (cwd) => setState(() => _cwd = cwd),
                        onAdd: _addProject,
                      ),
                    const SizedBox(height: UxnanSpacing.lg),
                    _SectionHeader(label: l10n.newThreadAgent),
                    agentsAsync.when(
                      loading: () => const _Loading(),
                      error: (_, __) =>
                          _Error(message: l10n.newThreadLoadFailed),
                      data: (items) {
                        // Keep development-only adapters out even when a test
                        // override bypasses ThreadManager's boundary filter.
                        final visible = items
                            .where((a) => !_hiddenAgentIds.contains(a.agentId))
                            .toList();
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
                      _PickUpSessions(
                        cwd: workingCwd,
                        picking: _pickingSession,
                        onPick: _starting || _pickingSession != null
                            ? null
                            : _continueSession,
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

/// Where the conversation runs, as one card: the chosen folder — its name and
/// path — with a round button that opens the other choices underneath it, in
/// the same card group: the PC's registered projects, its start folder, and
/// adding a project. Picking one closes the list again, so the dialog shows
/// one answer, not every possible one.
class _ProjectPicker extends StatefulWidget {
  const _ProjectPicker({
    required this.selected,
    required this.projects,
    required this.home,
    required this.adding,
    required this.onSelect,
    required this.onAdd,
  });

  /// The folder chosen; null only when there is nothing to choose yet.
  final String? selected;
  final List<Project> projects;

  /// The PC's start folder, when known.
  final String? home;

  /// Registering a newly picked folder is in flight.
  final bool adding;
  final ValueChanged<String> onSelect;
  final VoidCallback onAdd;

  @override
  State<_ProjectPicker> createState() => _ProjectPickerState();
}

class _ProjectPickerState extends State<_ProjectPicker> {
  bool _expanded = false;

  @override
  void didUpdateWidget(_ProjectPicker old) {
    super.didUpdateWidget(old);
    // A project just added is the answer: show it, closed.
    if (old.selected != widget.selected) _expanded = false;
  }

  void _select(String cwd) {
    setState(() => _expanded = false);
    widget.onSelect(cwd);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final selected = widget.selected;
    final home = widget.home;
    bool isSelected(String cwd) =>
        selected != null &&
        _NewConversationScreenState._samePath(cwd, selected);
    bool isProject(String cwd) => widget.projects
        .any((p) => _NewConversationScreenState._samePath(p.cwd, cwd));

    final selectedProject = selected == null
        ? null
        : widget.projects.firstWhereOrNull(
            (p) => _NewConversationScreenState._samePath(p.cwd, selected),
          );
    final selectedIsHome = selected != null &&
        home != null &&
        _NewConversationScreenState._samePath(home, selected);

    final options = <Widget Function(CardGroupPosition)>[
      if (home != null && !isSelected(home) && !isProject(home))
        (position) => _FolderOption(
              position: position,
              icon: UxIcons.folderOpen,
              title: l10n.bridgeHomeTitle,
              path: home,
              onTap: () => _select(home),
            ),
      for (final project in widget.projects)
        if (!isSelected(project.cwd))
          (position) => _FolderOption(
                position: position,
                icon: UxIcons.folder,
                title: project.name,
                path: project.cwd,
                onTap: () => _select(project.cwd),
              ),
      (position) => _AddProjectOption(
            position: position,
            busy: widget.adding,
            onTap: widget.adding ? null : widget.onAdd,
          ),
    ];

    if (selected == null) {
      // Nothing to show as chosen (no start folder, no project): adding one
      // is the only way forward, so it is the whole picker.
      return options.last(CardGroupPosition.single);
    }

    return AnimatedSize(
      duration: UxnanMotion.revealIn(context),
      curve: UxnanMotion.revealCurve,
      alignment: Alignment.topCenter,
      child: ExpressiveCardGroup(
        count: 1 + (_expanded ? options.length : 0),
        itemBuilder: (context, index, position) => index == 0
            ? _SelectedFolderCard(
                position: position,
                name: selectedProject?.name ??
                    _NewConversationScreenState._basename(selected),
                path: selected,
                isHome: selectedIsHome,
                expanded: _expanded,
                onToggle: () => setState(() => _expanded = !_expanded),
              )
            : options[index - 1](position),
      ),
    );
  }
}

/// The chosen folder: a tonal folder mark, the name over the path (and a
/// "Start folder" badge when it is that), and the round button that shows or
/// hides the other choices. The whole card toggles too.
class _SelectedFolderCard extends StatelessWidget {
  const _SelectedFolderCard({
    required this.position,
    required this.name,
    required this.path,
    required this.isHome,
    required this.expanded,
    required this.onToggle,
  });

  final CardGroupPosition position;
  final String name;
  final String path;
  final bool isHome;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    return Semantics(
      selected: true,
      expanded: expanded,
      child: ExpressiveCard(
        position: position,
        onTap: onToggle,
        color: colors.primaryContainer,
        child: Row(
          children: [
            Container(
              width: UxnanSize.minTouchTarget,
              height: UxnanSize.minTouchTarget,
              decoration: BoxDecoration(
                color: colors.primary,
                borderRadius: const BorderRadius.all(UxnanRadius.lg),
              ),
              child: UxIcon(
                isHome ? UxIcons.folderOpen : UxIcons.folder,
                color: colors.onPrimary,
              ),
            ),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.titleMedium?.copyWith(
                      color: colors.onPrimaryContainer,
                    ),
                  ),
                  const SizedBox(height: UxnanSpacing.xs),
                  PathText(
                    path,
                    style: UxnanTypography.codeSmall.copyWith(
                      color: colors.onPrimaryContainer.withValues(alpha: 0.75),
                    ),
                  ),
                  if (isHome) ...[
                    const SizedBox(height: UxnanSpacing.sm),
                    NeBadge(label: l10n.bridgeHomeTitle),
                  ],
                ],
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            IconSurface(
              icon: expanded ? UxIcons.expandLess : UxIcons.expandMore,
              tooltip: expanded
                  ? l10n.newThreadHideProjects
                  : l10n.newThreadChangeProject,
              onPressed: onToggle,
            ),
          ],
        ),
      ),
    );
  }
}

/// Another folder the conversation could run in: a project, or the start
/// folder.
class _FolderOption extends StatelessWidget {
  const _FolderOption({
    required this.position,
    required this.icon,
    required this.title,
    required this.path,
    required this.onTap,
  });

  final CardGroupPosition position;
  final UxIconData icon;
  final String title;
  final String path;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      selected: false,
      child: ExpressiveCard(
        position: position,
        onTap: onTap,
        color: colors.surfaceContainer,
        child: Row(
          children: [
            UxIcon(icon, color: colors.onSurfaceVariant),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.titleMedium,
                  ),
                  PathText(
                    path,
                    style: UxnanTypography.codeSmall.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The last choice: add a folder of the PC as a project.
class _AddProjectOption extends StatelessWidget {
  const _AddProjectOption({
    required this.position,
    required this.busy,
    required this.onTap,
  });

  final CardGroupPosition position;
  final bool busy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    return ExpressiveCard(
      position: position,
      onTap: onTap,
      color: colors.surfaceContainer,
      child: Row(
        children: [
          if (busy)
            const SizedBox.square(
              dimension: UxnanSize.iconContentLarge,
              child: PolygonLoader(),
            )
          else
            UxIcon(UxIcons.add, color: colors.primary),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.newThreadAddProject,
                  style: textTheme.titleMedium?.copyWith(color: colors.primary),
                ),
                Text(
                  l10n.newThreadAddProjectHint,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
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
              UxIcon(
                UxIcons.accountTree,
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
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
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
                    UxIcon(
                      UxIcons.checkCircle,
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
List<(UxIconData, String)> _agentCapabilities(
  AgentDescriptor agent,
  AppLocalizations l10n,
) {
  final c = agent.capabilities;
  return [
    if (c.streaming) (UxIcons.bolt, l10n.newThreadCapStreaming),
    if (c.accessModes.contains(ApprovalMode.plan))
      (UxIcons.checklistRtl, l10n.newThreadCapPlan),
    if (c.approvals) (UxIcons.verifiedUser, l10n.newThreadCapApprovals),
    if (c.autonomous) (UxIcons.autoAwesome, l10n.newThreadCapAutonomous),
    if (c.forking) (UxIcons.callSplit, l10n.newThreadCapForking),
    if (c.images) (UxIcons.image, l10n.newThreadCapImages),
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
          : const UxIcon(UxIcons.login, size: 16),
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

  final UxIconData icon;
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
          UxIcon(icon, size: 16, color: foreground),
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
      child: UxIcon(
        UxIcons.smartToy,
        size: 20,
        color: AgentVisuals.colorFor(agent),
      ),
    );
  }
}

/// Model picker. A tappable field that opens the shared [ModelPickerSheet]
/// (lazy, searchable, grouped by provider) rather than an inline dropdown —
/// agents like pi/OpenCode report hundreds of models, which made an inline
/// `DropdownMenu` janky to build. Shows the selected model the way the sheet
/// itself does — readable name over routing id, so the provider stays visible —
/// or a hint, with a spinner while the bridge's model list is still loading.
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
    final modelId = controller.text;
    final hasModel = modelId.isNotEmpty;
    final tappable = enabled && agentId != null && !loading;
    // The readable name the bridge reports for the picked id, falling back to
    // the id itself while the list loads, offline, or when the agent reports no
    // separate name (pi/OpenCode `provider/model` ids already read as one).
    final label =
        models?.value?.firstWhereOrNull((m) => m.id == modelId)?.displayName ??
            modelId;

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
              UxIcon(
                UxIcons.autoAwesome,
                size: 18,
                color: colors.onSurfaceVariant,
              ),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: !hasModel
                    ? Text(
                        l10n.newThreadModelHint,
                        style: textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                        overflow: TextOverflow.ellipsis,
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            label,
                            style: textTheme.bodyMedium,
                            overflow: TextOverflow.ellipsis,
                          ),
                          // Only when it says something the name doesn't.
                          if (label != modelId)
                            Text(
                              modelId,
                              style: UxnanTypography.codeSmall.copyWith(
                                color: colors.onSurfaceVariant,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                        ],
                      ),
              ),
              const SizedBox(width: UxnanSpacing.sm),
              if (loading)
                const PolygonLoader(size: 16)
              else if (enabled && agentId != null)
                UxIcon(
                  UxIcons.unfoldMore,
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

/// The agents' own sessions in the chosen folder that no conversation
/// continues yet — started in a terminal on the PC, or in the agent's own app —
/// to pick up as this conversation. One open in a terminal says so.
class _PickUpSessions extends ConsumerStatefulWidget {
  const _PickUpSessions({
    required this.cwd,
    required this.picking,
    required this.onPick,
  });

  final String cwd;
  final String? picking;
  final ValueChanged<AgentSessionSummary>? onPick;

  @override
  ConsumerState<_PickUpSessions> createState() => _PickUpSessionsState();
}

class _PickUpSessionsState extends ConsumerState<_PickUpSessions> {
  static const int _collapsed = 5;
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final list = ref.watch(agentSessionsProvider(widget.cwd)).value;
    final holds = ref.watch(agentSessionHoldsProvider).value ?? const {};
    if (list == null || (list.sessions.isEmpty && list.unlisted.isEmpty)) {
      return const SizedBox.shrink();
    }
    final agents = ref.watch(agentsProvider).value ?? const [];
    String nameOf(String id) =>
        agents.firstWhereOrNull((a) => a.agentId == id)?.displayName ??
        AgentVisuals.labelFor(AgentIdParsing.fromWireId(id));
    final shown =
        _showAll ? list.sessions : list.sessions.take(_collapsed).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: UxnanSpacing.lg),
        _SectionHeader(label: l10n.sessionsSection),
        if (list.sessions.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
            child: Text(
              l10n.sessionsSectionHint,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
          ExpressiveCardGroup(
            count: shown.length,
            itemBuilder: (context, index, position) {
              final session = shown[index];
              return _SessionCard(
                session: session,
                hold: holds[session.key] ?? session.hold,
                position: position,
                busy: widget.picking == session.key,
                onTap: widget.onPick == null
                    ? null
                    : () => widget.onPick!(session),
              );
            },
          ),
          if (list.sessions.length > _collapsed)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => setState(() => _showAll = !_showAll),
                child: Text(
                  _showAll
                      ? l10n.sessionsShowFewer
                      : l10n.sessionsShowAll(list.sessions.length),
                ),
              ),
            ),
        ],
        if (list.unlisted.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: UxnanSpacing.sm),
            child: Text(
              l10n.sessionsUnlisted(list.unlisted.map(nameOf).join(', ')),
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
      ],
    );
  }
}

/// One session to pick up: its agent, its name, how long ago it changed, and
/// whether a terminal on the PC has it open right now.
class _SessionCard extends StatelessWidget {
  const _SessionCard({
    required this.session,
    required this.hold,
    required this.position,
    required this.busy,
    required this.onTap,
  });

  final AgentSessionSummary session;
  final AgentSessionHold? hold;
  final CardGroupPosition position;
  final bool busy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final hold = this.hold;
    final when = formatWhen(DateTime.now().subtract(session.updatedAgo));
    return Semantics(
      button: true,
      label: l10n.sessionsPickHint,
      child: ExpressiveCard(
        position: position,
        onTap: onTap,
        color: colors.surfaceContainer,
        child: Row(
          children: [
            _AgentLeading(agentId: session.agentId),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.title ?? l10n.sessionsUntitled,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.titleSmall?.copyWith(
                      color: session.title == null
                          ? colors.onSurfaceVariant
                          : colors.onSurface,
                    ),
                  ),
                  const SizedBox(height: UxnanSpacing.xs),
                  Row(
                    children: [
                      if (hold != null) ...[
                        UxIcon(
                          UxIcons.terminal,
                          size: 14,
                          color: hold.busy ? colors.tertiary : colors.primary,
                        ),
                        const SizedBox(width: UxnanSpacing.xs),
                        Flexible(
                          child: Text(
                            hold.busy
                                ? l10n.sessionsWorkingInTerminal(
                                    hold.holderName,
                                  )
                                : l10n.sessionsInTerminal(hold.holderName),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: textTheme.labelSmall?.copyWith(
                              color:
                                  hold.busy ? colors.tertiary : colors.primary,
                            ),
                          ),
                        ),
                        Text(
                          '  ·  ',
                          style: textTheme.labelSmall?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ],
                      Text(
                        when,
                        style: textTheme.labelSmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            if (busy)
              const PolygonLoader()
            else
              UxIcon(
                UxIcons.chevronRight,
                size: 18,
                color: colors.onSurfaceVariant,
              ),
          ],
        ),
      ),
    );
  }
}
