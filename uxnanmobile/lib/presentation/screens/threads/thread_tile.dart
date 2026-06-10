import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';

/// A per-thread action chosen from the long-press menu.
enum _ThreadAction { rename, copyId, archive, unarchive, delete }

/// A conversation row used by both the active threads list and the archived
/// list. Tapping opens the conversation; long-pressing opens the actions menu
/// (rename / copy id / archive · unarchive / delete), adapted to the thread's
/// status.
class ThreadTile extends ConsumerWidget {
  /// Creates a [ThreadTile].
  const ThreadTile({required this.thread, this.compact = false, super.key});

  /// The thread to render.
  final Thread thread;

  /// Whether to use the denser, single-line layout (smaller avatar, no
  /// subtitle row). Defaults to the full two-line tile.
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final agent = AgentIdParsing.fromWireId(thread.agentId);
    // Live activity of the conversation (running/error), independent of the
    // thread's sync status — tracked even while this screen is closed.
    final activity = ref.watch(threadActivityForProvider(thread.id));
    // Unread agent reply: tint the tile and emphasize it so it stands out.
    final unread = ref.watch(unreadForProvider(thread.id));
    // Whether this thread's agent is not signed in on the PC — turns it red.
    // Cached per agentId; null (offline / older bridge) keeps the normal dot.
    final requiresLogin =
        ref.watch(authStatusProvider(thread.agentId)).value?.requiresLogin ??
            false;

    return Material(
      color: unread
          ? Color.alphaBlend(
              colors.primary.withValues(alpha: 0.10),
              colors.surfaceContainerHighest,
            )
          : colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: () => context.push(AppRoutes.conversation(thread.id)),
        onLongPress: () => showThreadActions(context, ref, thread),
        child: Padding(
          padding: compact
              ? const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.md,
                  vertical: UxnanSpacing.sm,
                )
              : const EdgeInsets.all(UxnanSpacing.md),
          child: Row(
            children: [
              _AgentAvatar(agent: agent, size: compact ? 34 : 44),
              SizedBox(width: compact ? UxnanSpacing.sm : UxnanSpacing.md),
              Expanded(
                child: compact
                    ? _CompactContent(
                        thread: thread,
                        activity: activity,
                        unread: unread,
                        requiresLogin: requiresLogin,
                      )
                    : _FullContent(
                        thread: thread,
                        activity: activity,
                        unread: unread,
                        requiresLogin: requiresLogin,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A small filled primary dot marking an unread thread.
class _UnreadDot extends StatelessWidget {
  const _UnreadDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary,
        shape: BoxShape.circle,
      ),
    );
  }
}

/// The full, two-line tile body: title + last-activity time, then the activity
/// indicator with the agent·folder subtitle (or "Responding…" while running).
class _FullContent extends StatelessWidget {
  const _FullContent({
    required this.thread,
    required this.activity,
    required this.unread,
    required this.requiresLogin,
  });
  final Thread thread;
  final ThreadActivity activity;
  final bool unread;
  final bool requiresLogin;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final responding = activity == ThreadActivity.running;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                thread.title,
                style: textTheme.titleSmall?.copyWith(
                  fontWeight: unread ? FontWeight.w700 : null,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (unread) ...[
              const SizedBox(width: UxnanSpacing.sm),
              const _UnreadDot(),
            ],
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
            _ActivityIndicator(
              activity: activity,
              status: thread.status,
              requiresLogin: requiresLogin,
            ),
            const SizedBox(width: UxnanSpacing.xs),
            Flexible(
              child: Text(
                responding ? l10n.threadResponding : _subtitleFor(thread),
                style: textTheme.bodySmall?.copyWith(
                  color: responding ? colors.primary : colors.onSurfaceVariant,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// The compact, single-line tile body: the activity indicator, the title, and
/// the last-activity time — no subtitle row.
class _CompactContent extends StatelessWidget {
  const _CompactContent({
    required this.thread,
    required this.activity,
    required this.unread,
    required this.requiresLogin,
  });
  final Thread thread;
  final ThreadActivity activity;
  final bool unread;
  final bool requiresLogin;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Row(
      children: [
        _ActivityIndicator(
          activity: activity,
          status: thread.status,
          requiresLogin: requiresLogin,
        ),
        const SizedBox(width: UxnanSpacing.sm),
        Expanded(
          child: Text(
            thread.title,
            style: textTheme.titleSmall?.copyWith(
              fontWeight: unread ? FontWeight.w700 : null,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (unread) ...[
          const SizedBox(width: UxnanSpacing.sm),
          const _UnreadDot(),
        ],
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
    );
  }
}

String _subtitleFor(Thread thread) {
  final agent =
      AgentVisuals.labelFor(AgentIdParsing.fromWireId(thread.agentId));
  final dir = thread.cwd?.split(RegExp(r'[\\/]')).last;
  return dir == null ? agent : '$agent · $dir';
}

/// Shows the per-thread actions sheet on long-press. The archive / unarchive
/// entry adapts to the thread's current status.
Future<void> showThreadActions(
  BuildContext context,
  WidgetRef ref,
  Thread thread,
) async {
  final l10n = AppLocalizations.of(context);
  final colors = Theme.of(context).colorScheme;
  final isArchived = thread.status == ThreadStatus.archived;
  final action = await showModalBottomSheet<_ThreadAction>(
    context: context,
    showDragHandle: true,
    builder: (context) => SafeArea(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(thread.title, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                thread.id,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: Text(l10n.threadActionRename),
              onTap: () => Navigator.pop(context, _ThreadAction.rename),
            ),
            ListTile(
              leading: const Icon(Icons.content_copy_outlined),
              title: Text(l10n.threadActionCopyId),
              onTap: () => Navigator.pop(context, _ThreadAction.copyId),
            ),
            if (isArchived)
              ListTile(
                leading: const Icon(Icons.unarchive_outlined),
                title: Text(l10n.threadActionUnarchive),
                onTap: () => Navigator.pop(context, _ThreadAction.unarchive),
              )
            else
              ListTile(
                leading: const Icon(Icons.archive_outlined),
                title: Text(l10n.threadActionArchive),
                onTap: () => Navigator.pop(context, _ThreadAction.archive),
              ),
            ListTile(
              leading: Icon(Icons.delete_outline, color: colors.error),
              title: Text(
                l10n.threadActionDelete,
                style: TextStyle(color: colors.error),
              ),
              onTap: () => Navigator.pop(context, _ThreadAction.delete),
            ),
          ],
        ),
      ),
    ),
  );
  if (action == null || !context.mounted) return;
  switch (action) {
    case _ThreadAction.rename:
      await _promptRenameThread(context, ref, thread);
    case _ThreadAction.copyId:
      await Clipboard.setData(ClipboardData(text: thread.id));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.threadIdCopied)),
        );
      }
    case _ThreadAction.archive:
      await ref.read(threadManagerProvider).archiveThread(thread.id);
    case _ThreadAction.unarchive:
      await ref.read(threadManagerProvider).unarchiveThread(thread.id);
    case _ThreadAction.delete:
      await _confirmDeleteThread(context, ref, thread);
  }
}

/// Prompts for a new title and renames the thread via the thread manager.
Future<void> _promptRenameThread(
  BuildContext context,
  WidgetRef ref,
  Thread thread,
) async {
  final l10n = AppLocalizations.of(context);
  final newTitle = await showDialog<String>(
    context: context,
    builder: (dialogContext) {
      final controller = TextEditingController(text: thread.title);
      return AlertDialog(
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
      );
    },
  );
  final trimmed = newTitle?.trim() ?? '';
  if (trimmed.isEmpty || trimmed == thread.title) return;
  await ref.read(threadManagerProvider).renameThread(thread.id, trimmed);
}

/// Confirms and deletes the thread via the thread manager.
Future<void> _confirmDeleteThread(
  BuildContext context,
  WidgetRef ref,
  Thread thread,
) async {
  final l10n = AppLocalizations.of(context);
  final colors = Theme.of(context).colorScheme;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.threadDeleteTitle),
      content: Text(l10n.threadDeleteBody),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text(l10n.actionCancel),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: colors.error),
          onPressed: () => Navigator.pop(context, true),
          child: Text(l10n.threadDeleteConfirm),
        ),
      ],
    ),
  );
  if (confirmed != true) return;
  await ref.read(threadManagerProvider).deleteThread(thread.id);
}

