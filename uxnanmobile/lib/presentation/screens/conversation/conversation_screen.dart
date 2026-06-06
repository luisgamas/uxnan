import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';
import 'package:uxnan/presentation/screens/conversation/support/session_status_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

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
  // FOR-DEV: sampled until wired to bridge status + git state.
  SessionEnvironment _environment = SessionEnvironment.sample();
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(threadManagerProvider).selectThread(widget.threadId);
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

  void _openEnvironment() {
    SessionStatusSheet.show(
      context,
      _environment,
      threadId: widget.threadId,
      // FOR-DEV: sample git state so the source-control panel is reviewable
      // without a connected bridge; replace with a resolved cwd when wired.
      previewGitState: GitRepoState.sample(),
      onApprovalModeChanged: (mode) =>
          setState(() => _environment = _environment.withApprovalMode(mode)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final timelineAsync = ref.watch(activeTimelineProvider);
    final phase = ref.watch(connectionPhaseProvider).value ??
        ConnectionPhase.disconnected;
    final threads = ref.watch(threadsProvider).value ?? const [];
    final thread = threads.firstWhereOrNull((t) => t.id == widget.threadId);
    final snapshot = timelineAsync.value;

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
            child: CustomScrollView(
              controller: _scroll,
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
                      branch: _environment.gitBranch,
                      onTap: _openEnvironment,
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
          ComposerBar(
            environment: _environment,
            enabled: phase == ConnectionPhase.connected,
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
