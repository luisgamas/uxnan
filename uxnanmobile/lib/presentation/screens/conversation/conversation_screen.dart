import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/turn_timeline_snapshot.dart';
import 'package:uxnan/infrastructure/media/attachment_picker_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';
import 'package:uxnan/presentation/screens/conversation/composer/turn_tools_sheet.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_browser_screen.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_screen.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';
import 'package:uxnan/presentation/screens/conversation/support/model_picker_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// The active conversation: a Neural Expressive layout — a transparent top bar
/// (back · model-picker pill · context · git · status · menu) over the
/// streaming timeline, with a floating composer pill and a unified "+" turn-
/// tools sheet (spec 02a §5.6.1).
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
  // Vanished-cwd detection: the thread's folder/worktree can be removed outside
  // the app. We probe `workspace/exists` once per cwd; a confirmed-gone cwd
  // disables the composer (sending into a dead cwd errors on every action).
  String? _checkedCwd;
  bool _cwdMissing = false;
  // Set when the user sends a message and the "scroll to latest on send"
  // setting is on: forces the next timeline update to jump to the bottom if the
  // user had scrolled up. Cleared once that scroll happens.
  bool _forceScrollOnSend = false;

  /// Images the user attached for the next turn (shown as removable thumbnails
  /// above the composer); cleared on send.
  final List<ImageContent> _attachments = [];

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
      // Opening a conversation resumes it on the bridge (reactivates its agent
      // session); best-effort and skips archived threads.
      unawaited(ref.read(threadManagerProvider).resumeThread(widget.threadId));
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

  /// Probes whether [cwd] still exists (once per cwd) and disables the composer
  /// if it vanished. Fail-open in the manager, so a transient error never
  /// disables; only a confirmed-gone cwd does.
  void _checkCwd(String? cwd) {
    if (cwd == null || cwd.isEmpty || cwd == _checkedCwd) return;
    _checkedCwd = cwd;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final exists = await ref.read(threadManagerProvider).workspaceExists(cwd);
      if (mounted && _checkedCwd == cwd) setState(() => _cwdMissing = !exists);
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    // Clear the foreground marker on the next event-loop tick, NOT inline:
    // mutating a provider synchronously during unmount throws "Tried to modify
    // a provider while the widget tree was building". Deferring runs it after
    // the tree settles; leave() is a no-op if another thread is now in front.
    final foreground = _foreground;
    final threadId = widget.threadId;
    Future(() => foreground?.leave(threadId));
    _scroll.dispose();
    super.dispose();
  }

  bool _isNearBottom() {
    if (!_scroll.hasClients) return true;
    return _scroll.position.maxScrollExtent - _scroll.offset < 200;
  }

  void _scrollToBottom() {
    if (!_scroll.hasClients) return;
    // Jump (don't animate) to the bottom: an animation captures a target at one
    // moment, but streaming tokens / variable-height messages / images keep
    // growing the content, so the animation lands short and the next emission
    // restarts it — the "stuck just above the bottom, bounces when I drag down"
    // bug. Jumping to the live maxScrollExtent sticks to the true bottom.
    _scroll.jumpTo(_scroll.position.maxScrollExtent);
    // Content can finish laying out AFTER this frame (late image/height
    // measurement), growing the extent; re-jump next frame so we reach the real
    // bottom instead of stopping a little short.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      final max = _scroll.position.maxScrollExtent;
      if (max - _scroll.offset > 1) _scroll.jumpTo(max);
    });
  }

  /// Opens the git actions screen (branch state, changed files, commit/push)
  /// for the thread's workspace.
  Future<void> _openGit(String? cwd) async {
    await GitScreen.push(context, cwd: cwd, threadId: widget.threadId);
    // The worktree may have been removed from the git screen → re-probe so the
    // composer disables right away if this thread's cwd just vanished.
    if (mounted && cwd != null) {
      _checkedCwd = null;
      _checkCwd(cwd);
    }
  }

  /// Opens the workspace file browser for the thread's `cwd`. Surfaces the
  /// full file tree (with git-status color treatment) alongside the focused
  /// git diff + commit surface in `GitScreen` — together they cover both the
  /// "what changed" and the "show me the file" questions.
  Future<void> _openFileBrowser(String? cwd) async {
    if (cwd == null) return;
    await FileBrowserScreen.push(
      context,
      cwd: cwd,
      threadId: widget.threadId,
    );
  }

  /// Opens the unified turn-tools sheet (attach + run-option knobs + approval).
  void _openTurnTools(
    List<AgentModelOption> runOptions, {
    required bool showAttach,
    required bool showApproval,
  }) {
    TurnToolsSheet.show(
      context,
      threadId: widget.threadId,
      showAttach: showAttach,
      runOptions: runOptions,
      showApproval: showApproval,
      approvalMode: _approvalMode,
      onApprovalChanged: (mode) => setState(() => _approvalMode = mode),
      onAttach: _pickAttachment,
    );
  }

  /// Picks an image from [source] and appends it to the pending attachments.
  Future<void> _pickAttachment(AttachmentSource source) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    final image =
        await ref.read(attachmentPickerServiceProvider).pickImage(source);
    if (!mounted || image == null) return;
    if (image.base64Data == null) {
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.composerAttachFailed)));
      return;
    }
    setState(() => _attachments.add(image));
  }

  void _removeAttachment(int index) {
    if (index < 0 || index >= _attachments.length) return;
    setState(() => _attachments.removeAt(index));
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

  /// Prompts for a new title and renames the active thread — the same flow as
  /// the thread list's long-press, surfaced here in the app-bar menu.
  Future<void> _renameThread() async {
    final l10n = AppLocalizations.of(context);
    final current = ref.read(threadByIdProvider(widget.threadId))?.title ?? '';
    final controller = TextEditingController(text: current);
    final newTitle = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.threadRenameTitle),
        content: TextField(
          controller: controller,
          autofocus: true,
          textInputAction: TextInputAction.done,
          decoration: InputDecoration(labelText: l10n.threadRenameHint),
          onSubmitted: (value) => Navigator.pop(dialogContext, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text),
            child: Text(l10n.actionSave),
          ),
        ],
      ),
    );
    final trimmed = newTitle?.trim() ?? '';
    if (trimmed.isEmpty || trimmed == current || !mounted) return;
    await ref
        .read(threadManagerProvider)
        .renameThread(widget.threadId, trimmed);
  }

  /// Forks the conversation (`thread/fork`): the bridge deep-copies the thread
  /// and its turns into a new one, which is opened. Surfaces a snackbar if the
  /// bridge can't fork.
  Future<void> _forkThread() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = GoRouter.of(context);
    final forked =
        await ref.read(threadManagerProvider).forkThread(widget.threadId);
    if (!mounted) return;
    if (forked == null) {
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.threadForkFailed)));
      return;
    }
    unawaited(navigator.push(AppRoutes.conversation(forked.id)));
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

  /// Horizontal inset that centers the conversation content within
  /// [UxnanSpacing.maxContentWidth] on wide screens (tablets), falling back to
  /// the normal gutter on phones.
  double _horizontalInset(double width) {
    final inset = (width - UxnanSpacing.maxContentWidth) / 2;
    return inset > UxnanSpacing.lg ? inset : UxnanSpacing.lg;
  }

  /// Builds the environment snapshot (model + context + git branch) from the
  /// active thread, the live git state and the reported token usage.
  SessionEnvironment _buildEnvironment(
    Thread? thread,
    String? gitBranch,
    ({int tokens, int? contextWindow})? usage, {
    required bool showContext,
  }) {
    final agent = AgentIdParsing.fromWireId(thread?.agentId ?? 'custom');
    final modelName = thread?.model?.isNotEmpty ?? false
        ? thread!.model!
        : AgentVisuals.labelFor(agent);
    final window = usage?.contextWindow;
    return SessionEnvironment(
      modelName: modelName,
      gitBranch: gitBranch,
      showContext: showContext,
      contextTokens: usage?.tokens,
      contextUsedFraction: (usage != null && window != null && window > 0)
          ? (usage.tokens / window).clamp(0.0, 1.0)
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final timelineAsync = ref.watch(activeTimelineProvider);
    final thread = ref.watch(threadByIdProvider(widget.threadId));
    // This thread lives on a specific PC; live actions (send, git) only work
    // when we actually hold that PC's channel — never a different connected PC.
    final connectedId = ref.watch(connectedDeviceProvider).value?.macDeviceId;
    final connectedHere = connectedId != null &&
        (thread?.deviceId == null || thread!.deviceId == connectedId);
    final caps = thread != null
        ? ref.watch(agentCapabilitiesProvider(thread.agentId))
        : null;
    // The active agent's sign-in status on the PC (only meaningful while we
    // hold this thread's channel). `.value` is null while offline or on an
    // older bridge, so a missing status simply shows no banner.
    final authStatus = connectedHere && thread != null
        ? ref.watch(authStatusProvider(thread.agentId)).value
        : null;
    final requiresLogin = authStatus?.requiresLogin ?? false;
    // Data-driven run-option knobs the bridge advertises for this thread's
    // model (e.g. reasoning effort); empty when none or offline.
    final runOptions = ref.watch(activeModelOptionsProvider(widget.threadId));
    final gitBranch = ref.watch(gitRepoStateProvider).value?.branch;
    final resolvedModel = ref.watch(resolvedModelProvider(widget.threadId));
    final usage = ref.watch(contextUsageForProvider(widget.threadId));
    // Live activity of this thread's turn (running/error), so the bar shows the
    // wavy "responding" line while we wait for the agent.
    final activity = ref.watch(threadActivityForProvider(widget.threadId));
    final environment = _buildEnvironment(
      thread,
      gitBranch,
      usage,
      showContext: caps?.reportsContextUsage ?? false,
    );
    final cwd = thread?.cwd;
    final snapshot = timelineAsync.value;
    // Aggregated edits of the most recent assistant turn that changed files,
    // for the green/red strip just above the composer.
    final lastEdits = _lastTurnEdits(snapshot);
    final contentInset = _horizontalInset(MediaQuery.sizeOf(context).width);
    final running = connectedHere && activity == ThreadActivity.running;

    // The unified "+" turn-tools sheet holds: attach (images-capable agents),
    // the data-driven run-option knobs, and the approval mode (tool-gating
    // agents). The "+" is shown only when there's at least one of them.
    final showAttach = caps?.images ?? false;
    final showRunOptions = connectedHere && runOptions.isNotEmpty;
    final showApproval = caps?.approvals ?? false;
    final hasTurnTools = showAttach || showRunOptions || showApproval;

    // Resolve git state for the real workspace once the thread's cwd is known,
    // and probe whether that cwd still exists (folders/worktrees can vanish).
    if (connectedHere) {
      _refreshGitFor(cwd);
      _checkCwd(cwd);
    }

    // Auto-scroll to the bottom on new content while the user is near it; a
    // just-sent message (with the setting on) forces the jump even from a
    // manually-scrolled position.
    ref.listen(activeTimelineProvider, (previous, next) {
      if (next.value != null && (_forceScrollOnSend || _isNearBottom())) {
        _forceScrollOnSend = false;
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
      }
    });

    final topInset = NeTopBar.preferredHeight(context);

    return Scaffold(
      body: Stack(
        children: [
          Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    // Tapping the message area dismisses the keyboard (unfocus
                    // the composer); dragging still scrolls.
                    GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: () => FocusScope.of(context).unfocus(),
                      child: CustomScrollView(
                        controller: _scroll,
                        physics: const BouncingScrollPhysics(
                          parent: AlwaysScrollableScrollPhysics(),
                        ),
                        slivers: [
                          // Spacer so the first content sits below the
                          // transparent top bar (it overlays the scroll).
                          SliverToBoxAdapter(child: SizedBox(height: topInset)),
                          // "Load earlier" header when the rendered window does
                          // not yet cover the whole local history.
                          if (snapshot != null &&
                              snapshot.messages.isNotEmpty &&
                              snapshot.hasMore)
                            SliverToBoxAdapter(
                              child: Center(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    vertical: UxnanSpacing.sm,
                                  ),
                                  child: TextButton.icon(
                                    onPressed: () => ref
                                        .read(threadManagerProvider)
                                        .loadMoreHistory(),
                                    icon: const Icon(
                                      Icons.history_rounded,
                                      size: 18,
                                    ),
                                    label: Text(l10n.conversationLoadEarlier),
                                  ),
                                ),
                              ),
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
                              padding: EdgeInsets.fromLTRB(
                                contentInset,
                                UxnanSpacing.sm,
                                contentInset,
                                UxnanSpacing.lg,
                              ),
                              sliver: SliverList.builder(
                                itemCount: snapshot.messages.length,
                                itemBuilder: (context, index) => MessageBubble(
                                  message: snapshot.messages[index],
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    // Bottom scroll veil mirroring the top bar's: the last
                    // messages fade into the surface just above the composer.
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: IgnorePointer(
                        child: Container(
                          height: UxnanSpacing.xl,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                colors.surface.withValues(alpha: 0),
                                colors.surface,
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              // Sign-in warning: the agent isn't logged in on this PC, so
              // turns won't run until the user signs into its CLI there. Kept
              // above the composer (not in the scrolling list) so it stays
              // visible.
              if (_cwdMissing) const _Centered(child: _CwdMissingBanner()),
              if (requiresLogin && thread != null)
                _Centered(child: _LoginRequiredBanner(agentId: thread.agentId)),
              if (lastEdits != null || environment.showContext)
                _Centered(
                  child: _ComposerInfoBar(
                    edits: lastEdits,
                    showContext: environment.showContext,
                    hasContext: environment.hasContext,
                    percent: environment.contextPercent,
                    tokenLabel: environment.contextTokensLabel,
                  ),
                ),
              if (_attachments.isNotEmpty)
                _Centered(
                  child: _AttachmentStrip(
                    attachments: _attachments,
                    onRemove: _removeAttachment,
                  ),
                ),
              ComposerBar(
                enabled: connectedHere && !_cwdMissing,
                hasAttachments: _attachments.isNotEmpty,
                // While the agent is producing a turn, Send becomes Stop —
                // cancels the turn (without closing the thread).
                running: running,
                onStop: () =>
                    ref.read(threadManagerProvider).cancelTurn(widget.threadId),
                onPlus: hasTurnTools
                    ? () => _openTurnTools(
                          runOptions,
                          showAttach: showAttach,
                          showApproval: showApproval,
                        )
                    : null,
                onSend: (text) {
                  // Honor the scroll-to-latest-on-send setting: arm a forced
                  // scroll so the user sees their message even if scrolled up.
                  if (ref.read(scrollToBottomOnSendProvider)) {
                    _forceScrollOnSend = true;
                  }
                  final options =
                      ref.read(threadRunOptionsProvider(widget.threadId));
                  final attachments = List<ImageContent>.of(_attachments);
                  ref.read(threadManagerProvider).sendUserMessage(
                        widget.threadId,
                        text,
                        options: options,
                        attachments: attachments,
                      );
                  if (_attachments.isNotEmpty) {
                    setState(_attachments.clear);
                  }
                },
              ),
            ],
          ),
          // Transparent NE top bar overlaid above the scrolling content.
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: NeTopBar(
              leading: IconSurface(
                icon: Icons.arrow_back_rounded,
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => Navigator.of(context).maybePop(),
              ),
              title: _ModelPill(
                model: environment.modelName,
                resolvedModel: resolvedModel,
                onTap: thread != null ? () => _pickModel(thread) : null,
              ),
              actions: [
                IconSurface(
                  icon: Icons.folder_open_rounded,
                  tooltip: l10n.fileBrowserOpenTooltip,
                  onPressed: connectedHere ? () => _openFileBrowser(cwd) : null,
                ),
                IconSurface(
                  icon: Icons.commit_rounded,
                  tooltip: gitBranch != null
                      ? '${l10n.environmentGit} · $gitBranch'
                      : l10n.environmentCommitOrPush,
                  onPressed: cwd != null ? () => _openGit(cwd) : null,
                ),
                _ConversationMenu(
                  onCopyId: _copyThreadId,
                  onRename: _renameThread,
                  onFork: _forkThread,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Model-picker pill in the top bar (Neural Expressive §4.2): a stadium-shaped
/// `surfaceContainerHigh` chip with the active model name + chevron; tapping
/// opens the model picker. The tooltip surfaces the resolved version.
class _ModelPill extends StatelessWidget {
  const _ModelPill({required this.model, this.resolvedModel, this.onTap});

  final String model;
  final String? resolvedModel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: Tooltip(
        message: resolvedModel ?? model,
        child: Material(
          color: colors.surfaceContainerHigh,
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
                    Icons.auto_awesome_outlined,
                    size: 16,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  Flexible(
                    child: Text(
                      model,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.titleSmall,
                    ),
                  ),
                  Icon(
                    Icons.arrow_drop_down_rounded,
                    size: 18,
                    color: colors.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Context-usage ring shown in the top bar for usage-reporting agents: a
/// percent ring when the model window is known (Claude), shown at 0 until the
/// first turn reports.
class _ContextBadge extends StatelessWidget {
  const _ContextBadge({required this.percent});
  final int percent;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final color = percent >= 90
        ? UxnanColors.error
        : percent >= 70
            ? UxnanColors.warning
            : UxnanColors.success;
    return Tooltip(
      message: 'Context $percent%',
      child: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: colors.surfaceContainerHigh,
          shape: BoxShape.circle,
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                value: percent / 100,
                strokeWidth: 2.5,
                backgroundColor: color.withValues(alpha: 0.2),
                valueColor: AlwaysStoppedAnimation<Color>(color),
              ),
            ),
            Text('$percent', style: UxnanTypography.codeSmall),
          ],
        ),
      ),
    );
  }
}

/// Raw token-count chip, shown in the top bar when the context window is
/// unknown (Codex) so usage is still visible without a percentage.
class _TokenChip extends StatelessWidget {
  const _TokenChip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Tooltip(
      message: 'Context: $label tokens',
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.sm,
          vertical: 4,
        ),
        decoration: BoxDecoration(
          color: colors.surfaceContainerHigh,
          borderRadius: const BorderRadius.all(UxnanRadius.full),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.donut_large_outlined,
              size: 13,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(width: UxnanSpacing.xs),
            Text(
              label,
              style: UxnanTypography.codeSmall.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Centers its [child] within [UxnanSpacing.maxContentWidth] so the above-
/// composer chrome (banner, diff strip) lines up with the centered message
/// column on wide screens.
class _Centered extends StatelessWidget {
  const _Centered({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          maxWidth: UxnanSpacing.maxContentWidth,
        ),
        child: child,
      ),
    );
  }
}

/// A horizontal strip of pending attachment thumbnails shown just above the
/// composer; each has a remove (✕) overlay. Sits on the same gutter as the
/// composer pill.
class _AttachmentStrip extends StatelessWidget {
  const _AttachmentStrip({required this.attachments, required this.onRemove});

  final List<ImageContent> attachments;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        0,
      ),
      child: SizedBox(
        height: 72,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: attachments.length,
          separatorBuilder: (_, __) => const SizedBox(width: UxnanSpacing.sm),
          itemBuilder: (context, index) {
            final data = attachments[index].base64Data;
            return Stack(
              children: [
                ClipRRect(
                  borderRadius: const BorderRadius.all(UxnanRadius.md),
                  child: Container(
                    width: 72,
                    height: 72,
                    color: colors.surfaceContainerHighest,
                    child: data == null
                        ? Icon(
                            Icons.image_outlined,
                            color: colors.onSurfaceVariant,
                          )
                        : Image.memory(
                            base64Decode(data),
                            width: 72,
                            height: 72,
                            fit: BoxFit.cover,
                            gaplessPlayback: true,
                          ),
                  ),
                ),
                Positioned(
                  top: 2,
                  right: 2,
                  child: GestureDetector(
                    onTap: () => onRemove(index),
                    child: Container(
                      decoration: BoxDecoration(
                        color: colors.scrim.withValues(alpha: 0.6),
                        shape: BoxShape.circle,
                      ),
                      padding: const EdgeInsets.all(2),
                      child: const Icon(
                        Icons.close_rounded,
                        size: 16,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The +additions / −deletions and file count of an assistant turn's edits.
typedef _TurnEdits = ({int additions, int deletions, int files});

/// Returns the aggregated diff totals of the most recent assistant turn that
/// changed files, or null when the latest turns touched none.
_TurnEdits? _lastTurnEdits(TurnTimelineSnapshot? snapshot) {
  if (snapshot == null) return null;
  for (final message in snapshot.messages.reversed) {
    if (message.role != MessageRole.assistant) continue;
    final diffs = message.contents.whereType<DiffContent>().toList();
    if (diffs.isEmpty) continue;
    var additions = 0;
    var deletions = 0;
    for (final diff in diffs) {
      additions += diff.additions;
      deletions += diff.deletions;
    }
    return (additions: additions, deletions: deletions, files: diffs.length);
  }
  return null;
}

/// A compact, right-aligned info row just above the composer: the latest turn's
/// numeric diff (`+a −d`) on the left and the context-usage indicator on the
/// right, both on the same neutral surface as the top-bar Icon Surfaces. Purely
/// informative — the Git screen carries the detail.
class _ComposerInfoBar extends StatelessWidget {
  const _ComposerInfoBar({
    required this.showContext,
    required this.hasContext,
    required this.percent,
    this.edits,
    this.tokenLabel,
  });

  final _TurnEdits? edits;
  final bool showContext;
  final bool hasContext;
  final int percent;
  final String? tokenLabel;

  @override
  Widget build(BuildContext context) {
    final edits = this.edits;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        0,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          if (edits != null)
            _DiffNumericPill(
              additions: edits.additions,
              deletions: edits.deletions,
            ),
          if (edits != null && showContext)
            const SizedBox(width: UxnanSpacing.xs),
          if (showContext)
            hasContext
                ? _ContextBadge(percent: percent)
                : _TokenChip(label: tokenLabel ?? '0'),
        ],
      ),
    );
  }
}

/// A numeric-only `+a −d` pill (no label/icon) on the neutral Icon-Surface tone.
class _DiffNumericPill extends StatelessWidget {
  const _DiffNumericPill({required this.additions, required this.deletions});
  final int additions;
  final int deletions;

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
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '+$additions',
            style:
                UxnanTypography.codeSmall.copyWith(color: UxnanColors.gitAdded),
          ),
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            '−$deletions',
            style: UxnanTypography.codeSmall.copyWith(
              color: UxnanColors.gitDeleted,
            ),
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

/// App-bar overflow for low-frequency, thread-level actions (rename, copy id).
/// Styled as an Icon Surface (circular neutral surface) to match the git action
/// beside it; the connection state lives on the earlier screens, not here.
class _ConversationMenu extends StatelessWidget {
  const _ConversationMenu({
    required this.onCopyId,
    required this.onRename,
    required this.onFork,
  });

  final VoidCallback onCopyId;
  final VoidCallback onRename;
  final VoidCallback onFork;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return IconSurfaceMenu<void>(
      tooltip: l10n.threadsMore,
      icon: Icons.more_vert_rounded,
      constraints: const BoxConstraints(minWidth: 220),
      itemBuilder: (context) => [
        PopupMenuItem<void>(
          onTap: onRename,
          child: Row(
            children: [
              const Icon(Icons.edit_outlined, size: 18),
              const SizedBox(width: UxnanSpacing.sm),
              Text(l10n.threadActionRename),
            ],
          ),
        ),
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
        PopupMenuItem<void>(
          onTap: onFork,
          child: Row(
            children: [
              const Icon(Icons.call_split_rounded, size: 18),
              const SizedBox(width: UxnanSpacing.sm),
              Text(l10n.threadActionFork),
            ],
          ),
        ),
      ],
    );
  }
}

/// A full-width warning above the composer when the active thread's agent is
/// not signed in on the PC. Signing in happens on the PC (the bridge's
/// `auth/login` is a stub), so this surfaces the state and offers a **Check
/// sign-in** action that re-queries `auth/status` — mirroring the
/// new-conversation card — alongside the on-resume auto-refresh.
/// Shown above the composer when the thread's working folder/worktree no longer
/// exists on the PC (removed outside the app, or via "Remove worktree"). The
/// composer is disabled — sending into a dead cwd would error on every action.
class _CwdMissingBanner extends StatelessWidget {
  const _CwdMissingBanner();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        0,
      ),
      child: Material(
        color: colors.errorContainer,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.sm),
          child: Row(
            children: [
              Icon(
                Icons.folder_off_outlined,
                size: 20,
                color: colors.onErrorContainer,
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Text(
                  l10n.conversationCwdMissing,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onErrorContainer,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LoginRequiredBanner extends ConsumerWidget {
  const _LoginRequiredBanner({required this.agentId});

  /// Wire id of the active thread's agent (the one to re-check).
  final String agentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);

    final auth = ref.watch(authStatusProvider(agentId));
    final loginInProgress = auth.value?.loginInProgress ?? false;
    // Riverpod retains the previous value across an invalidate, so a re-check
    // shows a spinner while the banner stays visible.
    final checking = auth.isLoading;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        0,
      ),
      child: Material(
        color: colors.errorContainer,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.md,
            UxnanSpacing.sm,
            UxnanSpacing.sm,
            UxnanSpacing.sm,
          ),
          child: Row(
            children: [
              if (loginInProgress)
                SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: colors.onErrorContainer,
                  ),
                )
              else
                Icon(
                  Icons.login_rounded,
                  size: 20,
                  color: colors.onErrorContainer,
                ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      loginInProgress
                          ? l10n.authLoginInProgress
                          : l10n.authRequiresLoginTitle,
                      style: textTheme.bodyMedium?.copyWith(
                        color: colors.onErrorContainer,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (!loginInProgress) ...[
                      const SizedBox(height: 2),
                      Text(
                        l10n.authRequiresLoginBody,
                        style: textTheme.bodySmall?.copyWith(
                          color: colors.onErrorContainer,
                        ),
                      ),
                      const SizedBox(height: UxnanSpacing.xs),
                      TextButton(
                        onPressed: checking
                            ? null
                            : () => ref.invalidate(authStatusProvider(agentId)),
                        style: TextButton.styleFrom(
                          foregroundColor: colors.onErrorContainer,
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.fromLTRB(
                            UxnanSpacing.sm,
                            UxnanSpacing.xs,
                            UxnanSpacing.sm,
                            UxnanSpacing.xs,
                          ),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: checking
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: colors.onErrorContainer,
                                ),
                              )
                            : Text(l10n.agentCheckSignIn),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
