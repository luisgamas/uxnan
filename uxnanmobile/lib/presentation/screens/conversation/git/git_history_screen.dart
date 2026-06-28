import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';
import 'package:uxnan/domain/value_objects/git/git_log.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_commit_detail_screen.dart';
import 'package:uxnan/presentation/screens/conversation/git/widgets/commit_ref_chip.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_circular_button.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen commit history for the workspace's git repo — a single, clean,
/// flat list (no card chrome — matches the file browser's surface). The app
/// bar carries two `IconSurface` toggles:
///
///   - **Graph** — overlays a continuous, colored VS Code-style swimlane graph
///     on the left of each row. Fixed-height rows keep the dots aligned in
///     lanes; lines connect across rows with smooth circular-arc connectors
///     (lanes compact toward the left) and a branch-stable color per lane;
///     merge nodes get a separate outer ring.
///   - **Compact** — a denser row layout.
///
/// Backed by `git/log` (cursor pagination, 50/page) with **infinite scroll**
/// (a page loads as the user nears the bottom) and a **back-to-top** FAB.
/// Tapping a commit opens the full [GitCommitDetailScreen] (files + diff via
/// `git/commitShow`).
class GitHistoryScreen extends ConsumerStatefulWidget {
  /// Creates a [GitHistoryScreen].
  const GitHistoryScreen({this.cwd, this.ref, super.key});

  /// Workspace directory whose history is shown. Null disables loading.
  final String? cwd;

  /// Optional ref (branch / tag / remote) to start the log from. Defaults to
  /// HEAD on the bridge.
  final String? ref;

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context, {String? cwd, String? ref}) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => GitHistoryScreen(cwd: cwd, ref: ref),
      ),
    );
  }

  @override
  ConsumerState<GitHistoryScreen> createState() => _GitHistoryScreenState();
}

class _GitHistoryScreenState extends ConsumerState<GitHistoryScreen> {
  /// Page size per `git/log` call.
  static const int _pageSize = 50;

  /// How close to the bottom (px) triggers the next page load.
  static const double _loadMoreThreshold = 600;

  /// Scroll offset past which the back-to-top FAB appears.
  static const double _backToTopThreshold = 800;

  List<GitCommit> _commits = const [];
  String? _nextCursor;
  bool _hasMore = false;
  bool _initialLoading = true;
  bool _pageLoading = false;
  bool _refreshLoading = false;
  Object? _error;

  bool _showGraph = false;
  bool _compact = false;
  bool _showBackToTop = false;

