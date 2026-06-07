import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/threads/new_conversation_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';

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

  @override
  void initState() {
    super.initState();
    // Pull this PC's threads on open so they get tagged with the device and the
    // list reflects the connected bridge.
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  Future<void> _refresh() async {
    final phase = ref.read(connectionPhaseProvider).value;
    if (phase != ConnectionPhase.connected) return;
    try {
      await ref
          .read(threadManagerProvider)
          .loadThreads(deviceId: widget.deviceId)
          .timeout(const Duration(seconds: 15));
    } on Object {
      // Best effort: surface nothing if the refresh fails or times out.
    }
  }

  Future<void> _newConversation() async {
    final threadId = await NewConversationSheet.show(context);
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
    // Scope to the selected PC. Legacy threads with no device tag are still
    // shown (they get tagged on the next connected refresh); demo data is gone.
    final threads = allThreads
        .where((t) => t.deviceId == null || t.deviceId == widget.deviceId)
        .toList();
    final devices = ref.watch(trustedDevicesProvider).value ?? const [];
    final phase = ref.watch(connectionPhaseProvider).value ??
        ConnectionPhase.disconnected;

    final agents = _agentsPresent(threads);
    final visible = _agentFilter == null
        ? threads
        : threads
            .where(
              (t) => AgentIdParsing.fromWireId(t.agentId) == _agentFilter,
            )
            .toList();

    final l10n = AppLocalizations.of(context);

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed:
            phase == ConnectionPhase.connected ? _newConversation : null,
        icon: const Icon(Icons.add_comment_outlined),
        label: Text(l10n.newThreadAction),
        backgroundColor: phase == ConnectionPhase.connected
            ? null
            : Theme.of(context).colorScheme.surfaceContainerHighest,
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(
            parent: AlwaysScrollableScrollPhysics(),
          ),
          slivers: [
            SliverAppBar.large(
              floating: true,
              snap: true,
              title: Text(_title(devices), overflow: TextOverflow.ellipsis),
              actions: [
                _ConnectionDot(phase: phase),
                const SizedBox(width: UxnanSpacing.lg),
              ],
              bottom: agents.length > 1
                  ? _AgentFilterBar(
                      agents: agents,
                      selected: _agentFilter,
                      onSelected: (agent) =>
                          setState(() => _agentFilter = agent),
                    )
                  : null,
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
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: UxnanSpacing.md),
                  itemBuilder: (context, index) =>
                      _ThreadTile(thread: visible[index]),
                ),
              ),
          ],
        ),
      ),
    );
  }

  List<AgentId> _agentsPresent(List<Thread> threads) {
    final seen = <AgentId>{};
    for (final thread in threads) {
      seen.add(AgentIdParsing.fromWireId(thread.agentId));
    }
    return seen.toList();
  }
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
                avatar: _AgentChipAvatar(agent: agent),
                label: Text(AgentVisuals.labelFor(agent)),
                selected: selected == agent,
                onSelected: (_) => onSelected(agent),
              ),
            ),
        ],
      ),
    );
  }
}

class _AgentChipAvatar extends StatelessWidget {
  const _AgentChipAvatar({required this.agent});
  final AgentId agent;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final logo = AgentVisuals.logoFor(agent);
    if (logo == null) {
      return Icon(
        Icons.smart_toy_outlined,
        size: 16,
        color: AgentVisuals.colorFor(agent),
      );
    }
    return SvgPicture.asset(
      logo,
      width: 16,
      height: 16,
      theme: SvgTheme(currentColor: colors.onSurface),
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({required this.thread});
  final Thread thread;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final agent = AgentIdParsing.fromWireId(thread.agentId);

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: () => context.push(AppRoutes.conversation(thread.id)),
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.md),
          child: Row(
            children: [
              _AgentAvatar(agent: agent),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            thread.title,
                            style: textTheme.titleSmall,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (thread.lastActivity != null) ...[
                          const SizedBox(width: UxnanSpacing.sm),
                          Text(
                            _relativeTime(thread.lastActivity!),
                            style: textTheme.bodySmall?.copyWith(
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: UxnanSpacing.xs),
                    Row(
                      children: [
                        _StatusDot(status: thread.status),
                        const SizedBox(width: UxnanSpacing.xs),
                        Flexible(
                          child: Text(
                            _subtitle(),
                            style: textTheme.bodySmall?.copyWith(
                              color: colors.onSurfaceVariant,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _subtitle() {
    final agent = AgentVisuals.labelFor(
      AgentIdParsing.fromWireId(thread.agentId),
    );
    final dir = thread.cwd?.split(RegExp(r'[\\/]')).last;
    return dir == null ? agent : '$agent · $dir';
  }
}

class _AgentAvatar extends StatelessWidget {
  const _AgentAvatar({required this.agent});
  final AgentId agent;

  @override
  Widget build(BuildContext context) {
    final logo = AgentVisuals.logoFor(agent);
    if (logo != null) return AgentLogoChip(asset: logo, size: 44);

    final colors = Theme.of(context).colorScheme;
    return Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Icon(
        Icons.smart_toy_outlined,
        size: 22,
        color: AgentVisuals.colorFor(agent),
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.status});
  final ThreadStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      ThreadStatus.active => UxnanColors.connected,
      ThreadStatus.syncing => UxnanColors.syncing,
      ThreadStatus.error => UxnanColors.error,
      ThreadStatus.archived => UxnanColors.onSurfaceMuted,
    };
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _ConnectionDot extends StatelessWidget {
  const _ConnectionDot({required this.phase});
  final ConnectionPhase phase;

  @override
  Widget build(BuildContext context) {
    final color = switch (phase) {
      ConnectionPhase.connected => UxnanColors.connected,
      ConnectionPhase.connecting ||
      ConnectionPhase.handshaking ||
      ConnectionPhase.syncing ||
      ConnectionPhase.reconnecting =>
        UxnanColors.connecting,
      ConnectionPhase.disconnected ||
      ConnectionPhase.error =>
        UxnanColors.disconnected,
    };
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
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

String _relativeTime(DateTime time) {
  final now = DateTime.now();
  final isSameDay =
      now.year == time.year && now.month == time.month && now.day == time.day;
  return isSameDay
      ? DateFormat.Hm().format(time)
      : DateFormat.MMMd().format(time);
}
