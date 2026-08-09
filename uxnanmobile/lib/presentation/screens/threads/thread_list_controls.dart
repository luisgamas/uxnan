import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Shared ordering, search and density controls for the active and archived
/// thread lists, so both screens behave identically.

/// How a threads list is ordered. [created] (newest first) is the default.
/// How the folders themselves are ordered.
enum SpaceSort {
  /// Alphabetical — the order that stays put while you work.
  name,

  /// The folder that moved most recently first.
  activity,

  /// Whatever wants you first: waiting, then blocked, then working. The order
  /// you want when you open the app to find out what happened.
  attention,
}

enum ThreadSort {
  /// Newest created first (the default).
  created,

  /// Alphabetical by title.
  name,

  /// Most recently active first — the order that matters once the list is
  /// grouped, because it answers "what moved" rather than "what exists".
  activity,
}

/// Returns a new list ordered by [sort]. For [ThreadSort.created], threads
/// without a known `createdAt` sink to the bottom (ordered by title).
List<Thread> sortThreads(List<Thread> threads, ThreadSort sort) {
  final list = [...threads];
  switch (sort) {
    case ThreadSort.created:
      list.sort((a, b) {
        final ac = a.createdAt;
        final bc = b.createdAt;
        if (ac == null && bc == null) return a.title.compareTo(b.title);
        if (ac == null) return 1;
        if (bc == null) return -1;
        return bc.compareTo(ac);
      });
    case ThreadSort.name:
      list.sort(
        (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
      );
    case ThreadSort.activity:
      // Threads that have never moved sink, ordered by title, so the top of a
      // group is always the thing that changed most recently.
      list.sort((a, b) {
        final aa = a.lastActivity;
        final bb = b.lastActivity;
        if (aa == null && bb == null) return a.title.compareTo(b.title);
        if (aa == null) return 1;
        if (bb == null) return -1;
        return bb.compareTo(aa);
      });
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
/// One value the sort menu can return: either an ordering for the folders or
/// one for the conversations inside them.
sealed class SortChoice {
  const SortChoice();
}

/// Order the folders.
class SpaceSortChoice extends SortChoice {
  /// Creates a [SpaceSortChoice].
  const SpaceSortChoice(this.value);

  /// The chosen folder ordering.
  final SpaceSort value;
}

/// Order the conversations inside each folder.
class ThreadSortChoice extends SortChoice {
  /// Creates a [ThreadSortChoice].
  const ThreadSortChoice(this.value);

  /// The chosen conversation ordering.
  final ThreadSort value;
}

/// The ordering menu, in two headed groups.
///
/// The list has two axes now — which folder comes first, and which conversation
/// comes first inside it — and they answer different questions. One flat menu
/// mixing them would make the reader work out which of their rows each entry
/// moves.
class ThreadSortMenu extends StatelessWidget {
  /// Creates a [ThreadSortMenu].
  const ThreadSortMenu({
    required this.threadSort,
    required this.onChanged,
    this.spaceSort,
    super.key,
  });

  /// The current folder ordering, or null on a screen with no folders (the
  /// archived list), which then shows only the conversation group.
  final SpaceSort? spaceSort;

  /// The current conversation ordering.
  final ThreadSort threadSort;

  /// Called when the user picks either ordering.
  final ValueChanged<SortChoice> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;

    PopupMenuEntry<SortChoice> header(String text) => PopupMenuItem<SortChoice>(
          enabled: false,
          height: 32,
          child: Text(
            text,
            style: textTheme.bodySmall?.copyWith(color: colors.primary),
          ),
        );

    return IconSurfaceMenu<SortChoice>(
      tooltip: l10n.threadsSortBy,
      icon: UxIcons.sort,
      // No `initialValue`: it would tint the active item's background with
      // square corners (overflowing the rounded menu). The active ordering is
      // already shown by the CheckedPopupMenuItem's check.
      onSelected: onChanged,
      itemBuilder: (context) => [
        if (spaceSort != null) ...[
          header(l10n.sortFoldersHeader),
          CheckedPopupMenuItem(
            value: const SpaceSortChoice(SpaceSort.attention),
            checked: spaceSort == SpaceSort.attention,
            child: Text(l10n.sortByAttention),
          ),
          CheckedPopupMenuItem(
            value: const SpaceSortChoice(SpaceSort.activity),
            checked: spaceSort == SpaceSort.activity,
            child: Text(l10n.sortByActivity),
          ),
          CheckedPopupMenuItem(
            value: const SpaceSortChoice(SpaceSort.name),
            checked: spaceSort == SpaceSort.name,
            child: Text(l10n.threadsSortName),
          ),
          const PopupMenuDivider(),
          header(l10n.sortConversationsHeader),
        ],
        CheckedPopupMenuItem(
          value: const ThreadSortChoice(ThreadSort.created),
          checked: threadSort == ThreadSort.created,
          child: Text(l10n.threadsSortCreated),
        ),
        CheckedPopupMenuItem(
          value: const ThreadSortChoice(ThreadSort.activity),
          checked: threadSort == ThreadSort.activity,
          child: Text(l10n.sortByActivity),
        ),
        CheckedPopupMenuItem(
          value: const ThreadSortChoice(ThreadSort.name),
          checked: threadSort == ThreadSort.name,
          child: Text(l10n.threadsSortName),
        ),
      ],
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
