import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_menu_button.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Shared ordering, search and density controls for the active and archived
/// thread lists, so both screens behave identically.

/// How any level of the threads list is ordered.
///
/// One enum for all three — projects, worktrees and agents want the same four
/// answers, and three near-identical enums would drift apart the first time one
/// of them gained an option.
///
/// The names are stable: [ThreadSortSetting] persists the choice by `.name`, so
/// renaming a value silently resets everyone's preference to the default.
enum ListSort {
  /// Whatever wants you first: waiting, then blocked, then working. The order
  /// you want when you open the app to find out what happened.
  status,

  /// What moved most recently.
  activity,

  /// Newest first.
  created,

  /// Alphabetical — the order that stays put while you work.
  name,
}

/// The orderings offered for **agents** (conversations).
///
/// All four: an agent has a real creation date and a real state of its own.
const List<ListSort> kAgentSorts = ListSort.values;

/// The orderings offered for **projects and worktrees**.
///
/// Also all four, but `created` means something derived — see
/// [workspaceCreatedAt]: a folder has no creation date of its own, so the
/// oldest agent inside it stands in for "when you started working here".
const List<ListSort> kGroupSorts = ListSort.values;

/// The orderings offered in the **archive**.
///
/// No `status` and no `activity`: archived work is finished by definition, so
/// both would sort by a value that can no longer change. What is left is how
/// you actually look something up — when it was, or what it was called.
const List<ListSort> kArchiveSorts = [ListSort.created, ListSort.name];

/// When work in [group] began: the oldest agent in it.
///
/// A folder has no creation date — the bridge reports a path, not a history —
/// so this stands in for one, and it is the honest reading: the folder became
/// interesting when the first conversation started there.
DateTime? workspaceCreatedAt(WorkspaceGroup group) {
  DateTime? oldest;
  for (final thread in group.threads) {
    final created = thread.createdAt;
    if (created == null) continue;
    if (oldest == null || created.isBefore(oldest)) oldest = created;
  }
  return oldest;
}

/// The most recent activity anywhere in [group].
DateTime? workspaceLastActivity(WorkspaceGroup group) {
  DateTime? newest;
  for (final thread in group.threads) {
    final at = thread.lastActivity;
    if (at == null) continue;
    if (newest == null || at.isAfter(newest)) newest = at;
  }
  return newest;
}

/// Orders by [newest] descending, sinking unknowns to the bottom where they are
/// ordered by [label] so the tail never shuffles between rebuilds.
int compareByDate(DateTime? a, DateTime? b, String aLabel, String bLabel) {
  if (a == null && b == null) {
    return aLabel.toLowerCase().compareTo(bLabel.toLowerCase());
  }
  if (a == null) return 1;
  if (b == null) return -1;
  return b.compareTo(a);
}

/// Returns a new list ordered by [sort].
///
/// Threads with nothing to sort on (no `createdAt`, never active, no state)
/// sink to the bottom ordered by title, so the tail of a list is stable rather
/// than reshuffling on every rebuild.
List<Thread> sortThreads(
  List<Thread> threads,
  ListSort sort, {
  int Function(Thread)? statusRank,
}) {
  final list = [...threads];
  switch (sort) {
    case ListSort.created:
      list.sort(
        (a, b) => compareByDate(a.createdAt, b.createdAt, a.title, b.title),
      );
    case ListSort.name:
      list.sort(
        (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
      );
    case ListSort.activity:
      list.sort(
        (a, b) =>
            compareByDate(a.lastActivity, b.lastActivity, a.title, b.title),
      );
    case ListSort.status:
      // Needs the derived run state, which lives behind a provider — so the
      // caller supplies the rank rather than this function reaching for one.
      // With no ranker (the archive), state is meaningless and activity is the
      // sensible stand-in.
      if (statusRank == null) {
        list.sort(
          (a, b) =>
              compareByDate(a.lastActivity, b.lastActivity, a.title, b.title),
        );
      } else {
        list.sort((a, b) {
          final byState = statusRank(a).compareTo(statusRank(b));
          if (byState != 0) return byState;
          return compareByDate(
            a.lastActivity,
            b.lastActivity,
            a.title,
            b.title,
          );
        });
      }
  }
  return list;
}

/// Filters [threads] by [query] across title, id, agent (label + wire id) and
/// working folder (case-insensitive substring). An empty query returns all.
List<Thread> matchThreads(List<Thread> threads, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return threads;
  return threads.where((t) {
    final agentLabel =
        AgentVisuals.labelFor(AgentIdParsing.fromWireId(t.agentId))
            .toLowerCase();
    return t.title.toLowerCase().contains(q) ||
        t.id.toLowerCase().contains(q) ||
        t.agentId.toLowerCase().contains(q) ||
        agentLabel.contains(q) ||
        (t.cwd ?? '').toLowerCase().contains(q);
  }).toList();
}

/// A small agent logo (or a fallback icon) used by the filter chips and the
/// search result rows.
class AgentChipAvatar extends StatelessWidget {
  /// Creates an [AgentChipAvatar] for [agent] at [size] (logical px).
  const AgentChipAvatar({required this.agent, this.size = 16, super.key});

  /// The agent whose logo/colour is shown.
  final AgentId agent;

  /// Square edge length in logical pixels.
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final logo = AgentVisuals.logoFor(agent);
    if (logo == null) {
      return UxIcon(
        UxIcons.smartToy,
        size: size,
        color: AgentVisuals.colorFor(agent),
      );
    }
    return SvgPicture.asset(
      logo,
      width: size,
      height: size,
      theme: SvgTheme(currentColor: colors.onSurface),
    );
  }
}

