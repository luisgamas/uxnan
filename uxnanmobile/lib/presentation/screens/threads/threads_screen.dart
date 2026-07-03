import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/threads/new_conversation_screen.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart';
import 'package:uxnan/presentation/screens/threads/thread_tile.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// The threads of a connected PC (spec 02a §5.4.2). Lists the active bridge's
/// threads with per-agent filter chips, and opens a thread's conversation.
class ThreadsScreen extends ConsumerStatefulWidget {
  /// Creates a [ThreadsScreen] for the device with [deviceId].
  const ThreadsScreen({required this.deviceId, super.key});

  /// The PC whose threads are shown (used for the title).
  final String deviceId;

  @override
  ConsumerState<ThreadsScreen> createState() => _ThreadsScreenState();
}

class _ThreadsScreenState extends ConsumerState<ThreadsScreen> {
  /// Which dimension the chip bar filters on. The scope selector on the left
  /// of the bar switches between agent and project; the filter chips to the
  /// right of it change to match. One scope is active at a time — switching
  /// clears the other filter so the state stays consistent.
  _ThreadScope _scope = _ThreadScope.agent;

  /// The selected agent filter; null means "all agents".
  AgentId? _agentFilter;

  /// The selected project filter (a project key — `projectId` or `cwd`); null
  /// means "all projects". In-memory, like the agent filter. Only consulted
  /// while [_scope] is [_ThreadScope.project].
  String? _projectFilter;

  /// Switches the active scope. Clears the other dimension's filter so the
  /// two stay independent — a previously-selected project filter has no
  /// meaning under the agent scope and vice versa.
  void _setScope(_ThreadScope scope) {
    if (scope == _scope) return;
    setState(() {
      _scope = scope;
      if (scope == _ThreadScope.agent) {
        _projectFilter = null;
      } else {
        _agentFilter = null;
      }
    });
  }

