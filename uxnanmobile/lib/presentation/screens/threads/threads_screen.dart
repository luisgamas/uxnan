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
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/threads/new_conversation_screen.dart';
import 'package:uxnan/presentation/screens/threads/space_rows.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart';
import 'package:uxnan/presentation/screens/threads/thread_tile.dart';
import 'package:uxnan/presentation/screens/threads/workspace_details_sheet.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_entrance_scope.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

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

  Future<void> _newConversation({String? cwd}) async {
    final threadId = await NewConversationScreen.show(context, initialCwd: cwd);
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

    final spaceSort = ref.watch(spaceSortProvider);
    // Conversations are sorted BEFORE grouping — the grouping keeps the order
    // it is given, so one setting decides the order inside every folder.
    final groups = _sortSpaces(
      groupThreadsByWorkspace(
        threads: sortThreads(threads, sort),
        projects: ref.watch(projectsProvider).value ?? const [],
      ),
      spaceSort,
    );
    final collapsed = ref.watch(collapsedProjectsProvider);
    final rows = _flatten(groups, collapsed: collapsed);

    final l10n = AppLocalizations.of(context);

    return NeEntranceScope(
      child: NeScaffold(
        title: _title(devices),
        onRefresh: _refresh,
        actions: [
          // Search all of this PC's threads (ignores the agent filter).
          ThreadSearchAnchor(
            threads: threads,
            onSelect: (id) => context.push(AppRoutes.conversation(id)),
          ),
          ThreadSortMenu(
            spaceSort: spaceSort,
            threadSort: sort,
            onChanged: (choice) => switch (choice) {
              SpaceSortChoice(:final value) =>
                ref.read(spaceSortProvider.notifier).set(value),
              ThreadSortChoice(:final value) =>
                ref.read(threadSortProvider.notifier).set(value),
            },
          ),
          ThreadMoreMenu(
            compact: compact,
            onCompactChanged: (value) => ref
                .read(threadDensityCompactProvider.notifier)
                .set(value: value),
            onArchived: () =>
                context.push(AppRoutes.deviceArchived(widget.deviceId)),
          ),
        ],
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
        slivers: [
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
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.lg,
                UxnanSpacing.sm,
                UxnanSpacing.lg,
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
        ],
      ),
    );
  }

  /// Orders the folders. Attention first by default: the reason to open this
  /// screen is usually "what happened", not "what exists".
  List<WorkspaceGroup> _sortSpaces(
    List<WorkspaceGroup> groups,
    SpaceSort sort,
  ) {
    final list = [...groups];
    switch (sort) {
      case SpaceSort.name:
        list.sort(
          (a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()),
        );
      case SpaceSort.activity:
        list.sort((a, b) => _lastMoved(b).compareTo(_lastMoved(a)));
      case SpaceSort.attention:
        list.sort((a, b) {
          final byState = _attentionRank(ref, a).compareTo(
            _attentionRank(ref, b),
          );
          // Within the same urgency, the one that moved last is the one you
          // were most likely looking at.
          return byState != 0
              ? byState
              : _lastMoved(b).compareTo(_lastMoved(a));
        });
    }
    return list;
  }

  static DateTime _lastMoved(WorkspaceGroup group) {
    DateTime? newest;
    for (final thread in group.threads) {
      final at = thread.lastActivity;
      if (at == null) continue;
      if (newest == null || at.isAfter(newest)) newest = at;
    }
    return newest ?? DateTime.fromMillisecondsSinceEpoch(0);
  }

  static int _attentionRank(WidgetRef ref, WorkspaceGroup group) {
    return switch (aggregateStatus(ref, group.threads).state) {
      AgentRunState.waiting => 0,
      AgentRunState.blocked => 1,
      AgentRunState.working => 2,
      AgentRunState.done => 3,
      AgentRunState.idle => 4,
    };
  }

  /// Turns the folders into the flat run of rows the sliver builds from.
  ///
  /// Flat, not nested: a nested tree would build every conversation the moment
  /// the screen appears, and this list is the one place a PC with hundreds of
  /// them has to stay responsive.
  List<_SpaceRow> _flatten(
    List<WorkspaceGroup> groups, {
    required Set<String> collapsed,
  }) {
    final rows = <_SpaceRow>[];
    for (final group in groups) {
      // A conversation with no folder of its own has nothing to head; it
      // stands on its own rather than under an empty heading.
      final headed = group.key.isNotEmpty;
      final open = !collapsed.contains(group.key);
      if (headed) rows.add(_WorkspaceRow(group, expanded: open));
      if (headed && !open) continue;
      for (final thread in group.threads) {
        rows.add(_ThreadRow(thread, indented: headed));
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
      case _WorkspaceRow(:final group, :final expanded):
        return WorkspaceGroupRow(
          key: ValueKey('workspace-${group.key}'),
          group: group,
          expanded: expanded,
          onToggle: () =>
              ref.read(collapsedProjectsProvider.notifier).toggle(group.key),
          onDetails: () => showWorkspaceDetails(
            context,
            group,
            fullPath: group.path,
            onOpenThread: (id) => context.push(AppRoutes.conversation(id)),
          ),
          onNewConversation: () => _newConversation(cwd: group.path),
        );
      case _ThreadRow(:final thread, :final indented):
        return Padding(
          padding: EdgeInsets.only(
            left: indented ? kSpaceIndent : 0,
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

class _WorkspaceRow extends _SpaceRow {
  const _WorkspaceRow(this.group, {required this.expanded});
  final WorkspaceGroup group;
  final bool expanded;
}

class _ThreadRow extends _SpaceRow {
  const _ThreadRow(this.thread, {required this.indented});
  final Thread thread;
  final bool indented;
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