/// App-bar search affordance backed by the M3 [SearchAnchor] full-screen view.
/// Matches threads by title, id, agent (label or wire id) or working folder;
/// tapping a result calls [onSelect] with its id.
class ThreadSearchAnchor extends StatelessWidget {
  /// Creates a [ThreadSearchAnchor] over [threads].
  const ThreadSearchAnchor({
    required this.threads,
    required this.onSelect,
    super.key,
  });

  /// The threads searched (already scoped/filtered by the caller).
  final List<Thread> threads;

  /// Called with the chosen thread id when a result is tapped.
  final void Function(String threadId) onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SearchAnchor(
      isFullScreen: true,
      viewHintText: l10n.threadsSearchHint,
      // The full-screen view draws its own back arrow and clear button from
      // Flutter's Material set unless they are supplied — the one place in the
      // app where a Material glyph survived the icon migration, because it is
      // built inside the framework rather than by us.
      viewLeading: IconButton(
        icon: const UxIcon(UxIcons.arrowBack),
        tooltip: MaterialLocalizations.of(context).backButtonTooltip,
        onPressed: () => Navigator.of(context).pop(),
      ),
      // Flutter also puts a Material ✕ in the view's trailing slot. Dropping it
      // is deliberate rather than re-skinned: clearing needs the anchor's own
      // SearchController, which would make three widgets stateful for one
      // glyph, and the view is one tap from closing anyway.
      viewTrailing: const [],
      builder: (context, controller) => IconSurface(
        icon: UxIcons.search,
        tooltip: l10n.threadsSearch,
        onPressed: controller.openView,
      ),
      suggestionsBuilder: (context, controller) {
        final results = matchThreads(threads, controller.text);
        if (results.isEmpty) {
          return [
            Padding(
              padding: const EdgeInsets.all(UxnanSpacing.xl),
              child: Center(
                child: Text(
                  l10n.threadsSearchEmpty,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ),
            ),
          ];
        }
        return [
          for (final thread in results)
            _SearchResultTile(
              thread: thread,
              onTap: () {
                controller.closeView(thread.title);
                onSelect(thread.id);
              },
            ),
        ];
      },
    );
  }
}

/// A single search result row: the agent avatar, the thread title and an
/// agent · folder subtitle (the id is matched but kept out of the way).
class _SearchResultTile extends StatelessWidget {
  const _SearchResultTile({required this.thread, required this.onTap});

  final Thread thread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final agent = AgentIdParsing.fromWireId(thread.agentId);
    final folder = thread.cwd?.split(RegExp(r'[\\/]')).last;
    final label = AgentVisuals.labelFor(agent);
    return ListTile(
      leading: SizedBox(
        width: 32,
        height: 32,
        child: Center(child: AgentChipAvatar(agent: agent, size: 24)),
      ),
      title: Text(thread.title, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        folder == null ? label : '$label · $folder',
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: colors.onSurfaceVariant),
      ),
      onTap: onTap,
    );
  }
}

/// App-bar sort control: an M3 menu with a check on the active [sort].
/// Which level of the list a sort choice moves.
enum SortLevel {
  /// The repositories that head worktrees.
  projects,

  /// The worktrees / folders that head agents.
  worktrees,

  /// The agents themselves.
  agents,
}

/// One value the sort menu can return: an ordering, and which level it orders.
class SortChoice {
  /// Creates a [SortChoice].
  const SortChoice(this.level, this.value);

  /// Which level this orders.
  final SortLevel level;

  /// The chosen ordering.
  final ListSort value;
}

/// The ordering menu: pick a level, then pick its ordering.
///
/// **Two steps, not one list.** The list has three levels now, and offering
/// every ordering for every level at once was seventeen entries — a menu that
/// ran off the bottom of a phone, which is not a menu. Each level opens its
/// own short list in the same place the first one was, so the second step
/// never feels like a different control.
///
/// The first step is not a bare router: each level shows **what it is ordered
/// by right now**, so the common question ("how is this sorted?") is answered
/// without drilling in at all.
///
/// A level with nothing to order is not shown: the archive has only agents,
/// and a PC whose folders never group has no project row to sort.
class ThreadSortMenu extends StatelessWidget {
  /// Creates a [ThreadSortMenu].
  const ThreadSortMenu({
    required this.agentSort,
    required this.onChanged,
    this.projectSort,
    this.worktreeSort,
    this.options = kAgentSorts,
    super.key,
  });