  /// The ref (branch / tag / remote) the history is viewed from. `null` = the
  /// workspace's current HEAD. Seeded from [widget.ref].
  String? _viewingRef;

  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _viewingRef = widget.ref;
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadFirstPage());
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_onScroll)
      ..dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    if (_hasMore &&
        !_pageLoading &&
        pos.pixels >= pos.maxScrollExtent - _loadMoreThreshold) {
      _loadMore();
    }
    final show = pos.pixels > _backToTopThreshold;
    if (show != _showBackToTop) {
      setState(() => _showBackToTop = show);
    }
  }

  Future<void> _loadFirstPage() async {
    final cwd = widget.cwd;
    if (cwd == null) {
      setState(() {
        _initialLoading = false;
        _error = StateError('Missing cwd');
      });
      return;
    }
    setState(() {
      _initialLoading = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(gitActionManagerProvider)
          .log(GitLogParams(cwd: cwd, limit: _pageSize, ref: _viewingRef));
      if (!mounted) return;
      setState(() {
        _commits = result.commits;
        _hasMore = result.hasMore;
        _nextCursor = result.nextCursor;
        _initialLoading = false;
      });
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _initialLoading = false;
        _error = e;
      });
    }
  }

  Future<void> _refresh() async {
    final cwd = widget.cwd;
    if (cwd == null || _refreshLoading) return;
    setState(() {
      _refreshLoading = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(gitActionManagerProvider)
          .log(GitLogParams(cwd: cwd, limit: _pageSize, ref: _viewingRef));
      if (!mounted) return;
      setState(() {
        _commits = result.commits;
        _hasMore = result.hasMore;
        _nextCursor = result.nextCursor;
        _refreshLoading = false;
      });
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _refreshLoading = false;
        _error = e;
      });
    }
  }

  Future<void> _loadMore() async {
    final cwd = widget.cwd;
    final cursor = _nextCursor;
    if (cwd == null || cursor == null || _pageLoading || !_hasMore) return;
    setState(() => _pageLoading = true);
    try {
      final result = await ref
          .read(gitActionManagerProvider)
          .log(GitLogParams(cwd: cwd, limit: _pageSize, cursor: cursor));
      if (!mounted) return;
      setState(() {
        _commits = [..._commits, ...result.commits];
        _hasMore = result.hasMore;
        _nextCursor = result.nextCursor;
        _pageLoading = false;
      });
    } on Exception {
      if (!mounted) return;
      setState(() => _pageLoading = false);
    }
  }

  void _backToTop() {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      0,
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _openDetails(GitCommit commit) async {
    final cwd = widget.cwd;
    if (cwd == null) return;
    await GitCommitDetailScreen.push(
      context,
      cwd: cwd,
      sha: commit.sha,
      seed: commit,
    );
    // Returning from the detail screen can leave a soft keyboard up — its
    // `SelectableText` fields (message, SHA, metadata) open a text-input
    // connection that resurfaces on this list, which has no editable of its
    // own. Drop focus so it dismisses (same fix the file browser uses when
    // returning from the file viewer).
    if (mounted) FocusManager.instance.primaryFocus?.unfocus();
  }

  /// Opens the branch/ref picker and, on selection, reloads the history from
  /// that ref. `null` returns to the workspace's current HEAD. This is a
  /// read-only "view from" — it never checks the branch out.
  Future<void> _pickBranch() async {
    final cwd = widget.cwd;
    if (cwd == null) return;
    GitBranchList branches;
    try {
      branches = await ref.read(gitActionManagerProvider).branches(cwd);
    } on Object {
      branches = const GitBranchList(current: 'HEAD');
    }
    if (!mounted) return;
    final picked = await showModalBottomSheet<_RefChoice>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Theme.of(context).colorScheme.surfaceContainerHigh,
      builder: (_) =>
          _BranchPickerSheet(branches: branches, selectedRef: _viewingRef),
    );
    if (picked == null || !mounted) return;
    // `_RefChoice(ref: null)` means "back to HEAD".
    if (picked.ref == _viewingRef) return;
    setState(() => _viewingRef = picked.ref);
    await _loadFirstPage();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final hasContent = !_initialLoading && _commits.isNotEmpty;

    Widget sliver;
    if (_initialLoading) {
      sliver = SliverFillRemaining(
        hasScrollBody: false,
        child: Center(child: PolygonLoader(size: 48, color: colors.primary)),
      );
    } else if (_error != null && _commits.isEmpty) {
      sliver = SliverFillRemaining(
        hasScrollBody: false,
        child: _CenteredState(
          icon: Icons.error_outline_rounded,
          iconColor: colors.error,
          title: l10n.gitHistoryErrorTitle,
          action: FilledButton.tonal(
            onPressed: _loadFirstPage,
            child: Text(l10n.gitHistoryRetry),
          ),
        ),
      );
    } else if (_commits.isEmpty) {
      sliver = SliverFillRemaining(
        hasScrollBody: false,
        child: _CenteredState(
          icon: Icons.history_toggle_off_rounded,
          iconColor: colors.onSurfaceVariant,
          title: l10n.gitHistoryEmpty,
          body: l10n.gitHistoryEmptyBody,
        ),
      );
    } else {
      sliver = _buildCommitsSliver();
    }

    return NeScaffold(
      title: l10n.gitHistoryTitle,
      scrollController: _scrollController,
      onRefresh: _initialLoading ? null : _refresh,
      floatingActionButton: _showBackToTop
          ? NeCircularButton(
              icon: Icons.keyboard_arrow_up_rounded,
              tooltip: l10n.gitHistoryBackToTop,
              onTap: _backToTop,
            )
          : null,
      actions: [
        if (hasContent)
          _CommitSearchAnchor(commits: _commits, onSelect: _openDetails),
        if (widget.cwd != null && !_initialLoading)
          IconSurface(
            icon: Icons.alt_route_rounded,
            tooltip: l10n.gitHistoryViewBranch,
            selected: _viewingRef != null,
            onPressed: _pickBranch,
          ),
        if (hasContent)
          IconSurface(
            icon: _showGraph
                ? Icons.account_tree_rounded
                : Icons.account_tree_outlined,
            tooltip: _showGraph
                ? l10n.gitHistoryHideGraph
                : l10n.gitHistoryShowGraph,
            selected: _showGraph,
            onPressed: () => setState(() => _showGraph = !_showGraph),
          ),
        if (hasContent)
          IconSurface(
            icon: _compact
                ? Icons.density_medium_rounded
                : Icons.density_small_rounded,
            tooltip:
                _compact ? l10n.gitHistoryComfortable : l10n.gitHistoryCompact,
            selected: _compact,
            onPressed: () => setState(() => _compact = !_compact),
          ),
      ],
      slivers: [
        if (_viewingRef != null)
          SliverToBoxAdapter(
            child: _ViewingRefBanner(
              refName: _viewingRef!,
              onClear: () {
                setState(() => _viewingRef = null);
                _loadFirstPage();
              },
            ),
          ),
        sliver,
      ],
    );
  }

  Widget _buildCommitsSliver() {
    final footer = _hasMore ? 1 : 0;

    if (_showGraph) {
      final rows = _buildGraph(_commits);
      final maxLanes = rows.isEmpty
          ? 1
          : rows.map((r) => r.laneCount).reduce((a, b) => a > b ? a : b);
      return SliverList.builder(
        itemCount: rows.length + footer,
        itemBuilder: (context, index) {
          if (index >= rows.length) {
            return _PageFooter(loading: _pageLoading, onLoadMore: _loadMore);
          }
          return _CommitGraphRow(
            row: rows[index],
            maxLanes: maxLanes,
            compact: _compact,
            onTap: () => _openDetails(rows[index].commit),
          );
        },
      );
    }

    return SliverList.builder(
      itemCount: _commits.length + footer,
      itemBuilder: (context, index) {
        if (index >= _commits.length) {
          return _PageFooter(loading: _pageLoading, onLoadMore: _loadMore);
        }
        return _CommitRow(
          commit: _commits[index],
          compact: _compact,
          onTap: () => _openDetails(_commits[index]),
        );
      },
    );
  }
}

