import 'dart:async';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/agent_run_state_provider.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/shell_device_provider.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/screens/threads/new_conversation_screen.dart';
import 'package:uxnan/presentation/screens/threads/space_rows.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart';
import 'package:uxnan/presentation/screens/threads/thread_tile.dart';
import 'package:uxnan/presentation/screens/threads/workspace_details_sheet.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_entrance_scope.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// The threads of a connected PC (spec 02a §5.4.2). Lists the active bridge's
/// threads with per-agent filter chips, and opens a thread's conversation.
class ThreadsScreen extends ConsumerStatefulWidget {
  /// Creates a [ThreadsScreen] for the device with [deviceId].
  const ThreadsScreen({
    required this.deviceId,
    this.embedded = false,
    super.key,
  });

  /// The PC whose threads are shown (used for the title).
  final String deviceId;

  /// Whether this is the **content** of a surface that already provides its
  /// own chrome — the permanent drawer's middle zone.
  ///
  /// Embedded it drops the app bar (the drawer has its own header above it),
  /// the pull-to-refresh (a drawer is not a page you pull) and the extended
  /// FAB (which would float over a 320 dp column). The list itself, its
  /// controls and every behaviour around them are identical: this is one
  /// screen shown two ways, not two screens to keep in step.
  final bool embedded;

  @override
  ConsumerState<ThreadsScreen> createState() => _ThreadsScreenState();
}

