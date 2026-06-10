import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_actions_sheet.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';
import 'package:uxnan/presentation/screens/conversation/support/approval_mode_sheet.dart';
import 'package:uxnan/presentation/screens/conversation/support/model_picker_sheet.dart';
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

class _ConversationScreenState extends ConsumerState<ConversationScreen>
    with WidgetsBindingObserver {
  // FOR-DEV: there is no bridge RPC for the approval/access mode yet, so it is
  // a local per-thread setting (no sampled default — see SessionEnvironment).
  ApprovalMode _approvalMode = ApprovalMode.approveForMe;
  final ScrollController _scroll = ScrollController();
  String? _gitCwd;

  // Captured in initState: using `ref` inside dispose() is unreliable in
  // Riverpod (the clear could be dropped, leaving this thread marked as
  // "foreground" and wrongly suppressing its notifications back on the list).
  ForegroundThread? _foreground;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _foreground = ref.read(foregroundThreadProvider.notifier);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(threadManagerProvider).selectThread(widget.threadId);
      // Mark this conversation as the foreground one so its turn-end
      // notifications are suppressed while it's on screen.
      _foreground?.enter(widget.threadId);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Suppress this thread's notifications only while in the foreground; when
    // backgrounded the user is no longer watching, so let them through.
    if (state == AppLifecycleState.resumed) {
      _foreground?.enter(widget.threadId);
      ref.read(threadManagerProvider).markRead(widget.threadId);
    } else {
      _foreground?.leave(widget.threadId);
    }
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
    WidgetsBinding.instance.removeObserver(this);
    _foreground?.leave(widget.threadId);
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

  /// Opens the git actions sheet (branch state, changed files, commit/push) for
  /// the thread's workspace. Reached from both the branch chip and the
  /// commit/push action in the app bar.
  void _openGit(String? cwd) =>
      GitActionsSheet.show(context, cwd: cwd, threadId: widget.threadId);

  /// Opens the access/approval-mode picker (a small single-select bottom sheet).
  Future<void> _editApprovalMode() async {
    final mode = await ApprovalModeSheet.show(context, _approvalMode);
    if (mode != null && mounted) setState(() => _approvalMode = mode);
  }

  /// Copies the full thread id so the same conversation can be resumed from the
  /// CLI on the PC.
  Future<void> _copyThreadId() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    await Clipboard.setData(ClipboardData(text: widget.threadId));
    if (!mounted) return;
    messenger
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.threadIdCopied)));
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

  /// Builds the environment snapshot (model + context + git branch) from the
  /// active thread, the live git state and the reported token usage.
  SessionEnvironment _buildEnvironment(
    Thread? thread,
    String? gitBranch,
    ({int tokens, int? contextWindow})? usage,
  ) {
    final agent = AgentIdParsing.fromWireId(thread?.agentId ?? 'custom');
    final modelName = thread?.model?.isNotEmpty ?? false
        ? thread!.model!
        : AgentVisuals.labelFor(agent);
    final window = usage?.contextWindow;
    return SessionEnvironment(
      modelName: modelName,
      gitBranch: gitBranch,
      contextTokens: usage?.tokens,
      contextUsedFraction: (usage != null && window != null && window > 0)
          ? (usage.tokens / window).clamp(0.0, 1.0)
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final timelineAsync = ref.watch(activeTimelineProvider);
    final phase = ref.watch(connectionPhaseProvider).value ??
        ConnectionPhase.disconnected;
    final thread = ref.watch(threadByIdProvider(widget.threadId));
    // This thread lives on a specific PC; live actions (send, git) only work
    // when we actually hold that PC's channel — never a different connected PC.
    final connectedId = ref.watch(connectedDeviceProvider).value?.macDeviceId;
    final connectedHere = connectedId != null &&
        (thread?.deviceId == null || thread!.deviceId == connectedId);
    final effectivePhase = connectedHere ? phase : ConnectionPhase.disconnected;
    final gitBranch = ref.watch(gitRepoStateProvider).value?.branch;
    final resolvedModel = ref.watch(resolvedModelProvider(widget.threadId));
    final usage = ref.watch(contextUsageForProvider(widget.threadId));
    // Live activity of this thread's turn (running/error), so the header shows
    // "Responding…" while we wait for the agent — even before the first delta.
    final activity = ref.watch(threadActivityForProvider(widget.threadId));
    final environment = _buildEnvironment(thread, gitBranch, usage);
    final cwd = thread?.cwd;
    final snapshot = timelineAsync.value;

    // Resolve git state for the real workspace once the thread's cwd is known.
    if (connectedHere) _refreshGitFor(cwd);

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
                        if (activity == ThreadActivity.running)
                          const _RespondingLabel()
                        else
                          _ConnectionLabel(phase: effectivePhase),
                      ],
                    ),
                    actions: [
                      // One git affordance (was a redundant branch chip + an
                      // upload button): an IconButton — the M3-correct app-bar
                      // action — opens the git sheet; branch in its tooltip.
                      IconButton(
                        tooltip: gitBranch != null
                            ? '${l10n.environmentGit} · $gitBranch'
                            : l10n.environmentCommitOrPush,
                        icon: const Icon(Icons.commit_rounded),
                        onPressed: cwd != null ? () => _openGit(cwd) : null,
                      ),
                      _ConversationMenu(onCopyId: _copyThreadId),
                      const SizedBox(width: UxnanSpacing.xs),
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
          // Access/approval mode lives directly above the composer (its own
          // affordance, alert-coloured on full access), shown only for agents
          // that gate tools.
          if (thread != null &&
              ref.watch(agentCapabilitiesProvider(thread.agentId)).approvals)
            _ApprovalBar(mode: _approvalMode, onTap: _editApprovalMode),
          ComposerBar(
            environment: environment,
            resolvedModel: resolvedModel,
            enabled: connectedHere,
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

/// Header status shown while the agent is producing a turn: a small spinner and
/// "Responding…", in the primary colour. Replaces the connection label (being
/// connected is implied) so the user knows a reply is on the way.
class _RespondingLabel extends StatelessWidget {
  const _RespondingLabel();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 10,
          height: 10,
          child:
              CircularProgressIndicator(strokeWidth: 2, color: colors.primary),
        ),
        const SizedBox(width: UxnanSpacing.xs),
        Text(
          l10n.threadResponding,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: colors.primary),
        ),
      ],
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

