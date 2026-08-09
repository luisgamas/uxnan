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

/// How far a conversation sits in from the folder it belongs to.
///
/// Carried by space alone. An earlier version drew a hairline down the left of
/// every open folder, and it read as a table rule — boxing in the rows it was
/// only meant to relate.
const double kSpaceIndent = UxnanSpacing.lg;

/// Where a folder's second line starts: under its **name**, not under the
/// chevron. Derived from the glyphs that precede the name rather than typed as
/// a number, so resizing either one keeps the two lines aligned.
const double _kSecondLineIndent = UxnanSize.iconContentSmall +
    UxnanSpacing.xs +
    UxnanSize.iconContentLarge +
    UxnanSpacing.sm;

/// The strongest state among a set of conversations — what the folder as a
/// whole is doing.
///
/// Priority mirrors the per-thread one: a folder with anything waiting is
/// waiting, and so on down. A folder is never quieter than its loudest
/// conversation, which is the only thing that makes a closed one trustworthy.
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
  return (state: best ?? AgentRunState.idle, errored: errored, stale: false);
}

/// A working folder: the top of the list, and the only grouping the phone can
/// honestly draw today.
///
/// Two lines, and the second one changes with the fold — the same trade
/// `uxnandesktop` makes in its agent view.
///
/// **Open**, the conversations below speak for themselves: each carries its own
/// agent mark and its own state, so repeating them on the header would say the
/// same thing twice. The line keeps only the count.
///
/// **Closed**, that evidence is gone, so the header has to stand in for it: the
/// count plus the marks of the agents inside, and — on the first line — the
/// strongest state among them.
class WorkspaceGroupRow extends ConsumerWidget {
  /// Creates a [WorkspaceGroupRow].
  const WorkspaceGroupRow({
    required this.group,
    required this.expanded,
    required this.onToggle,
    required this.onDetails,
    required this.onNewConversation,
    super.key,
  });

  /// The folder being headed.
  final WorkspaceGroup group;

  /// Whether its conversations are showing.
  final bool expanded;

  /// Opens or closes it.
  final VoidCallback onToggle;

  /// Opens the detail sheet (long press).
  final VoidCallback onDetails;

  /// Starts a conversation in this folder.
  final VoidCallback onNewConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final threads = group.threads;
    final label = group.label.isEmpty ? l10n.spacesNoFolder : group.label;
    final unread = threads.any((t) => ref.watch(unreadForProvider(t.id)));
    final agents = _distinctAgents(threads);

    return Semantics(
      button: true,
      expanded: expanded,
      label: label,
      child: InkWell(
        onTap: onToggle,
        onLongPress: onDetails,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.sm,
            vertical: UxnanSpacing.xs,
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
                      size: UxnanSize.iconContentSmall,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  UxIcon(
                    UxIcons.folder,
                    size: UxnanSize.iconContentLarge,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(
                    child: Text(
                      label,
                      // One rung above the conversations it heads (they take
                      // titleSmall), so the fold reads as structure rather
                      // than as a list of equals.
                      style: textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (unread) ...[
                    const SizedBox(width: UxnanSpacing.sm),
                    _UnreadDot(color: colors.primary),
                  ],
                  const SizedBox(width: UxnanSpacing.xs),
                  // Closed, the row still has to report what is happening
                  // inside it — otherwise closing a folder hides the very
                  // thing the screen exists to surface.
                  if (!expanded)
                    AgentStatusIndicator(
                      status: aggregateStatus(ref, threads),
                      size: UxnanSize.iconContentSmall,
                    ),
                  _NewConversationButton(onPressed: onNewConversation),
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(left: _kSecondLineIndent),
                child: Row(
                  children: [
                    // Yields first: a long count string ellipsizes instead of
                    // pushing the marks off the row. The marks are bounded (at
                    // most three plus an overflow count), so what is left of
                    // the line always fits them.
                    Flexible(
                      child: Text(
                        l10n.spacesConversationCount(threads.length),
                        // A step below the name and a step above a
                        // conversation's own second line, so the two levels
                        // stay parallel instead of collapsing into one size.
                        style: textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!expanded && agents.isNotEmpty) ...[
                      const SizedBox(width: UxnanSpacing.sm),
                      _AgentMarks(agents: agents),
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

/// Which agents are working in a closed folder, as a bounded strip.
///
/// Capped at three plus a count: past that the marks stop being recognisable
/// and start being texture, and the row has a name to protect.
class _AgentMarks extends StatelessWidget {
  const _AgentMarks({required this.agents});

  final List<AgentId> agents;

  static const int _max = 3;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final agent in agents.take(_max))
          Padding(
            padding: const EdgeInsets.only(right: UxnanSpacing.xs),
            child: AgentLogo(agent: agent),
          ),
        if (agents.length > _max)
          Text('+${agents.length - _max}', style: textTheme.bodySmall),
      ],
    );
  }
}

/// The row's own action: an **S button** from the guide's button hierarchy
/// (§4.5) — 40 dp of surface around a content-sized glyph, inside the usual
/// 48 dp touch target. Large enough to read as a button rather than a
/// decorative plus, small enough not to compete with the folder it sits on.
class _NewConversationButton extends StatelessWidget {
  const _NewConversationButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final label = AppLocalizations.of(context).spacesNewConversationHere;
    return Tooltip(
      message: label,
      child: SizedBox(
        width: UxnanSize.minTouchTarget,
        height: UxnanSize.minTouchTarget,
        child: Center(
          child: Material(
            color: colors.surfaceContainerHigh,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onPressed,
              child: SizedBox(
                width: UxnanSize.buttonSmall,
                height: UxnanSize.buttonSmall,
                child: UxIcon(
                  UxIcons.add,
                  size: UxnanSize.iconContent,
                  color: colors.onSurfaceVariant,
                  semanticLabel: label,
                ),
              ),
            ),
          ),
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