class _AgentAvatar extends StatelessWidget {
  const _AgentAvatar({required this.agent, this.size = 44});
  final AgentId agent;
  final double size;

  @override
  Widget build(BuildContext context) {
    final logo = AgentVisuals.logoFor(agent);
    if (logo != null) return AgentLogoChip(asset: logo, size: size);

    final colors = Theme.of(context).colorScheme;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Icon(
        Icons.smart_toy_outlined,
        size: size * 0.5,
        color: AgentVisuals.colorFor(agent),
      ),
    );
  }
}

/// Leading indicator on the subtitle row: a spinner while the agent is
/// responding, a red dot on error, a red dot when the agent is not signed in
/// on the PC, otherwise the thread's sync-status dot.
class _ActivityIndicator extends StatelessWidget {
  const _ActivityIndicator({
    required this.activity,
    required this.status,
    required this.requiresLogin,
  });
  final ThreadActivity activity;
  final ThreadStatus status;
  final bool requiresLogin;

  @override
  Widget build(BuildContext context) {
    switch (activity) {
      case ThreadActivity.running:
        return SizedBox(
          width: 10,
          height: 10,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: Theme.of(context).colorScheme.primary,
          ),
        );
      case ThreadActivity.error:
        return const _Dot(color: UxnanColors.error);
      case ThreadActivity.idle:
        // Not signed in on the PC: flag the otherwise-active thread red so the
        // user sees it needs a sign-in before its turns can run.
        if (requiresLogin && status == ThreadStatus.active) {
          return Tooltip(
            message: AppLocalizations.of(context).agentSignInRequired,
            child: const _Dot(color: UxnanColors.error),
          );
        }
        return _StatusDot(status: status);
    }
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
    return _Dot(color: color);
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
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