class _ThreadsScreenState extends ConsumerState<ThreadsScreen> {
  @override
  void initState() {
    super.initState();
    // Pull this PC's threads on open so they get tagged with the device and the
    // list reflects the connected bridge.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _refresh();
      // Remembered for the permanent drawer, which on a cold start or a deep
      // link has no route to read the PC from — see [shellDeviceProvider].
      // Not recorded when this list IS the drawer's own content: that would be
      // the drawer telling itself what it already decided.
      if (!widget.embedded) {
        unawaited(
          ref.read(lastVisitedDeviceProvider.notifier).visited(widget.deviceId),
        );
      }
    });
  }

  /// Whether the live session is actually connected to THIS PC (not merely some
  /// other paired PC). All live operations are gated on this so browsing a PC
  /// we aren't connected to can't accidentally drive a different one.
  bool get _connectedHere =>
      ref.read(connectedDeviceProvider).value?.macDeviceId == widget.deviceId;

  Future<void> _refresh() async {
    // Only pull from the bridge when connected to THIS PC; otherwise a refresh
    // would load the other PC's threads over the live channel and mistag them.
    if (!_connectedHere) return;
    try {
      await ref
          .read(threadManagerProvider)
          .loadThreads(deviceId: widget.deviceId)
          .timeout(const Duration(seconds: 15));
    } on Object {
      // Best effort: surface nothing if the refresh fails or times out.
    }
  }

  /// Connects to this PC (validated; stays put on failure) from the offline
  /// banner, so the user can go live without leaving the threads list.
  Future<void> _connectHere() async {
    final devices = ref.read(trustedDevicesProvider).value ?? const [];
    final device = devices.firstWhereOrNull(
      (d) => d.macDeviceId == widget.deviceId,
    );
    if (device == null) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(sessionCoordinatorProvider).switchMac(device);
      unawaited(_refresh());
    } on Object {
      messenger
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(content: Text(l10n.deviceConnectFailed(device.displayName))),
        );
    }
  }

  Future<void> _newConversation({String? cwd}) async {
    final threadId = await NewConversationScreen.show(context, initialCwd: cwd);
    if (threadId == null || !mounted) return;
    await ref
        .read(threadManagerProvider)
        .loadThreads(deviceId: widget.deviceId);
    if (mounted) {
      context.openInPane(AppRoutes.conversation(threadId));
    }
  }

  String _title(List<TrustedDevice> devices) {
    for (final device in devices) {
      if (device.macDeviceId == widget.deviceId) return device.displayName;
    }
    return AppLocalizations.of(context).threadsTitle;
  }

  @override
  Widget build(BuildContext context) {
    final allThreads = ref.watch(threadsProvider).value ?? const <Thread>[];
    final sort = ref.watch(threadSortProvider);
    final compact = ref.watch(threadDensityCompactProvider);
    // Scope to the selected PC and hide archived threads (those live on the
    // Archived screen). Legacy threads with no device tag are still shown (they
    // get tagged on the next connected refresh); demo data is gone.
    final threads = allThreads
        .where((t) => t.status != ThreadStatus.archived)
        .where((t) => t.deviceId == null || t.deviceId == widget.deviceId)
        .toList();
    final devices = ref.watch(trustedDevicesProvider).value ?? const [];
    // Live operations target the PC we actually hold a channel to. Browsing a
    // different PC's threads is read-only until we connect to it.
    final connectedHere =
        ref.watch(connectedDeviceProvider).value?.macDeviceId ==
            widget.deviceId;
    final connectingHere =
        ref.watch(connectingDeviceProvider).value?.macDeviceId ==
            widget.deviceId;

    final worktreeSort = ref.watch(worktreeSortProvider);
    final projectSort = ref.watch(projectSortProvider);
    // Conversations are sorted BEFORE grouping — the grouping keeps the order
    // it is given, so one setting decides the order inside every folder.
    final groups = groupThreadsByWorkspace(
      threads: sortThreads(threads, sort, statusRank: _threadRank),
      projects: ref.watch(projectsProvider).value ?? const [],
      // Empty on a bridge without `git/worktrees`, which is exactly the
      // fallback: no table, no repository nodes, the flat list as before.
      repos: ref.watch(workspaceRepoTableProvider).value ?? const {},
    );
    final collapsed = ref.watch(collapsedProjectsProvider);
    // Each level is ordered by its OWN setting, including the worktrees inside
    // a project — the one list the menu could not reach while the tree sorted
    // them itself.
    final rows = _flatten(
      _sortNodes(
        buildWorkspaceTree(
          groups,
          orderWorkspaces: (a, b) => _compareGroups(a, b, worktreeSort),
        ),
        projectSort,
        worktreeSort,
      ),
      collapsed: collapsed,
    );

    final l10n = AppLocalizations.of(context);
    final actions = [
      // Search all of this PC's threads (ignores the agent filter).
      ThreadSearchAnchor(
        threads: threads,
        onSelect: (id) => context.openInPane(AppRoutes.conversation(id)),
      ),
      ThreadSortMenu(
        // The project group only appears when there IS one to order — a PC
        // whose folders never group would otherwise get a menu entry that
        // moves nothing it can see.
        projectSort: rows.any((r) => r is _RepoRow) ? projectSort : null,
        worktreeSort: worktreeSort,
        agentSort: sort,
        onChanged: (choice) {
          switch (choice.level) {
            case SortLevel.projects:
              ref.read(projectSortProvider.notifier).set(choice.value);
            case SortLevel.worktrees:
              ref.read(worktreeSortProvider.notifier).set(choice.value);
            case SortLevel.agents:
              unawaited(
                ref.read(threadSortProvider.notifier).set(choice.value),
              );
          }
        },
      ),
      ThreadMoreMenu(
        compact: compact,
        onCompactChanged: (value) =>
            ref.read(threadDensityCompactProvider.notifier).set(value: value),
        onArchived: () =>
            context.push(AppRoutes.deviceArchived(widget.deviceId)),
      ),
    ];

    final slivers = <Widget>[
      // App-update notice (Play In-App Update on Android / App Store on iOS).
      // Renders nothing unless an update is available and undismissed.
      const SliverToBoxAdapter(child: _UpdateBanner()),
      // Bridge-update notice: the paired PC's bridge reports it's outdated
      // (`bridge/status.updateAvailable`). Informational + dismissible.
      const SliverToBoxAdapter(child: _BridgeUpdateBanner()),
      if (!connectedHere)
        SliverToBoxAdapter(
          child: _OfflineBanner(
            connecting: connectingHere,
            onConnect: _connectHere,
          ),
        ),
      if (rows.isEmpty)
        const SliverFillRemaining(
          hasScrollBody: false,
          child: _EmptyThreads(),
        )
      else
        SliverPadding(
          padding: EdgeInsets.fromLTRB(
            widget.embedded ? UxnanSpacing.sm : UxnanSpacing.lg,
            UxnanSpacing.sm,
            widget.embedded ? UxnanSpacing.sm : UxnanSpacing.lg,
            UxnanSpacing.xxl,
          ),
          // Flattened rather than nested so the list stays lazy: a PC with
          // two hundred conversations builds the handful on screen, not the
          // whole tree.
          sliver: SliverList.builder(
            itemCount: rows.length,
            itemBuilder: (context, index) => NeEntranceRow(
              index: index,
              child: _buildRow(context, rows[index], compact: compact),
            ),
          ),
        ),
    ];

    if (widget.embedded) {
      return _EmbeddedSpaces(
        actions: actions,
        slivers: slivers,
        onNewConversation: connectedHere ? _newConversation : null,
      );
    }

    return NeScaffold(
      title: _title(devices),
      onRefresh: _refresh,
      actions: actions,
      // The list is long and the button covers its bottom-right corner, which
      // is where the rows you are scrolling toward arrive.
      hideFabOnScroll: true,
      floatingActionButton: FloatingActionButton.extended(
        // New conversations only make sense against the live PC.
        onPressed: connectedHere ? _newConversation : null,
        icon: const UxIcon(UxIcons.addComment),
        label: Text(l10n.newThreadAction),
        backgroundColor: connectedHere
            ? null
            : Theme.of(context).colorScheme.surfaceContainerHighest,
      ),
      slivers: slivers,
    );
  }

  /// Orders the top level: projects by their own setting, lone worktrees by
  /// the worktree setting, and the two interleaved so the list reads as one.
  ///
  /// A project and a lone worktree are peers on screen even though they are
  /// different things, so they cannot be sorted into two blocks — that would
  /// put every project above every folder regardless of what either setting
  /// says.
  List<WorkspaceTreeNode> _sortNodes(
    List<WorkspaceTreeNode> nodes,
    ListSort projectSort,
    ListSort worktreeSort,
  ) {
    final list = [...nodes]..sort((a, b) {
        final sort = a is RepoWithWorktrees && b is RepoWithWorktrees
            ? projectSort
            : worktreeSort;
        return _compareNodes(a, b, sort);
      });
    return list;
  }

  int _compareNodes(WorkspaceTreeNode a, WorkspaceTreeNode b, ListSort sort) {
    return switch (sort) {
      ListSort.name =>
        _nodeLabel(a).toLowerCase().compareTo(_nodeLabel(b).toLowerCase()),
      ListSort.activity => compareByDate(
          _nodeActivity(a),
          _nodeActivity(b),
          _nodeLabel(a),
          _nodeLabel(b),
        ),
      ListSort.created => compareByDate(
          _nodeCreated(a),
          _nodeCreated(b),
          _nodeLabel(a),
          _nodeLabel(b),
        ),
      ListSort.status => () {
          final byState = _nodeRank(a).compareTo(_nodeRank(b));
          // Within the same urgency, what moved last is what you were most
          // likely looking at.
          return byState != 0
              ? byState
              : compareByDate(
                  _nodeActivity(a),
                  _nodeActivity(b),
                  _nodeLabel(a),
                  _nodeLabel(b),
                );
        }(),
    };
  }

  int _compareGroups(WorkspaceGroup a, WorkspaceGroup b, ListSort sort) {
    return switch (sort) {
      ListSort.name => a.label.toLowerCase().compareTo(b.label.toLowerCase()),
      ListSort.activity => compareByDate(
          workspaceLastActivity(a),
          workspaceLastActivity(b),
          a.label,
          b.label,
        ),
      ListSort.created => compareByDate(
          workspaceCreatedAt(a),
          workspaceCreatedAt(b),
          a.label,
          b.label,
        ),
      ListSort.status => () {
          final byState = _groupRank(a).compareTo(_groupRank(b));
          return byState != 0
              ? byState
              : compareByDate(
                  workspaceLastActivity(a),
                  workspaceLastActivity(b),
                  a.label,
                  b.label,
                );
        }(),
    };
  }

  List<WorkspaceGroup> _workspacesOf(WorkspaceTreeNode node) => switch (node) {
        LoneWorkspace(:final workspace) => [workspace],
        RepoWithWorktrees(:final repo) => repo.workspaces,
      };

  String _nodeLabel(WorkspaceTreeNode node) => switch (node) {
        LoneWorkspace(:final workspace) => workspace.label,
        RepoWithWorktrees(:final repo) => repo.label,
      };

  DateTime? _nodeActivity(WorkspaceTreeNode node) {
    DateTime? newest;
    for (final group in _workspacesOf(node)) {
      final at = workspaceLastActivity(group);
      if (at == null) continue;
      if (newest == null || at.isAfter(newest)) newest = at;
    }
    return newest;
  }

  DateTime? _nodeCreated(WorkspaceTreeNode node) {
    DateTime? oldest;
    for (final group in _workspacesOf(node)) {
      final at = workspaceCreatedAt(group);
      if (at == null) continue;
      if (oldest == null || at.isBefore(oldest)) oldest = at;
    }
    return oldest;
  }

  int _nodeRank(WorkspaceTreeNode node) {
    var best = 5;
    for (final group in _workspacesOf(node)) {
      final rank = _groupRank(group);
      if (rank < best) best = rank;
    }
    return best;
  }

  int _groupRank(WorkspaceGroup group) =>
      _rankOf(aggregateStatus(ref, group.threads).state);

  int _threadRank(Thread thread) =>
      _rankOf(ref.watch(agentRunStatusProvider(thread.id)).state);

  static int _rankOf(AgentRunState state) => switch (state) {
        AgentRunState.waiting => 0,
        AgentRunState.blocked => 1,
        AgentRunState.working => 2,
        AgentRunState.done => 3,
        AgentRunState.idle => 4,
      };

  /// Turns the folders into the flat run of rows the sliver builds from.
  ///
  /// Flat, not nested: a nested tree would build every conversation the moment
  /// the screen appears, and this list is the one place a PC with hundreds of
  /// them has to stay responsive.
  List<_SpaceRow> _flatten(
    List<WorkspaceTreeNode> nodes, {
    required Set<String> collapsed,
  }) {
    final rows = <_SpaceRow>[];

    void addWorkspace(WorkspaceGroup group, {required int depth}) {
      // A conversation with no folder of its own has nothing to head; it
      // stands on its own rather than under an empty heading.
      final headed = group.key.isNotEmpty;
      final open = !collapsed.contains(group.key);
      if (headed) {
        rows.add(_WorkspaceRow(group, expanded: open, depth: depth));
      }
      if (headed && !open) return;
      for (final thread in group.threads) {
        rows.add(
          _ThreadRow(thread, depth: headed ? depth + 1 : depth),
        );
      }
    }

    for (final node in nodes) {
      switch (node) {
        case LoneWorkspace(:final workspace):
          addWorkspace(workspace, depth: 0);
        case RepoWithWorktrees(:final repo):
          final open = !collapsed.contains(repo.key);
          rows.add(_RepoRow(repo, expanded: open));
          if (!open) continue;
          for (final workspace in repo.workspaces) {
            addWorkspace(workspace, depth: 1);
          }
      }
    }
    return rows;
  }

  Widget _buildRow(
    BuildContext context,
    _SpaceRow row, {
    required bool compact,
  }) {
    switch (row) {
      case _RepoRow(:final repo, :final expanded):
        return RepoGroupRow(
          key: ValueKey('repo-${repo.key}'),
          repo: repo,
          expanded: expanded,
          onToggle: () =>
              ref.read(collapsedProjectsProvider.notifier).toggle(repo.key),
        );
      case _WorkspaceRow(:final group, :final expanded, :final depth):
        return Padding(
          padding: EdgeInsets.only(left: depth * kSpaceIndent),
          child: WorkspaceGroupRow(
            key: ValueKey('workspace-${group.key}'),
            group: group,
            expanded: expanded,
            onToggle: () =>
                ref.read(collapsedProjectsProvider.notifier).toggle(group.key),
            onDetails: () => showWorkspaceDetails(
              context,
              group,
              fullPath: group.path,
              onOpenThread: (id) =>
                  context.openInPane(AppRoutes.conversation(id)),
            ),
            onNewConversation: () => _newConversation(cwd: group.path),
          ),
        );
      case _ThreadRow(:final thread, :final depth):
        return Padding(
          padding: EdgeInsets.only(
            left: depth * kSpaceIndent,
            bottom: compact ? UxnanSpacing.xs : UxnanSpacing.sm,
          ),
          child: ThreadTile(
            key: ValueKey('thread-${thread.id}'),
            thread: thread,
            compact: compact,
          ),
        );
    }
  }
}

