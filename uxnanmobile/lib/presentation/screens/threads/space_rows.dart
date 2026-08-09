import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/agent_run_state_provider.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/agent_status_indicator.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// How far a workspace row sits in from its project, and a conversation from
/// its workspace.
///
/// Kept small on purpose. Three levels of nesting on a 390 dp phone can eat a
/// third of the width before any text starts, so the hierarchy is carried by a
/// hairline guide and a size step rather than by distance.
const double kSpaceIndent = UxnanSpacing.md;

/// The strongest state among a set of conversations — what the group as a whole
/// is doing.
///
/// Priority mirrors the per-thread one: a group with anything waiting is
/// waiting, and so on down. A group is never quieter than its loudest member,
/// which is the only way a collapsed row can be trusted.
AgentRunStatus aggregateStatus(WidgetRef ref, Iterable<Thread> threads) {
  var errored = false;
  AgentRunState? best;
  const rank = {
    AgentRunState.waiting: 0,
    AgentRunState.blocked: 1,
    AgentRunState.working: 2,
    AgentRunState.done: 3,
    AgentRunState.idle: 4,
  };
  for (final thread in threads) {
    final status = ref.watch(agentRunStatusProvider(thread.id));
    errored = errored || status.errored;
    if (best == null || rank[status.state]! < rank[best]!) best = status.state;
  }
  return (
    state: best ?? AgentRunState.idle,
    errored: errored,
    stale: false,
  );
}

/// A project: a header that opens and closes, with a summary line that only
/// appears when it has something to say.
class ProjectGroupHeader extends ConsumerWidget {
  /// Creates a [ProjectGroupHeader].
  const ProjectGroupHeader({
    required this.group,
    required this.expanded,
    required this.onToggle,
    required this.onNewConversation,
    super.key,
  });

  /// The project being headed.
  final ProjectGroup group;

  /// Whether its contents are showing.
  final bool expanded;

  /// Opens or closes it.
  final VoidCallback onToggle;

  /// Starts a conversation in this project's folder.
  final VoidCallback onNewConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final threads = group.threads.toList();
    final unread = threads.any((t) => ref.watch(unreadForProvider(t.id)));

    // The summary earns its line only when there is real signal. A project with
    // one folder and nothing running says nothing a second line could add, and
    // a screen of empty summaries is how a list stops being scannable.
    final workspaces = group.workspaces.length;
    final agents = _distinctAgents(threads);
    final showSummary = workspaces > 1 || agents.length > 1;

    return Semantics(
      button: true,
      expanded: expanded,
      label: group.name.isEmpty ? l10n.spacesOther : group.name,
      child: InkWell(
        onTap: onToggle,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.sm,
            vertical: UxnanSpacing.sm,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  // Rotates rather than swapping glyphs, so the control reads
                  // as one thing moving instead of two states blinking.
                  AnimatedRotation(
                    turns: expanded ? 0.25 : 0,
                    duration: MediaQuery.disableAnimationsOf(context)
                        ? Duration.zero
                        : const Duration(milliseconds: 180),
                    curve: Curves.easeOutCubic,
                    child: UxIcon(
                      UxIcons.chevronRight,
                      size: 18,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  UxIcon(
                    UxIcons.folder,
                    size: 18,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(
                    child: Text(
                      group.name.isEmpty ? l10n.spacesOther : group.name,
                      style: textTheme.titleSmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (unread) ...[
                    const SizedBox(width: UxnanSpacing.sm),
                    _UnreadDot(color: colors.primary),
                  ],
                  const SizedBox(width: UxnanSpacing.xs),
                  // Closed, the header still has to say what is going on
                  // inside — otherwise closing a project hides the very thing
                  // you opened the app for.
                  if (!expanded)
                    AgentStatusIndicator(status: aggregateStatus(ref, threads)),
                  IconButton(
                    onPressed: onNewConversation,
                    icon: const UxIcon(UxIcons.add, size: 20),
                    tooltip: l10n.spacesNewConversationHere,
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
              if (showSummary)
                Padding(
                  // Lines up under the title, not under the chevron.
                  padding: const EdgeInsets.only(left: 46, top: 2),
                  child: Row(
                    children: [
                      Text(
                        l10n.spacesWorkspaceCount(workspaces),
                        style: textTheme.bodySmall,
                      ),
                      if (agents.isNotEmpty) ...[
                        const SizedBox(width: UxnanSpacing.sm),
                        for (final agent in agents.take(3))
                          Padding(
                            padding: const EdgeInsets.only(
                              right: UxnanSpacing.xs,
                            ),
                            child: AgentLogo(agent: agent, size: 14),
                          ),
                        if (agents.length > 3)
                          Text(
                            '+${agents.length - 3}',
                            style: textTheme.bodySmall,
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

  static List<AgentId> _distinctAgents(List<Thread> threads) {
    final seen = <AgentId>{};
    for (final thread in threads) {
      seen.add(AgentIdParsing.fromWireId(thread.agentId));
    }
    return seen.toList();
  }
}

/// A working folder: one line of text and nothing else.
///
/// Everything a folder could say — its full path, its conversations, its git
/// state once that lands — lives one long-press away instead of on a second
/// line. `uxnandesktop` makes the same trade with a hover card; a phone has no
/// hover, so the gesture is the press.
class WorkspaceGroupRow extends ConsumerWidget {
  /// Creates a [WorkspaceGroupRow].
  const WorkspaceGroupRow({
    required this.group,
    required this.expanded,
    required this.onToggle,
    required this.onDetails,
    super.key,
  });

  /// The folder being headed.
  final WorkspaceGroup group;

  /// Whether its conversations are showing.
  final bool expanded;

  /// Opens or closes it.
  final VoidCallback onToggle;

  /// Opens the detail sheet.
  final VoidCallback onDetails;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final label = group.label.isEmpty ? l10n.spacesNoFolder : group.label;

    return InkWell(
      onTap: onToggle,
      onLongPress: onDetails,
      borderRadius: const BorderRadius.all(UxnanRadius.md),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.sm,
          vertical: UxnanSpacing.xs,
        ),
        child: Row(
          children: [
            AnimatedRotation(
              turns: expanded ? 0.25 : 0,
              duration: MediaQuery.disableAnimationsOf(context)
                  ? Duration.zero
                  : const Duration(milliseconds: 180),
              curve: Curves.easeOutCubic,
              child: UxIcon(
                UxIcons.chevronRight,
                size: 14,
                color: colors.onSurfaceVariant,
              ),
            ),
            const SizedBox(width: UxnanSpacing.xs),
            // Where the branch name will go once git lands (phase 4); until
            // then the folder's own name is the most specific thing known.
            UxIcon(
              UxIcons.altRoute,
              size: 14,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Text(
                label,
                style: textTheme.bodyMedium,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (!expanded) ...[
              const SizedBox(width: UxnanSpacing.sm),
              AgentStatusIndicator(
                status: aggregateStatus(ref, group.threads),
                size: 12,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The hairline that ties indented rows back to the row they belong to.
class SpaceGuide extends StatelessWidget {
  /// Creates a [SpaceGuide] around [child].
  const SpaceGuide({required this.child, super.key});

  /// The indented content.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(left: kSpaceIndent),
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            left: BorderSide(
              color: colors.outlineVariant.withValues(alpha: 0.5),
            ),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.only(left: UxnanSpacing.sm),
          child: child,
        ),
      ),
    );
  }
}

class _UnreadDot extends StatelessWidget {
  const _UnreadDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