  @override
  void initState() {
    super.initState();
    // Pull this PC's threads on open so they get tagged with the device and the
    // list reflects the connected bridge.
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
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

  Future<void> _newConversation() async {
    final threadId = await NewConversationScreen.show(context);
    if (threadId == null || !mounted) return;
    await ref
        .read(threadManagerProvider)
        .loadThreads(deviceId: widget.deviceId);
    if (mounted) unawaited(context.push(AppRoutes.conversation(threadId)));
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

    final agents = _agentsPresent(threads);
    // Project chips are computed only when the project scope is active.
    final projects = _scope == _ThreadScope.project
        ? _projectsPresent(threads)
        : const <_ProjectChip>[];
    // Only the active scope's filter is consulted; the other dimension's
    // filter is cleared on scope change so the two stay independent.
    final filtered = threads.where((t) {
      if (_scope == _ThreadScope.agent) {
        return _agentFilter == null ||
            AgentIdParsing.fromWireId(t.agentId) == _agentFilter;
      }
      return _projectFilter == null || _projectKeyOf(t) == _projectFilter;
    }).toList();
    final visible = sortThreads(filtered, sort);

    final l10n = AppLocalizations.of(context);

    return NeScaffold(
      title: _title(devices),
      onRefresh: _refresh,
      actions: [
        // Search all of this PC's threads (ignores the agent filter).
        ThreadSearchAnchor(
          threads: threads,
          onSelect: (id) => context.push(AppRoutes.conversation(id)),
        ),
        ThreadSortMenu(
          sort: sort,
          onChanged: (value) =>
              ref.read(threadSortProvider.notifier).set(value),
        ),
        ThreadMoreMenu(
          compact: compact,
          onCompactChanged: (value) =>
              ref.read(threadDensityCompactProvider.notifier).set(value: value),
          onArchived: () =>
              context.push(AppRoutes.deviceArchived(widget.deviceId)),
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        // New conversations only make sense against the live PC.
        onPressed: connectedHere ? _newConversation : null,
        icon: const Icon(Icons.add_comment_outlined),
        label: Text(l10n.newThreadAction),
        backgroundColor: connectedHere
            ? null
            : Theme.of(context).colorScheme.surfaceContainerHighest,
      ),
      slivers: [
        // App-update notice (Play In-App Update on Android / App Store on iOS).
        // Renders nothing unless an update is available and undismissed.
        const SliverToBoxAdapter(child: _UpdateBanner()),
        // Bridge-update notice: the paired PC's bridge reports it's outdated
        // (`bridge/status.updateAvailable`). Informational + dismissible.
        const SliverToBoxAdapter(child: _BridgeUpdateBanner()),
        // Filter bar: a scope selector on the left (Agent / Project) and the
        // matching chip bar to the right. The scope is always visible; the
        // chip bar only appears when there's more than one option to choose
        // from in the active scope (multiple agents or multiple projects).
        if (agents.length > 1 || projects.length > 1)
          SliverToBoxAdapter(
            child: _FilterBar(
              scope: _scope,
              onScopeChanged: _setScope,
              // Each bar's chips are spread into the parent ListView so the
              // whole bar scrolls as one unit (nesting a horizontal ListView
              // inside another would give the inner one unbounded width).
              chips: _scope == _ThreadScope.agent && agents.length > 1
                  ? _AgentFilterBar(
                      agents: agents,
                      selected: _agentFilter,
                      onSelected: (agent) =>
                          setState(() => _agentFilter = agent),
                    ).chips(l10n)
                  : _scope == _ThreadScope.project && projects.length > 1
                      ? _ProjectFilterBar(
                          projects: projects,
                          selected: _projectFilter,
                          onSelected: (key) =>
                              setState(() => _projectFilter = key),
                        ).chips(l10n)
                      : const <Widget>[],
            ),
          ),
        if (!connectedHere)
          SliverToBoxAdapter(
            child: _OfflineBanner(
              connecting: connectingHere,
              onConnect: _connectHere,
            ),
          ),
        if (visible.isEmpty)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: _EmptyThreads(),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.lg,
            ),
            sliver: SliverList.separated(
              itemCount: visible.length,
              separatorBuilder: (_, __) => SizedBox(
                height: compact ? UxnanSpacing.sm : UxnanSpacing.md,
              ),
              itemBuilder: (context, index) =>
                  ThreadTile(thread: visible[index], compact: compact),
            ),
          ),
      ],
    );
  }

  List<AgentId> _agentsPresent(List<Thread> threads) {
    final seen = <AgentId>{};
    for (final thread in threads) {
      seen.add(AgentIdParsing.fromWireId(thread.agentId));
    }
    return seen.toList();
  }

  /// A thread's project identity: its `projectId` when set, else its `cwd`
  /// (the folder is the user-facing "project"). Empty when neither is known —
  /// such threads only appear under the "All" chip.
  String _projectKeyOf(Thread thread) {
    final projectId = thread.projectId;
    if (projectId != null && projectId.isNotEmpty) return projectId;
    return thread.cwd ?? '';
  }

  /// The distinct projects present in [threads], each as a `(key, label)`
  /// where the label is the folder basename (falling back to the key).
  /// Sorted alphabetically by label.
  List<_ProjectChip> _projectsPresent(List<Thread> threads) {
    final byKey = <String, String>{};
    for (final thread in threads) {
      final key = _projectKeyOf(thread);
      if (key.isEmpty) continue;
      final cwd = thread.cwd;
      final label = (cwd != null && cwd.isNotEmpty)
          ? cwd.split(RegExp(r'[\\/]')).last
          : key;
      byKey.putIfAbsent(key, () => label);
    }
    final chips = byKey.entries
        .map((e) => _ProjectChip(key: e.key, label: e.value))
        .toList()
      ..sort(
        (a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()),
      );
    return chips;
  }
}

/// A distinct project present in the list: its filter [key] (`projectId` or
/// `cwd`) and the human [label] shown on the chip (the folder basename).
class _ProjectChip {
  const _ProjectChip({required this.key, required this.label});
  final String key;
  final String label;
}