  /// The current project ordering, or null when no projects are drawn.
  final ListSort? projectSort;

  /// The current worktree ordering, or null on a screen with no worktrees
  /// (the archive), which then goes straight to the agent orderings.
  final ListSort? worktreeSort;

  /// The current agent ordering.
  final ListSort agentSort;

  /// Which orderings to offer. The archive offers fewer — see [kArchiveSorts].
  final List<ListSort> options;

  /// Called when the user picks an ordering for a level.
  final ValueChanged<SortChoice> onChanged;

  static String _labelFor(AppLocalizations l10n, ListSort sort) =>
      switch (sort) {
        ListSort.status => l10n.sortByAttention,
        ListSort.activity => l10n.sortByActivity,
        ListSort.created => l10n.threadsSortCreated,
        ListSort.name => l10n.threadsSortName,
      };

  Future<void> _open(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final levels = <(SortLevel, String, ListSort)>[
      if (projectSort != null)
        (SortLevel.projects, l10n.sortProjectsHeader, projectSort!),
      if (worktreeSort != null)
        (SortLevel.worktrees, l10n.sortFoldersHeader, worktreeSort!),
      (SortLevel.agents, l10n.sortConversationsHeader, agentSort),
    ];

    // One level to order is not a choice — go straight to its orderings rather
    // than making the reader tap through a menu of one.
    final level =
        levels.length == 1 ? levels.single : await _pickLevel(context, levels);
    if (level == null || !context.mounted) return;

    final sort = await _pickSort(context, level.$3);
    if (sort == null) return;
    onChanged(SortChoice(level.$1, sort));
  }

  Future<(SortLevel, String, ListSort)?> _pickLevel(
    BuildContext context,
    List<(SortLevel, String, ListSort)> levels,
  ) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return showMenu<(SortLevel, String, ListSort)>(
      context: context,
      position: menuPositionUnder(context),
      constraints: kNeMenuConstraints,
      items: [
        for (final level in levels)
          PopupMenuItem<(SortLevel, String, ListSort)>(
            value: level,
            child: Row(
              children: [
                Expanded(child: Text(level.$2)),
                const SizedBox(width: UxnanSpacing.md),
                // What it is sorted by, right here: the question this menu
                // usually gets asked, answered before any drilling.
                Text(
                  _labelFor(l10n, level.$3),
                  style: textTheme.bodySmall,
                ),
                const SizedBox(width: UxnanSpacing.xs),
                UxIcon(
                  UxIcons.chevronRight,
                  size: UxnanSize.iconContentSmall,
                  color: colors.onSurfaceVariant,
                ),
              ],
            ),
          ),
      ],
    );
  }

  Future<ListSort?> _pickSort(BuildContext context, ListSort current) {
    final l10n = AppLocalizations.of(context);
    return showMenu<ListSort>(
      context: context,
      // The same place the first step was, so the second does not read as a
      // different control opening somewhere else.
      position: menuPositionUnder(context),
      constraints: kNeMenuConstraints,
      items: [
        for (final sort in options)
          CheckedPopupMenuItem<ListSort>(
            value: sort,
            checked: current == sort,
            child: Text(_labelFor(l10n, sort)),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return IconSurface(
      icon: UxIcons.sort,
      tooltip: l10n.threadsSortBy,
      onPressed: () => unawaited(_open(context)),
    );
  }
}

enum _MoreAction { compact, archived }

/// App-bar overflow ("more") menu (M3 keeps the bar to a few common actions and
/// pushes the rest here): the density toggle as a checkable item, plus an
/// optional "Archived" navigation entry ([onArchived] is null on the archived
/// screen itself).
class ThreadMoreMenu extends StatelessWidget {
  /// Creates a [ThreadMoreMenu].
  const ThreadMoreMenu({
    required this.compact,
    required this.onCompactChanged,
    this.onArchived,
    super.key,
  });

  /// Whether the compact layout is active (shown checked).
  final bool compact;

  /// Called with the new density when the compact item is toggled.
  final ValueChanged<bool> onCompactChanged;

  /// Opens the archived list; omit (null) to hide the entry (e.g. when already
  /// on the archived screen).
  final VoidCallback? onArchived;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return IconSurfaceMenu<_MoreAction>(
      tooltip: l10n.threadsMore,
      icon: UxIcons.moreVert,
      onSelected: (action) {
        switch (action) {
          case _MoreAction.compact:
            onCompactChanged(!compact);
          case _MoreAction.archived:
            onArchived?.call();
        }
      },
      itemBuilder: (context) => [
        CheckedPopupMenuItem(
          value: _MoreAction.compact,
          checked: compact,
          child: Text(l10n.threadsCompact),
        ),
        if (onArchived != null)
          PopupMenuItem(
            value: _MoreAction.archived,
            child: Row(
              children: [
                const UxIcon(UxIcons.archive, size: 20),
                const SizedBox(width: UxnanSpacing.md),
                Text(l10n.archivedTitle),
              ],
            ),
          ),
      ],
    );
  }
}