/// A row in the flattened spaces list.
sealed class _SpaceRow {
  const _SpaceRow();
}

class _RepoRow extends _SpaceRow {
  const _RepoRow(this.repo, {required this.expanded});
  final RepoGroup repo;
  final bool expanded;
}

class _WorkspaceRow extends _SpaceRow {
  const _WorkspaceRow(this.group, {required this.expanded, this.depth = 0});
  final WorkspaceGroup group;
  final bool expanded;
  final int depth;
}

class _ThreadRow extends _SpaceRow {
  const _ThreadRow(this.thread, {required this.depth});
  final Thread thread;
  final int depth;
}

/// Shown above the list when we are NOT connected to this PC: the threads are a
/// cached, read-only view and going live needs a (validated) connection here.
class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner({required this.connecting, required this.onConnect});
  final bool connecting;
  final VoidCallback onConnect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.sm,
        UxnanSpacing.lg,
        0,
      ),
      padding: const EdgeInsets.all(UxnanSpacing.md),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Row(
        children: [
          UxIcon(
            UxIcons.cloudOff,
            size: 18,
            color: colors.onSurfaceVariant,
          ),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Text(
              l10n.threadsNotConnected,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
            ),
          ),
          const SizedBox(width: UxnanSpacing.sm),
          FilledButton.tonal(
            onPressed: connecting ? null : onConnect,
            child: Text(
              connecting ? l10n.connectionConnecting : l10n.deviceConnect,
            ),
          ),
        ],
      ),
    );
  }
}

