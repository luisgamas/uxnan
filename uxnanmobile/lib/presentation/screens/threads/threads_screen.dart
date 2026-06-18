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
  /// The selected agent filter; null means "all agents".
  AgentId? _agentFilter;

  /// The selected project filter (a project key — `projectId` or `cwd`); null
  /// means "all projects". In-memory, like the agent filter. Inert while the
  /// project filter is disabled (it's never set, so it stays null).
  String? _projectFilter;

  /// FOR-DEV: project-scope filtering is **fully implemented** (the
  /// [_ProjectFilterBar] chips, the [_projectsPresent]/[_projectKeyOf] grouping
  /// and the compose-with-agent filter) and the bridge side scopes too
  /// (`loadThreads(projectId:)`), but it is **intentionally disabled in the
  /// UI**: a flat chip bar isn't the right surface. Re-enable it from a proper
  /// **advanced filters / organization view** (per the maintainer) — flip this
  /// to `true` (ideally moving the control into that view). Code + back stay
  /// ready; nothing else needs to change to turn it on.
  bool get _projectFilterEnabled => false;

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
    // Project chips are computed only when the (disabled) project filter is on.
    final projects = _projectFilterEnabled
        ? _projectsPresent(threads)
        : const <_ProjectChip>[];
    // Agent + project filters compose: a thread is visible only if it passes
    // both (each is independent and computed from the device-scoped set). The
    // project filter is inert while disabled (`_projectFilter` stays null).
    final filtered = threads.where((t) {
      final agentOk = _agentFilter == null ||
          AgentIdParsing.fromWireId(t.agentId) == _agentFilter;
      final projectOk =
          _projectFilter == null || _projectKeyOf(t) == _projectFilter;
      return agentOk && projectOk;
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
        // Per-agent filter chips (only when more than one agent is present).
        if (agents.length > 1)
          SliverToBoxAdapter(
            child: _AgentFilterBar(
              agents: agents,
              selected: _agentFilter,
              onSelected: (agent) => setState(() => _agentFilter = agent),
            ),
          ),
        // Per-project filter chips — DISABLED in the UI (see
        // [_projectFilterEnabled]); the bar + filter stay implemented so they
        // can be surfaced from a future advanced filters view.
        if (_projectFilterEnabled && projects.length > 1)
          SliverToBoxAdapter(
            child: _ProjectFilterBar(
              projects: projects,
              selected: _projectFilter,
              onSelected: (key) => setState(() => _projectFilter = key),
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

class _AgentFilterBar extends StatelessWidget implements PreferredSizeWidget {
  const _AgentFilterBar({
    required this.agents,
    required this.selected,
    required this.onSelected,
  });

  final List<AgentId> agents;
  final AgentId? selected;
  final ValueChanged<AgentId?> onSelected;

  @override
  Size get preferredSize => const Size.fromHeight(52);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.lg,
          vertical: UxnanSpacing.sm,
        ),
        children: [
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
        ],
      ),
    );
  }
}

/// Horizontal chips that scope the list to one project (working folder). Mirrors
/// [_AgentFilterBar]; shown only when the PC hosts more than one project.
class _ProjectFilterBar extends StatelessWidget {
  const _ProjectFilterBar({
    required this.projects,
    required this.selected,
    required this.onSelected,
  });

  final List<_ProjectChip> projects;
  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.lg,
          vertical: UxnanSpacing.sm,
        ),
        children: [
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
        ],
      ),
    );
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