/// Which dimension the filter bar is currently scoping on. The selector on the
/// left of the bar switches between these; the chip bar to the right of it
/// changes to match.
enum _ThreadScope { agent, project }

/// The full filter bar: a scope selector on the left (Agent / Project) and the
/// matching chip bar to the right. The scope is always visible; the chip bar
/// is passed in as a list of widgets (or empty when the active scope has only
/// one option to pick from, in which case the bar collapses to just the
/// selector). The whole bar is a single horizontal scroller — nesting another
/// horizontal `ListView` inside this one would give the inner viewport an
/// unbounded width.
class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.scope,
    required this.onScopeChanged,
    this.chips = const [],
  });

  final _ThreadScope scope;
  final ValueChanged<_ThreadScope> onScopeChanged;
  final List<Widget> chips;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.lg,
          vertical: UxnanSpacing.sm,
        ),
        children: [
          _ScopeSelector(scope: scope, onChanged: onScopeChanged),
          ...chips,
        ],
      ),
    );
  }
}

/// A chip-styled menu trigger on the left of the filter bar that shows the
/// active scope (Agent / Project) and opens a small popup to switch between
/// them. Same visual language as the filter chips to its right.
class _ScopeSelector extends StatelessWidget {
  const _ScopeSelector({required this.scope, required this.onChanged});

  final _ThreadScope scope;
  final ValueChanged<_ThreadScope> onChanged;

  /// Opens the scope picker anchored under the chip. We drive the menu from
  /// the chip's own `onPressed` (via [showMenu]) rather than wrapping it in a
  /// `PopupMenuButton`: a bare `ActionChip` with `onPressed: null` is rendered
  /// in Flutter's *disabled* visual state (`isEnabled = onPressed != null`),
  /// which is the washed-out grey look we want to avoid. Keeping `onPressed`
  /// non-null makes the chip read as a live, tappable control.
  Future<void> _openMenu(BuildContext context, AppLocalizations l10n) async {
    final button = context.findRenderObject()! as RenderBox;
    final overlay =
        Navigator.of(context).overlay!.context.findRenderObject()! as RenderBox;
    final position = RelativeRect.fromRect(
      Rect.fromPoints(
        button.localToGlobal(
          Offset(0, button.size.height),
          ancestor: overlay,
        ),
        button.localToGlobal(
          button.size.bottomRight(Offset.zero),
          ancestor: overlay,
        ),
      ),
      Offset.zero & overlay.size,
    );
    final selected = await showMenu<_ThreadScope>(
      context: context,
      position: position,
      items: [
        CheckedPopupMenuItem<_ThreadScope>(
          value: _ThreadScope.agent,
          checked: scope == _ThreadScope.agent,
          child: Row(
            children: [
              const Icon(Icons.person_outline, size: 18),
              const SizedBox(width: UxnanSpacing.sm),
              Text(l10n.threadsFilterByAgent),
            ],
          ),
        ),
        CheckedPopupMenuItem<_ThreadScope>(
          value: _ThreadScope.project,
          checked: scope == _ThreadScope.project,
          child: Row(
            children: [
              const Icon(Icons.folder_outlined, size: 18),
              const SizedBox(width: UxnanSpacing.sm),
              Text(l10n.threadsFilterByProject),
            ],
          ),
        ),
      ],
    );
    if (selected != null) onChanged(selected);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isAgent = scope == _ThreadScope.agent;
    final label =
        isAgent ? l10n.threadsFilterByAgent : l10n.threadsFilterByProject;
    final icon = isAgent ? Icons.person_outline : Icons.folder_outlined;
    return Padding(
      padding: const EdgeInsets.only(right: UxnanSpacing.sm),
      child: ActionChip(
        tooltip: l10n.threadsFilterScopeTooltip,
        onPressed: () => _openMenu(context, l10n),
        label: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16),
            const SizedBox(width: UxnanSpacing.xs),
            Text(label),
            const SizedBox(width: UxnanSpacing.xs),
            const Icon(Icons.arrow_drop_down_rounded, size: 18),
          ],
        ),
      ),
    );
  }
}

