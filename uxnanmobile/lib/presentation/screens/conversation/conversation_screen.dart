import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';
import 'package:uxnan/presentation/screens/conversation/support/model_picker_sheet.dart';
import 'package:uxnan/presentation/screens/conversation/support/session_status_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';

/// The active conversation: a thread title with connection status, the
/// streaming timeline, and the composer (spec 02a §5.6.1).
class ConversationScreen extends ConsumerStatefulWidget {
  /// Creates a [ConversationScreen] for [threadId].
  const ConversationScreen({required this.threadId, super.key});

  /// The thread to display.
  final String threadId;

  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  // FOR-DEV: there is no bridge RPC for the approval/access mode yet, so it is
  // a local per-thread setting (no sampled default — see SessionEnvironment).
  ApprovalMode _approvalMode = ApprovalMode.approveForMe;
  final ScrollController _scroll = ScrollController();
  String? _gitCwd;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(threadManagerProvider).selectThread(widget.threadId);
    });
  }

  /// Fetches `git/status` for the thread's [cwd] once it is known/changes.
  void _refreshGitFor(String? cwd) {
    if (cwd == null || cwd.isEmpty || cwd == _gitCwd) return;
    _gitCwd = cwd;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(gitActionManagerProvider).refreshStatus(cwd);
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  bool _isNearBottom() {
    if (!_scroll.hasClients) return true;
    return _scroll.position.maxScrollExtent - _scroll.offset < 200;
  }

  void _scrollToBottom() {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  void _openEnvironment(
    SessionEnvironment environment,
    String? cwd,
    Thread? thread,
  ) {
    // Only agents that advertise the `approvals` capability get the approval
    // mode row; permissive when the agent/capabilities aren't known yet.
    final showApprovalMode = thread == null ||
        ref.read(agentCapabilitiesProvider(thread.agentId)).approvals;
    SessionStatusSheet.show(
      context,
      environment,
      threadId: widget.threadId,
      cwd: cwd,
      showApprovalMode: showApprovalMode,
      onApprovalModeChanged: (mode) => setState(() => _approvalMode = mode),
      onModelTap: thread != null ? () => _pickModel(thread) : null,
    );
  }

  /// Opens the model picker and applies the choice to the thread's agent.
  Future<void> _pickModel(Thread thread) async {
    final selected = await ModelPickerSheet.show(
      context,
      agentId: thread.agentId,
      current: thread.model,
    );
    if (selected == null || selected == thread.model || !mounted) return;
    await ref
        .read(threadManagerProvider)
        .setThreadModel(widget.threadId, selected);
  }

  /// Builds the environment snapshot from the active thread, the live git
  /// state and the local approval-mode setting.
  SessionEnvironment _buildEnvironment(Thread? thread, String? gitBranch) {
    final agent = AgentIdParsing.fromWireId(thread?.agentId ?? 'custom');
    final modelName = thread?.model?.isNotEmpty ?? false
        ? thread!.model!
        : AgentVisuals.labelFor(agent);
    return SessionEnvironment(
      modelName: modelName,
      approvalMode: _approvalMode,
      gitBranch: gitBranch,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final timelineAsync = ref.watch(activeTimelineProvider);
    final phase = ref.watch(connectionPhaseProvider).value ??
        ConnectionPhase.disconnected;
    final thread = ref.watch(threadByIdProvider(widget.threadId));
    final gitBranch = ref.watch(gitRepoStateProvider).value?.branch;
    final environment = _buildEnvironment(thread, gitBranch);
    final cwd = thread?.cwd;
    final snapshot = timelineAsync.value;

    // Resolve git state for the real workspace once the thread's cwd is known.
    if (phase == ConnectionPhase.connected) _refreshGitFor(cwd);

    // Auto-scroll to the bottom on new content while the user is near it.
    ref.listen(activeTimelineProvider, (previous, next) {
      if (next.value != null && _isNearBottom()) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
      }
    });

    return Scaffold(
      body: Column(
        children: [
          Expanded(
            // Tapping the message area dismisses the keyboard (unfocus the
            // composer); dragging still scrolls.
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: () => FocusScope.of(context).unfocus(),
              child: CustomScrollView(
                controller: _scroll,
                physics: const BouncingScrollPhysics(
                  parent: AlwaysScrollableScrollPhysics(),
                ),
                slivers: [
                  SliverAppBar.large(
                    floating: true,
                    snap: true,
                    title: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          thread?.title ?? l10n.conversationTitle,
                          overflow: TextOverflow.ellipsis,
                        ),
                        _ConnectionLabel(phase: phase),
                      ],
                    ),
                    actions: [
                      _EnvironmentChip(
                        branch: environment.gitBranch,
                        onTap: () => _openEnvironment(environment, cwd, thread),
                      ),
                      const SizedBox(width: UxnanSpacing.md),
                    ],
                  ),
                  if (snapshot == null)
                    const SliverFillRemaining(
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (snapshot.messages.isEmpty)
                    const SliverFillRemaining(
                      hasScrollBody: false,
                      child: _EmptyState(),
                    )
                  else
                    SliverPadding(
                      padding: const EdgeInsets.all(UxnanSpacing.lg),
                      sliver: SliverList.builder(
                        itemCount: snapshot.messages.length,
                        itemBuilder: (context, index) =>
                            MessageBubble(message: snapshot.messages[index]),
                      ),
                    ),
                ],
              ),
            ),
          ),
          ComposerBar(
            environment: environment,
            enabled: phase == ConnectionPhase.connected,
            showAttach: thread != null &&
                ref.watch(agentCapabilitiesProvider(thread.agentId)).images,
            onModelTap: thread != null ? () => _pickModel(thread) : null,
            onSend: (text) => ref
                .read(threadManagerProvider)
                .sendUserMessage(widget.threadId, text),
          ),
        ],
      ),
    );
  }
}