/// A dismissible "update available" notice shown atop the thread list, kept in
/// sync with the Updates settings section via the same controller. Reflects the
/// download → install flow (Play In-App Update on Android, App Store on iOS):
/// *Download*/*Update* → progress → *Install now*. *Not now* hides it for this
/// version (only at the available stage). Renders nothing when no undismissed
/// update is in play.
class _UpdateBanner extends ConsumerWidget {
  const _UpdateBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(appUpdateControllerProvider);
    if (!state.bannerVisible) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final controller = ref.read(appUpdateControllerProvider.notifier);
    final version = state.status?.storeVersion;
    final body = _body(l10n, state, version: version);

    return Container(
      margin: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.sm,
        UxnanSpacing.lg,
        0,
      ),
      padding: const EdgeInsets.all(UxnanSpacing.md),
      decoration: BoxDecoration(
        color: colors.primaryContainer,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              UxIcon(
                UxIcons.systemUpdate,
                size: 18,
                color: colors.onPrimaryContainer,
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Text(
                  l10n.updateAvailableTitle,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: colors.onPrimaryContainer,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            body,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: colors.onPrimaryContainer,
                ),
          ),
          const SizedBox(height: UxnanSpacing.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: _actions(l10n, controller, state),
          ),
        ],
      ),
    );
  }

  String _body(
    AppLocalizations l10n,
    AppUpdateState state, {
    required String? version,
  }) {
    switch (state.phase) {
      case AppUpdatePhase.downloading:
        final fraction = state.install?.fraction;
        return fraction == null
            ? l10n.updateStatusDownloading
            : l10n.updateStatusDownloadingPercent((fraction * 100).round());
      case AppUpdatePhase.downloaded:
        return l10n.updateStatusDownloaded;
      case AppUpdatePhase.installing:
        return l10n.updateStatusInstalling;
      case AppUpdatePhase.available:
      case AppUpdatePhase.idle:
      case AppUpdatePhase.checking:
      case AppUpdatePhase.upToDate:
      case AppUpdatePhase.error:
        return version == null
            ? l10n.updateAvailableBody
            : l10n.updateAvailableBodyVersion(version);
    }
  }

  List<Widget> _actions(
    AppLocalizations l10n,
    AppUpdateController controller,
    AppUpdateState state,
  ) {
    switch (state.phase) {
      case AppUpdatePhase.downloading:
        return const [PolygonLoader()];
      case AppUpdatePhase.installing:
        return const [PolygonLoader()];
      case AppUpdatePhase.downloaded:
        return [
          FilledButton(
            onPressed: controller.install,
            child: Text(l10n.updateInstallAction),
          ),
        ];
      case AppUpdatePhase.available:
      case AppUpdatePhase.idle:
      case AppUpdatePhase.checking:
      case AppUpdatePhase.upToDate:
      case AppUpdatePhase.error:
        final isIos = state.status?.channel == UpdateChannel.appStore;
        return [
          TextButton(
            onPressed: controller.dismiss,
            child: Text(l10n.updateDismissAction),
          ),
          const SizedBox(width: UxnanSpacing.xs),
          FilledButton(
            onPressed: state.starting ? null : controller.download,
            child: Text(
              isIos ? l10n.updateAction : l10n.updateDownloadAction,
            ),
          ),
        ];
    }
  }
}