/// App-bar search affordance over the commit history, backed by the M3
/// [SearchAnchor] full-screen view — the same pattern as the threads list.
/// Matches a commit by message (title/body), full or short SHA, author
/// (name/email) or any ref name; tapping a result opens that commit's detail.
///
/// Searches the commits **currently loaded** into the list (the history pages
/// in lazily as the user scrolls and via "Load older commits"), so scrolling
/// deeper widens what search can reach — `git/log` exposes no server-side
/// search to query the whole history at once.
class _CommitSearchAnchor extends StatelessWidget {
  const _CommitSearchAnchor({required this.commits, required this.onSelect});

  final List<GitCommit> commits;
  final void Function(GitCommit commit) onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SearchAnchor(
      isFullScreen: true,
      viewHintText: l10n.gitHistorySearchHint,
      builder: (context, controller) => IconSurface(
        icon: Icons.search_rounded,
        tooltip: l10n.gitHistorySearch,
        onPressed: controller.openView,
      ),
      suggestionsBuilder: (context, controller) {
        final results = matchCommits(commits, controller.text);
        if (results.isEmpty) {
          return [
            Padding(
              padding: const EdgeInsets.all(UxnanSpacing.xl),
              child: Center(
                child: Text(
                  l10n.gitHistorySearchEmpty,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ),
            ),
          ];
        }
        return [
          for (final commit in results)
            _CommitSearchResultTile(
              commit: commit,
              onTap: () {
                controller.closeView(commit.messageTitle);
                onSelect(commit);
              },
            ),
        ];
      },
    );
  }
}

/// A single commit search result: the short-SHA badge, the commit title and a
/// muted `by <author> · <relative date>` subtitle.
class _CommitSearchResultTile extends StatelessWidget {
  const _CommitSearchResultTile({required this.commit, required this.onTap});

  final GitCommit commit;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      leading: _ShaBadge(shortSha: commit.shortSha),
      title: Text(
        commit.messageTitle,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        '${l10n.gitHistoryCommitBy(commit.authorName)} · '
        '${_relativeDate(commit.authorDate)}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: colors.onSurfaceVariant),
      ),
      onTap: onTap,
    );
  }
}

/// Filters [commits] by [rawQuery] (case-insensitive), matching the message
/// title/body, the full or short SHA, the author name/email, or any ref name.
/// An empty query returns the full loaded list. Public so the filter can be
/// unit-tested directly (mirrors `matchThreads` for the threads search).
List<GitCommit> matchCommits(List<GitCommit> commits, String rawQuery) {
  final q = rawQuery.trim().toLowerCase();
  if (q.isEmpty) return commits;
  return commits.where((c) {
    if (c.messageTitle.toLowerCase().contains(q)) return true;
    if (c.messageBody.toLowerCase().contains(q)) return true;
    if (c.sha.toLowerCase().contains(q)) return true;
    if (c.shortSha.toLowerCase().contains(q)) return true;
    if (c.authorName.toLowerCase().contains(q)) return true;
    if (c.authorEmail.toLowerCase().contains(q)) return true;
    for (final ref in c.refs) {
      if (ref.name.toLowerCase().contains(q)) return true;
    }
    return false;
  }).toList();
}