/// App-bar overflow for low-frequency, thread-level actions (copy id).
class _ConversationMenu extends StatelessWidget {
  const _ConversationMenu({required this.onCopyId});

  final VoidCallback onCopyId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return PopupMenuButton<void>(
      icon: const Icon(Icons.more_vert_rounded),
      itemBuilder: (context) => [
        PopupMenuItem<void>(
          onTap: onCopyId,
          child: Row(
            children: [
              const Icon(Icons.content_copy_outlined, size: 18),
              const SizedBox(width: UxnanSpacing.sm),
              Text(l10n.threadActionCopyId),
            ],
          ),
        ),
      ],
    );
  }
}

/// Access/approval-mode control above the composer: an M3 [ActionChip] that
/// shows the current mode and turns **alert-coloured on full access**; tapping
/// opens the mode picker.
class _ApprovalBar extends StatelessWidget {
  const _ApprovalBar({required this.mode, required this.onTap});

  final ApprovalMode mode;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final isFull = mode == ApprovalMode.fullAccess;
    final (label, icon) = switch (mode) {
      ApprovalMode.requestApproval => (
          l10n.approvalRequestTitle,
          Icons.shield_outlined,
        ),
      ApprovalMode.approveForMe => (
          l10n.approvalAutoTitle,
          Icons.verified_user_outlined,
        ),
      ApprovalMode.fullAccess => (
          l10n.approvalFullTitle,
          Icons.lock_open_rounded,
        ),
    };

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        0,
      ),
      child: Align(
        alignment: Alignment.centerLeft,
        child: ActionChip(
          avatar: Icon(
            icon,
            size: 18,
            color: isFull ? colors.onErrorContainer : colors.onSurfaceVariant,
          ),
          label: Text(label),
          labelStyle: isFull ? TextStyle(color: colors.onErrorContainer) : null,
          backgroundColor: isFull ? colors.errorContainer : null,
          side: isFull ? BorderSide(color: colors.error) : null,
          visualDensity: VisualDensity.compact,
          onPressed: onTap,
        ),
      ),
    );
  }
}