/// A dismissible, informational notice shown atop the thread list when the
/// paired PC's Uxnan bridge reports a newer version is available
/// (`bridge/status.updateAvailable`). The bridge is the core engine, so we
/// nudge the user to update it **on their computer**. The phone can't update
/// it, so there's no action button — swipe it away or tap the close icon to
/// hide it until a newer bridge appears. Renders nothing when the bridge is up
/// to date, unknown, or the notice was dismissed.
class _BridgeUpdateBanner extends ConsumerWidget {
  const _BridgeUpdateBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final info = ref.watch(bridgeUpdateProvider);
    if (info == null) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final latest = info.latestVersion;
    final body = latest == null
        ? l10n.bridgeUpdateBody
        : l10n.bridgeUpdateBodyVersion(latest);

    return Dismissible(
      key: ValueKey('bridge-update-${latest ?? ''}'),
      onDismissed: (_) =>
          ref.read(bridgeUpdateDismissalProvider.notifier).dismiss(latest),
      child: Container(
        margin: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          UxnanSpacing.sm,
          UxnanSpacing.lg,
          0,
        ),
        padding: const EdgeInsets.all(UxnanSpacing.md),
        decoration: BoxDecoration(
          color: colors.tertiaryContainer,
          borderRadius: const BorderRadius.all(UxnanRadius.lg),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                UxIcon(
                  UxIcons.dns,
                  size: 18,
                  color: colors.onTertiaryContainer,
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    l10n.bridgeUpdateTitle,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: colors.onTertiaryContainer,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                ),
                IconButton(
                  onPressed: () => ref
                      .read(bridgeUpdateDismissalProvider.notifier)
                      .dismiss(latest),
                  icon: const UxIcon(UxIcons.close, size: 18),
                  color: colors.onTertiaryContainer,
                  tooltip: l10n.bridgeUpdateDismiss,
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              body,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onTertiaryContainer,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyThreads extends StatelessWidget {
  const _EmptyThreads();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            UxIcon(
              UxIcons.forum,
              size: 48,
              color: colors.onSurfaceVariant,
              semanticLabel: 'Threads',
            ),
            const SizedBox(height: UxnanSpacing.md),
            Text(l10n.threadsEmpty, style: textTheme.titleMedium),
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              l10n.threadsEmptyBody,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

/// The spaces tree as the **content** of the permanent drawer's middle zone.
///
/// The same list, its controls and its behaviours — only the chrome differs.
/// A drawer already has a header above and a profile row below, so the app bar
/// would be a third; and an extended FAB floating over a 320 dp column would
/// cover the very rows it sits on. The action that FAB carries moves to a plain
/// button under the list, where it cannot obscure anything.
class _EmbeddedSpaces extends StatelessWidget {
  const _EmbeddedSpaces({
    required this.actions,
    required this.slivers,
    required this.onNewConversation,
  });

  final List<Widget> actions;
  final List<Widget> slivers;

  /// Null when this PC is not the connected one — a new conversation only
  /// makes sense against a live bridge.
  final VoidCallback? onNewConversation;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    // The list rises into place here exactly as it does full-screen; the scope
    // comes free from NeScaffold there and has to be declared here.
    return NeEntranceScope(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: UxnanSpacing.sm,
              vertical: UxnanSpacing.xs,
            ),
            child: Row(
              children: [
                // Leads the row, and it is the only PRIMARY-toned control in
                // the drawer: everything else here finds or reorders what
                // already exists, and this is the one that makes something.
                // A full-width button under the list read as the drawer's
                // conclusion rather than as its main action.
                IconSurface(
                  icon: UxIcons.addComment,
                  tooltip: l10n.newThreadAction,
                  onPressed: onNewConversation,
                  background: colors.primaryContainer,
                  foreground: colors.onPrimaryContainer,
                ),
                const Spacer(),
                ...actions,
              ],
            ),
          ),
          Expanded(child: CustomScrollView(slivers: slivers)),
        ],
      ),
    );
  }
}