/// A flat commit row for the plain (graph-off) list — no card, matching the
/// file browser's clean surface. Two lines: title + a muted meta line.
class _CommitRow extends StatelessWidget {
  const _CommitRow({
    required this.commit,
    required this.compact,
    required this.onTap,
  });

  final GitCommit commit;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: UxnanSpacing.lg,
          vertical: compact ? UxnanSpacing.sm : UxnanSpacing.md,
        ),
        child: _CommitSummary(commit: commit, compact: compact),
      ),
    );
  }
}

/// A graph row in the VS Code style: a **fixed-height, single-line** row so
/// dots align into clean horizontal lanes, with the lane gutter on the left
/// sized to the *full* lane count (the commit text shifts right so the graph
/// is always fully visible — never hidden under the text). Rows are flush so
/// the painted lanes connect continuously down the list.
class _CommitGraphRow extends StatelessWidget {
  const _CommitGraphRow({
    required this.row,
    required this.maxLanes,
    required this.compact,
    required this.onTap,
  });

  final _GraphRow row;
  final int maxLanes;
  final bool compact;
  final VoidCallback onTap;

  /// Width of one lane in logical pixels.
  static const double _laneWidth = 16;

  /// Generous cap so very deep graphs don't eat the whole screen; the gutter
  /// otherwise grows with the real lane count so nothing hides under the text.
  static const int _maxLanes = 12;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final lanes = maxLanes.clamp(1, _maxLanes);
    final gutterWidth = UxnanSpacing.sm + lanes * _laneWidth;
    final rowHeight = compact ? 36.0 : 46.0;
    return InkWell(
      onTap: onTap,
      child: SizedBox(
        height: rowHeight,
        child: Row(
          children: [
            SizedBox(
              width: gutterWidth,
              height: rowHeight,
              child: CustomPaint(
                painter: _GraphPainter(
                  row: row,
                  laneWidth: _laneWidth,
                  leftPad: UxnanSpacing.sm,
                  dotSize: compact ? 7 : 9,
                  palette: _lanePalette(colors),
                  haloColor: colors.surface,
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(right: UxnanSpacing.lg),
                child: Row(
                  children: [
                    if (row.commit.isMerge) ...[
                      Icon(
                        Icons.merge_rounded,
                        size: 14,
                        color: colors.onSurfaceVariant,
                      ),
                      const SizedBox(width: UxnanSpacing.xs),
                    ],
                    // A single, width-capped primary ref chip (+ "+N" when
                    // there are more) so a tip with several refs can't overflow
                    // the row. The full set shows in the list view and detail.
                    if (row.commit.refs.isNotEmpty) ...[
                      Flexible(
                        flex: 0,
                        child: ConstrainedBox(
                          constraints: BoxConstraints(
                            maxWidth: compact ? 100 : 130,
                          ),
                          child: CommitRefChip(
                            refData: _primaryRef(row.commit.refs),
                            dense: true,
                          ),
                        ),
                      ),
                      if (row.commit.refs.length > 1) ...[
                        const SizedBox(width: UxnanSpacing.xs),
                        Text(
                          '+${row.commit.refs.length - 1}',
                          style: textTheme.labelSmall?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ],
                      const SizedBox(width: UxnanSpacing.xs),
                    ],
                    Expanded(
                      child: Text(
                        row.commit.messageTitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: textTheme.bodyMedium,
                      ),
                    ),
                    const SizedBox(width: UxnanSpacing.sm),
                    Text(
                      _relativeDate(row.commit.authorDate),
                      style: textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The commit summary: optional ref chips + merge badge, title, then a single
/// muted meta line (author · short SHA · relative date · ± stats).
class _CommitSummary extends StatelessWidget {
  const _CommitSummary({required this.commit, required this.compact});

  final GitCommit commit;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final stats = commit.stats;
    final titleStyle = (compact ? textTheme.bodyMedium : textTheme.bodyLarge)
        ?.copyWith(fontWeight: FontWeight.w600);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (commit.refs.isNotEmpty || commit.isMerge) ...[
          Wrap(
            spacing: UxnanSpacing.xs,
            runSpacing: UxnanSpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (commit.isMerge) _MergeBadge(label: l10n.gitHistoryMergeBadge),
              for (final ref in commit.refs)
                CommitRefChip(refData: ref, dense: compact),
            ],
          ),
          SizedBox(height: compact ? 2 : UxnanSpacing.xs),
        ],
        Text(
          commit.messageTitle,
          maxLines: compact ? 1 : 2,
          overflow: TextOverflow.ellipsis,
          style: titleStyle,
        ),
        SizedBox(height: compact ? 3 : 5),
        Row(
          children: [
            _ShaBadge(shortSha: commit.shortSha),
            const SizedBox(width: UxnanSpacing.sm),
            Flexible(
              child: Text(
                '${l10n.gitHistoryCommitBy(commit.authorName)} · '
                '${_relativeDate(commit.authorDate)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
            if (stats != null) ...[
              const SizedBox(width: UxnanSpacing.sm),
              if (stats.additions > 0)
                Text(
                  '+${stats.additions}',
                  style: textTheme.bodySmall?.copyWith(
                    color: UxnanColors.gitAdded,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              if (stats.additions > 0 && stats.deletions > 0)
                const SizedBox(width: UxnanSpacing.xs),
              if (stats.deletions > 0)
                Text(
                  '−${stats.deletions}',
                  style: textTheme.bodySmall?.copyWith(
                    color: UxnanColors.gitDeleted,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
            ],
          ],
        ),
      ],
    );
  }
}

/// A subtle monospace badge for a commit's short SHA — a small splash of
/// identity without breaking the clean, card-less list.
class _ShaBadge extends StatelessWidget {
  const _ShaBadge({required this.shortSha});
  final String shortSha;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.xs + 1,
        vertical: 1,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.sm),
      ),
      child: Text(
        shortSha,
        style: UxnanTypography.codeSmall.copyWith(
          color: colors.onSurfaceVariant,
        ),
      ),
    );
  }
}

/// "Merge" badge — a small neutral pill.
class _MergeBadge extends StatelessWidget {
  const _MergeBadge({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: colors.tertiaryContainer,
        borderRadius: const BorderRadius.all(UxnanRadius.sm),
      ),
      child: Text(
        label,
        style: textTheme.labelSmall?.copyWith(
          color: colors.onTertiaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Footer shown when more commits are available: a loader while a page is in
/// flight, otherwise a tappable "Load older commits" affordance (the list also
/// auto-loads as it nears the bottom — this is the explicit fallback).
class _PageFooter extends StatelessWidget {
  const _PageFooter({required this.loading, required this.onLoadMore});
  final bool loading;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.md),
      child: Center(
        child: loading
            ? PolygonLoader(size: 22, color: colors.primary)
            : TextButton.icon(
                onPressed: onLoadMore,
                icon: const Icon(Icons.expand_more_rounded, size: 18),
                label: Text(l10n.gitHistoryLoadMore),
              ),
      ),
    );
  }
}

/// A centered icon + title (+ optional body / action) for the empty and error
/// states. Flat, no card.
class _CenteredState extends StatelessWidget {
  const _CenteredState({
    required this.icon,
    required this.iconColor,
    required this.title,
    this.body,
    this.action,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.xl,
        vertical: UxnanSpacing.xxl,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 56, color: iconColor),
          const SizedBox(height: UxnanSpacing.lg),
          Text(
            title,
            style: textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          if (body != null) ...[
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              body!,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
          ],
          if (action != null) ...[
            const SizedBox(height: UxnanSpacing.lg),
            action!,
          ],
        ],
      ),
    );
  }
}

/// Result of the branch picker — `ref == null` means "back to current HEAD".
class _RefChoice {
  const _RefChoice(this.ref);
  final String? ref;
}

/// A slim banner shown above the list when the history is being viewed from a
/// non-default ref (a branch/tag), with a quick action to return to HEAD.
class _ViewingRefBanner extends StatelessWidget {
  const _ViewingRefBanner({required this.refName, required this.onClear});
  final String refName;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        UxnanSpacing.xs,
      ),
      child: Container(
        padding: const EdgeInsets.only(
          left: UxnanSpacing.md,
          right: UxnanSpacing.xs,
          top: UxnanSpacing.xs,
          bottom: UxnanSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: colors.secondaryContainer,
          borderRadius: const BorderRadius.all(UxnanRadius.lg),
        ),
        child: Row(
          children: [
            Icon(
              Icons.alt_route_rounded,
              size: 16,
              color: colors.onSecondaryContainer,
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Text(
                l10n.gitHistoryViewingRef(refName),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSecondaryContainer,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.close_rounded, size: 18),
              visualDensity: VisualDensity.compact,
              color: colors.onSecondaryContainer,
              tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
              onPressed: onClear,
            ),
          ],
        ),
      ),
    );
  }
}

/// Bottom sheet that lists the current HEAD plus the local and remote branches
/// so the user can view the history from any ref (read-only — no checkout).
class _BranchPickerSheet extends StatelessWidget {
  const _BranchPickerSheet({required this.branches, required this.selectedRef});

  final GitBranchList branches;
  final String? selectedRef;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.7,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.lg,
                0,
                UxnanSpacing.lg,
                UxnanSpacing.sm,
              ),
              child: Text(
                l10n.gitHistoryPickBranchTitle,
                style: textTheme.titleMedium,
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.only(bottom: UxnanSpacing.lg),
                children: [
                  _RefTile(
                    icon: Icons.my_location_rounded,
                    label: l10n.gitHistoryHeadOption,
                    selected: selectedRef == null,
                    onTap: () =>
                        Navigator.of(context).pop(const _RefChoice(null)),
                  ),
                  if (branches.local.isNotEmpty)
                    _SectionLabel(label: l10n.gitHistoryLocalSection),
                  for (final b in branches.local)
                    _RefTile(
                      icon: Icons.call_split_rounded,
                      label: b,
                      trailing: b == branches.current
                          ? Text(
                              'HEAD',
                              style: textTheme.labelSmall?.copyWith(
                                color: colors.onSurfaceVariant,
                              ),
                            )
                          : null,
                      selected: selectedRef == b,
                      onTap: () => Navigator.of(context).pop(_RefChoice(b)),
                    ),
                  if (branches.remote.isNotEmpty)
                    _SectionLabel(label: l10n.gitHistoryRemoteSection),
                  for (final b in branches.remote)
                    _RefTile(
                      icon: Icons.cloud_outlined,
                      label: b,
                      selected: selectedRef == b,
                      onTap: () => Navigator.of(context).pop(_RefChoice(b)),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A muted section header inside the branch picker.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.md,
        UxnanSpacing.lg,
        UxnanSpacing.xs,
      ),
      child: Text(
        label,
        style: textTheme.labelMedium?.copyWith(
          color: colors.onSurfaceVariant,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// A single selectable ref row in the branch picker.
class _RefTile extends StatelessWidget {
  const _RefTile({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return ListTile(
      leading: Icon(
        icon,
        color: selected ? colors.primary : colors.onSurfaceVariant,
      ),
      title: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: textTheme.bodyMedium?.copyWith(
          color: selected ? colors.primary : colors.onSurface,
          fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
        ),
      ),
      trailing: selected
          ? Icon(Icons.check_rounded, color: colors.primary)
          : trailing,
      onTap: onTap,
    );
  }
}

// ---------------------------------------------------------------------------
// Graph model + painter (VS Code-style swimlanes)
// ---------------------------------------------------------------------------

/// One row of the commit graph. [incoming]/[outgoing] hold the SHA each lane
/// routes toward at the top and bottom edge of the row (null = empty lane), so
/// adjacent rows' edges line up and the painted lines connect seamlessly.
/// Colors are a **branch-stable color id** per lane (assigned when a lane is
/// born and carried while it lives) so a branch keeps its color even as it
/// shifts columns — the VS Code behavior.

/// The shape of one drawn edge in a row (see [_GraphEdge]).
enum _EdgeKind { through, mergeIn, inNode, outNode, mergeOut }

/// One drawn edge within a row. Lanes are column indices; the painter maps
/// them to x positions. `through` is a passing lane (vertical, or a gentle
/// left S when it shifts column); `mergeIn` is a converging child arcing into
/// the node; `inNode`/`outNode` are the node's own lane halves; `mergeOut` is
/// the node arcing out to an extra (merge) parent's lane.
class _GraphEdge {
  const _GraphEdge(this.kind, this.fromLane, this.toLane, this.colorId);

  final _EdgeKind kind;
  final int fromLane;
  final int toLane;
  final int colorId;
}

class _GraphRow {
  _GraphRow({
    required this.commit,
    required this.edges,
    required this.nodeLane,
    required this.nodeColor,
    required this.isMerge,
    required this.laneCount,
  });

  final GitCommit commit;
  final List<_GraphEdge> edges;
  final int nodeLane;
  final int nodeColor;
  final bool isMerge;
  final int laneCount;
}

/// A live swimlane: the hash it waits to reach + its branch-stable color id.
class _Lane {
  _Lane(this.id, this.color);
  final String id;
  final int color;
}

/// Walks the commit list newest-first and assigns swimlanes (the VS Code
/// model), carrying lane state forward so each row's inputs equal the previous
/// row's outputs (the key to continuous lines). The leftmost lane waiting for a
/// commit is its node; the first parent continues that lane and color; every
/// *other* lane waiting for it collapses into the node (dropped from the
/// outputs, so lanes to its right shift left — the compaction that makes the
/// graph narrow with flowing curves). Each extra (merge) parent opens a new
/// lane at the right with a fresh color. The per-row [_GraphEdge] list is what
/// the painter strokes.
List<_GraphRow> _buildGraph(List<GitCommit> commits) {
  final rows = <_GraphRow>[];
  var inputs = <_Lane>[];
  var nextColor = 0;

  for (final commit in commits) {
    final inputIndex = inputs.indexWhere((l) => l.id == commit.sha);
    final nodeLane = inputIndex != -1 ? inputIndex : inputs.length;
    final nodeColor = inputIndex != -1 ? inputs[inputIndex].color : nextColor++;

    final outputs = <_Lane>[];
    final edges = <_GraphEdge>[];
    var firstParentAdded = false;

    // Walk input lanes: the node lane continues with the first parent; other
    // lanes waiting for this commit converge in (and drop); the rest pass
    // through (shifting left if earlier lanes collapsed).
    for (var i = 0; i < inputs.length; i++) {
      final lane = inputs[i];
      if (lane.id == commit.sha) {
        if (i == nodeLane) {
          if (commit.parents.isNotEmpty && !firstParentAdded) {
            outputs.add(_Lane(commit.parents[0], nodeColor));
            firstParentAdded = true;
          }
        } else {
          edges.add(_GraphEdge(_EdgeKind.mergeIn, i, nodeLane, lane.color));
        }
        continue;
      }
      final outLane = outputs.length;
      outputs.add(_Lane(lane.id, lane.color));
      edges.add(_GraphEdge(_EdgeKind.through, i, outLane, lane.color));
    }

    // Tip commit (no incoming lane): the first parent still continues the
    // node's lane — append it so it lands at nodeLane (= outputs.length here)
    // and is drawn as the straight out-of-node vertical, never a curve.
    if (!firstParentAdded && commit.parents.isNotEmpty) {
      outputs.add(_Lane(commit.parents[0], nodeColor));
      firstParentAdded = true;
    }

    // Extra (merge) parents — only parents[1..] — open new lanes at the right.
    for (var p = 1; p < commit.parents.length; p++) {
      final colorId = nextColor++;
      final k = outputs.length;
      outputs.add(_Lane(commit.parents[p], colorId));
      edges.add(_GraphEdge(_EdgeKind.mergeOut, nodeLane, k, colorId));
    }

    // The node's own lane: a vertical into the dot from above (if a child was
    // waiting) and out of it toward the first parent (if it has parents).
    if (inputIndex != -1) {
      edges.add(_GraphEdge(_EdgeKind.inNode, nodeLane, nodeLane, nodeColor));
    }
    if (firstParentAdded) {
      edges.add(_GraphEdge(_EdgeKind.outNode, nodeLane, nodeLane, nodeColor));
    }

    final laneCount = [
      inputs.length,
      outputs.length,
      nodeLane + 1,
    ].reduce((a, b) => a > b ? a : b);

    rows.add(
      _GraphRow(
        commit: commit,
        edges: edges,
        nodeLane: nodeLane,
        nodeColor: nodeColor,
        isMerge: commit.parents.length > 1,
        laneCount: laneCount,
      ),
    );
    inputs = outputs;
  }
  return rows;
}

/// Paints one [_GraphRow] in the VS Code style: continuous, branch-colored lane
/// lines with smooth circular-arc connectors (the into/out-of-node bends are a
/// full quarter-circle of radius ≈ one lane; a passing lane that shifts column
/// makes a gentle S), plus the commit node on top. Colors come from the row's
/// stable color ids.
class _GraphPainter extends CustomPainter {
  _GraphPainter({
    required this.row,
    required this.laneWidth,
    required this.leftPad,
    required this.dotSize,
    required this.palette,
    required this.haloColor,
  });

  final _GraphRow row;
  final double laneWidth;
  final double leftPad;
  final double dotSize;
  final List<Color> palette;
  final Color haloColor;

  Color _color(int? colorId) => palette[(colorId ?? 0) % palette.length];
  double _laneX(int lane) => leftPad + lane * laneWidth + laneWidth / 2;

  Paint _stroke(int colorId) => Paint()
    ..color = _color(colorId)
    ..strokeWidth = 2
    ..style = PaintingStyle.stroke
    ..strokeCap = StrokeCap.round;

  @override
  void paint(Canvas canvas, Size size) {
    final h = size.height;
    final mid = h / 2;
    // Quarter-arc radius for node bends (a smooth sweep ≈ one lane); a gentler
    // radius for a passing lane that shifts column.
    final nodeR = laneWidth < mid ? laneWidth : mid;
    const shiftR = 6.0;

    for (final e in row.edges) {
      final x1 = _laneX(e.fromLane);
      final x2 = _laneX(e.toLane);
      final paint = _stroke(e.colorId);
      switch (e.kind) {
        case _EdgeKind.inNode:
          canvas.drawLine(Offset(x1, 0), Offset(x1, mid), paint);
        case _EdgeKind.outNode:
          canvas.drawLine(Offset(x1, mid), Offset(x1, h), paint);
        case _EdgeKind.mergeIn:
          // Down the child lane, a quarter-arc left into mid, then to the node.
          canvas.drawPath(
            Path()
              ..moveTo(x1, 0)
              ..lineTo(x1, mid - nodeR)
              ..arcToPoint(
                Offset(x1 - nodeR, mid),
                radius: Radius.circular(nodeR),
              )
              ..lineTo(x2, mid),
            paint,
          );
        case _EdgeKind.mergeOut:
          // From the node at mid, a quarter-arc right-down into the parent.
          canvas.drawPath(
            Path()
              ..moveTo(x1, mid)
              ..lineTo(x2 - nodeR, mid)
              ..arcToPoint(
                Offset(x2, mid + nodeR),
                radius: Radius.circular(nodeR),
              )
              ..lineTo(x2, h),
            paint,
          );
        case _EdgeKind.through:
          if ((x1 - x2).abs() < 0.5) {
            canvas.drawLine(Offset(x1, 0), Offset(x1, h), paint);
          } else {
            // Compaction always shifts a passing lane LEFT: a symmetric S of
            // two shiftR arcs around the mid-row horizontal.
            canvas.drawPath(
              Path()
                ..moveTo(x1, 0)
                ..lineTo(x1, mid - shiftR)
                ..arcToPoint(
                  Offset(x1 - shiftR, mid),
                  radius: const Radius.circular(shiftR),
                )
                ..lineTo(x2 + shiftR, mid)
                ..arcToPoint(
                  Offset(x2, mid + shiftR),
                  radius: const Radius.circular(shiftR),
                  clockwise: false,
                )
                ..lineTo(x2, h),
              paint,
            );
          }
      }
    }

    // The commit node. Merge commits (2+ parents) get the VS Code treatment: a
    // solid inner dot with a *separate* outer ring (a surface gap between
    // them), so convergence points read distinctly from ordinary commits.
    final center = Offset(_laneX(row.nodeLane), mid);
    final nodeColor = _color(row.nodeColor);
    final r = dotSize / 2;
    final isMerge = row.isMerge;
    final ringR = r + 3;
    // Clear the node area so crossing lines don't muddy the dot/ring.
    canvas.drawCircle(
      center,
      (isMerge ? ringR : r) + 1.6,
      Paint()..color = haloColor,
    );
    if (isMerge) {
      canvas.drawCircle(
        center,
        ringR,
        Paint()
          ..color = nodeColor
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }
    canvas.drawCircle(center, r, Paint()..color = nodeColor);
  }

  @override
  bool shouldRepaint(_GraphPainter old) =>
      old.row != row ||
      old.laneWidth != laneWidth ||
      old.dotSize != dotSize ||
      old.haloColor != haloColor;
}

/// The branch color palette: theme accents first, then fixed git hues. Colors
/// cycle by branch-stable id, so a branch keeps its hue down the graph.
List<Color> _lanePalette(ColorScheme colors) => [
      colors.primary,
      colors.tertiary,
      UxnanColors.gitUntracked,
      colors.secondary,
      UxnanColors.gitAdded,
      UxnanColors.warning,
      UxnanColors.gitDeleted,
    ];

/// Picks the most useful ref to show in the dense graph row: a local branch
/// first, then a tag, then HEAD, then a remote branch.
GitRef _primaryRef(List<GitRef> refs) {
  const order = [
    GitRefType.branch,
    GitRefType.tag,
    GitRefType.head,
    GitRefType.remoteBranch,
  ];
  for (final type in order) {
    for (final ref in refs) {
      if (ref.type == type) return ref;
    }
  }
  return refs.first;
}

/// Compact relative date — "just now", "5m", "2h", "3d", "Mar 4", "2022".
String _relativeDate(DateTime when) {
  final now = DateTime.now();
  final diff = now.difference(when);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inHours < 24) return '${diff.inHours}h';
  if (diff.inDays < 7) return '${diff.inDays}d';
  final sameYear = when.year == now.year;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  final m = months[when.month - 1];
  return sameYear ? '$m ${when.day}' : '$m ${when.day}, ${when.year}';
}