class _AgentFilterBar {
  const _AgentFilterBar({
    required this.agents,
    required this.selected,
    required this.onSelected,
  });

  final List<AgentId> agents;
  final AgentId? selected;
  final ValueChanged<AgentId?> onSelected;

  /// Builds the horizontal list of chips for the agent scope. The caller is
  /// responsible for placing these in a horizontally-scrolling container
  /// (the [_FilterBar]'s `ListView`).
  List<Widget> chips(AppLocalizations l10n) {
    return [
      Padding(
        padding: const EdgeInsets.only(right: UxnanSpacing.sm),
        child: ChoiceChip(
          label: Text(l10n.threadsFilterAll),
          selected: selected == null,
          onSelected: (_) => onSelected(null),
        ),
      ),
      for (final agent in agents)
        Padding(
          padding: const EdgeInsets.only(right: UxnanSpacing.sm),
          child: ChoiceChip(
            label: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                AgentChipAvatar(agent: agent),
                const SizedBox(width: UxnanSpacing.xs),
                Text(AgentVisuals.labelFor(agent)),
              ],
            ),
            selected: selected == agent,
            onSelected: (_) => onSelected(agent),
          ),
        ),
    ];
  }
}

/// Horizontal chips that scope the list to one project (working folder).
/// Mirrors [_AgentFilterBar]; shown only when the PC hosts more than one
/// project.
class _ProjectFilterBar {
  const _ProjectFilterBar({
    required this.projects,
    required this.selected,
    required this.onSelected,
  });

  final List<_ProjectChip> projects;
  final String? selected;
  final ValueChanged<String?> onSelected;

  /// Builds the horizontal list of chips for the project scope. The caller is
  /// responsible for placing these in a horizontally-scrolling container.
  List<Widget> chips(AppLocalizations l10n) {
    return [
      Padding(
        padding: const EdgeInsets.only(right: UxnanSpacing.sm),
        child: ChoiceChip(
          label: Text(l10n.threadsFilterAll),
          selected: selected == null,
          onSelected: (_) => onSelected(null),
        ),
      ),
      for (final project in projects)
        Padding(
          padding: const EdgeInsets.only(right: UxnanSpacing.sm),
          child: ChoiceChip(
            label: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.folder_outlined, size: 16),
                const SizedBox(width: UxnanSpacing.xs),
                Text(project.label),
              ],
            ),
            selected: selected == project.key,
            onSelected: (_) => onSelected(project.key),
          ),
        ),
    ];
  }
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
          Icon(
            Icons.cloud_off_outlined,
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

/// A dismissible "update available" notice shown atop the thread list when the
/// store reports a newer version (Play In-App Update on Android, App Store on
/// iOS). Tapping *Update* starts the platform update flow; *Not now* hides it
/// for this version. Renders nothing when no undismissed update is available.
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
    final body = version == null
        ? l10n.updateAvailableBody
        : l10n.updateAvailableBodyVersion(version);

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
              Icon(
                Icons.system_update_outlined,
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
            children: [
              TextButton(
                onPressed: controller.dismiss,
                child: Text(l10n.updateDismissAction),
              ),
              const SizedBox(width: UxnanSpacing.xs),
              FilledButton(
                onPressed: state.starting ? null : controller.startUpdate,
                child: Text(
                  state.starting
                      ? l10n.updateActionStarting
                      : l10n.updateAction,
                ),
              ),
            ],
          ),
        ],
      ),
    );
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
                Icon(
                  Icons.dns_outlined,
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
                  icon: const Icon(Icons.close_rounded, size: 18),
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
            Icon(
              Icons.forum_outlined,
              size: 48,
              color: colors.onSurfaceVariant,
              semanticLabel: 'Threads',
            ),
            const SizedBox(height: UxnanSpacing.md),
            Text(l10n.threadsEmpty, style: textTheme.titleSmall),
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