/// Empty conversation placeholder.
class _EmptyState extends StatelessWidget {
  const _EmptyState();

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
              semanticLabel: 'Conversation',
            ),
            const SizedBox(height: UxnanSpacing.md),
            Text(l10n.conversationEmpty, style: textTheme.titleSmall),
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              l10n.conversationEmptyBody,
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

class _ConnectionLabel extends StatelessWidget {
  const _ConnectionLabel({required this.phase});

  final ConnectionPhase phase;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;

    final (label, color) = switch (phase) {
      ConnectionPhase.connected => (
          l10n.connectionConnected,
          UxnanColors.connected,
        ),
      ConnectionPhase.connecting ||
      ConnectionPhase.handshaking ||
      ConnectionPhase.syncing =>
        (l10n.connectionConnecting, UxnanColors.connecting),
      ConnectionPhase.reconnecting => (
          l10n.connectionReconnecting,
          UxnanColors.connecting,
        ),
      ConnectionPhase.disconnected || ConnectionPhase.error => (
          l10n.connectionDisconnected,
          UxnanColors.disconnected
        ),
    };

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: UxnanSpacing.xs),
        Text(label, style: textTheme.bodySmall),
      ],
    );
  }
}

/// AppBar chip showing the git branch; opens the environment sheet.
class _EnvironmentChip extends StatelessWidget {
  const _EnvironmentChip({required this.branch, required this.onTap});

  final String? branch;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Material(
      color: colors.surfaceContainerHighest,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.md,
            vertical: UxnanSpacing.sm,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.account_tree_outlined,
                size: 14,
                color: colors.onSurfaceVariant,
              ),
              if (branch != null) ...[
                const SizedBox(width: UxnanSpacing.xs),
                Text(branch!, style: textTheme.bodySmall),
              ],
              const SizedBox(width: UxnanSpacing.xs),
              Icon(
                Icons.tune_rounded,
                size: 15,
                color: colors.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
