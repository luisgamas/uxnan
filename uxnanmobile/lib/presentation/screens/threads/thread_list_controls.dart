import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';

/// Shared ordering, search and density controls for the active and archived
/// thread lists, so both screens behave identically.

/// How a threads list is ordered. [created] (newest first) is the default.
enum ThreadSort {
  /// Newest created first (the default).
  created,

  /// Alphabetical by title.
  name,

  /// Grouped alphabetically by working folder (cwd).
  folder,
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
    case ThreadSort.folder:
      list.sort((a, b) {
        final cmp = (a.cwd ?? '').toLowerCase().compareTo(
              (b.cwd ?? '').toLowerCase(),
            );
        return cmp != 0
            ? cmp
            : a.title.toLowerCase().compareTo(b.title.toLowerCase());
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
      return Icon(
        Icons.smart_toy_outlined,
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
      builder: (context, controller) => IconSurface(
        icon: Icons.search_rounded,
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
class ThreadSortMenu extends StatelessWidget {
  /// Creates a [ThreadSortMenu].
  const ThreadSortMenu({
    required this.sort,
    required this.onChanged,
    super.key,
  });

  /// The current ordering.
  final ThreadSort sort;

  /// Called when the user picks a different ordering.
  final ValueChanged<ThreadSort> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return PopupMenuButton<ThreadSort>(
      tooltip: l10n.threadsSortBy,
      // No `initialValue`: it would tint the active item's background with
      // square corners (overflowing the rounded menu). The active ordering is
      // already shown by the CheckedPopupMenuItem's check, like the more menu.
      onSelected: onChanged,
      position: PopupMenuPosition.under,
      child: const _MenuSurface(icon: Icons.sort_rounded),
      itemBuilder: (context) => [
        CheckedPopupMenuItem(
          value: ThreadSort.created,
          checked: sort == ThreadSort.created,
          child: Text(l10n.threadsSortCreated),
        ),
        CheckedPopupMenuItem(
          value: ThreadSort.name,
          checked: sort == ThreadSort.name,
          child: Text(l10n.threadsSortName),
        ),
        CheckedPopupMenuItem(
          value: ThreadSort.folder,
          checked: sort == ThreadSort.folder,
          child: Text(l10n.threadsSortFolder),
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
    return PopupMenuButton<_MoreAction>(
      tooltip: l10n.threadsMore,
      position: PopupMenuPosition.under,
      child: const _MenuSurface(icon: Icons.more_vert_rounded),
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
                const Icon(Icons.archive_outlined, size: 20),
                const SizedBox(width: UxnanSpacing.md),
                Text(l10n.archivedTitle),
              ],
            ),
          ),
      ],
    );
  }
}

/// A neutral circular surface (40 dp visual / 48 dp touch) used as the tappable
/// child of the sort/more popup menus, so they read as Icon Surfaces in the bar
/// — matching the standalone [IconSurface] actions elsewhere.
class _MenuSurface extends StatelessWidget {
  const _MenuSurface({required this.icon});
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SizedBox(
      width: 48,
      height: 48,
      child: Center(
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: colors.surfaceContainerHigh,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 20, color: colors.onSurfaceVariant),
        ),
      ),
    );
  }
}
