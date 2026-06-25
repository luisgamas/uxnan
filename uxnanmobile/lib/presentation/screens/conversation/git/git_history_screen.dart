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
///     lanes; lines connect across rows with rounded-step connectors and a
///     branch-stable color per lane; merge nodes get a separate outer ring.
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

  void _openDetails(GitCommit commit) {
    final cwd = widget.cwd;
    if (cwd == null) return;
    GitCommitDetailScreen.push(
      context,
      cwd: cwd,
      sha: commit.sha,
      seed: commit,
    );
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
/// [incomingColors]/[outgoingColors] carry a **branch-stable color id** per
/// lane (assigned when a lane is born and kept while it lives) so a branch
/// keeps its color even as it shifts columns — the VS Code behavior.
class _GraphRow {
  _GraphRow({
    required this.commit,
    required this.incoming,
    required this.outgoing,
    required this.incomingColors,
    required this.outgoingColors,
    required this.commitLane,
    required this.commitColor,
    required this.parentLanes,
  });

  final GitCommit commit;
  final List<String?> incoming;
  final List<String?> outgoing;
  final List<int?> incomingColors;
  final List<int?> outgoingColors;
  final int commitLane;
  final int commitColor;
  final List<int> parentLanes;

  int get laneCount =>
      incoming.length > outgoing.length ? incoming.length : outgoing.length;
}

/// Walks the commit list newest-first and assigns swimlanes, carrying the lane
/// + color state forward so each row's `incoming` equals the previous row's
/// `outgoing` (the key to continuous lines). The first parent continues the
/// commit's lane and color; extra (merge) parents open or reuse lanes to the
/// right, getting a fresh color when a new branch line is born.
List<_GraphRow> _buildGraph(List<GitCommit> commits) {
  final rows = <_GraphRow>[];
  var lanes = <String?>[];
  var colors = <int?>[];
  var nextColor = 0;

  for (final commit in commits) {
    final incoming = List<String?>.from(lanes);
    final incomingColors = List<int?>.from(colors);

    var commitLane = incoming.indexOf(commit.sha);
    int commitColor;
    if (commitLane == -1) {
      final free = incoming.indexOf(null);
      commitLane = free == -1 ? incoming.length : free;
      commitColor = nextColor++; // a brand-new branch tip → new color
    } else {
      commitColor = incomingColors[commitLane] ?? nextColor++;
    }

    final outgoing = List<String?>.from(incoming);
    final outgoingColors = List<int?>.from(incomingColors);
    while (outgoing.length <= commitLane) {
      outgoing.add(null);
      outgoingColors.add(null);
    }
    // Lanes that were waiting for this commit terminate at the dot.
    for (var i = 0; i < outgoing.length; i++) {
      if (outgoing[i] == commit.sha) {
        outgoing[i] = null;
        outgoingColors[i] = null;
      }
    }
    outgoing[commitLane] = null;
    outgoingColors[commitLane] = null;

    final parentLanes = <int>[];
    for (var pi = 0; pi < commit.parents.length; pi++) {
      final parent = commit.parents[pi];
      if (pi == 0) {
        // First parent continues this commit's lane + color.
        outgoing[commitLane] = parent;
        outgoingColors[commitLane] = commitColor;
        parentLanes.add(commitLane);
      } else {
        var lane = outgoing.indexOf(parent);
        if (lane == -1) {
          final free = outgoing.indexOf(null);
          if (free == -1) {
            lane = outgoing.length;
            outgoing.add(parent);
            outgoingColors.add(nextColor++);
          } else {
            lane = free;
            outgoing[free] = parent;
            outgoingColors[free] = nextColor++;
          }
        }
        parentLanes.add(lane);
      }
    }

    rows.add(
      _GraphRow(
        commit: commit,
        incoming: incoming,
        outgoing: outgoing,
        incomingColors: incomingColors,
        outgoingColors: outgoingColors,
        commitLane: commitLane,
        commitColor: commitColor,
        parentLanes: parentLanes,
      ),
    );
    lanes = outgoing;
    colors = outgoingColors;
  }
  return rows;
}

/// Paints one [_GraphRow] in the VS Code style: continuous, branch-colored
/// lane lines (pass-through lanes drawn full-height so they join the rows
/// above and below), child lines into the dot, lines out to each parent, and
/// the commit node on top. Colors come from the row's stable color ids.
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

  Paint _stroke(int? colorId) => Paint()
    ..color = _color(colorId)
    ..strokeWidth = 2
    ..style = PaintingStyle.stroke
    ..strokeCap = StrokeCap.round;

  /// VS Code-style connector: a straight vertical when the columns match,
  /// otherwise vertical → quarter-arc → short horizontal → quarter-arc →
  /// vertical (the crisp rounded "step" at the row midpoint). Assumes
  /// `from.dy <= to.dy` (all connectors run top→down in a row).
  void _connect(Canvas canvas, Paint paint, Offset from, Offset to) {
    if ((from.dx - to.dx).abs() < 0.5) {
      canvas.drawLine(from, to, paint);
      return;
    }
    final dir = to.dx > from.dx ? 1.0 : -1.0;
    final midY = (from.dy + to.dy) / 2;
    final r = [
      5.0,
      (to.dx - from.dx).abs() / 2,
      (to.dy - from.dy).abs() / 2,
    ].reduce((a, b) => a < b ? a : b);
    final path = Path()
      ..moveTo(from.dx, from.dy)
      ..lineTo(from.dx, midY - r)
      ..quadraticBezierTo(from.dx, midY, from.dx + dir * r, midY)
      ..lineTo(to.dx - dir * r, midY)
      ..quadraticBezierTo(to.dx, midY, to.dx, midY + r)
      ..lineTo(to.dx, to.dy);
    canvas.drawPath(path, paint);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final dotY = size.height / 2;
    final h = size.height;
    final centerX = _laneX(row.commitLane);

    // 1. Lines from the top: into the dot (a child of this commit, kept in its
    //    own incoming color) or passing through (full height).
    for (var j = 0; j < row.incoming.length; j++) {
      final occ = row.incoming[j];
      if (occ == null) continue;
      if (occ == row.commit.sha) {
        _connect(
          canvas,
          _stroke(row.incomingColors[j]),
          Offset(_laneX(j), 0),
          Offset(centerX, dotY),
        );
      } else {
        // A pass-through lane continues in its *own* column (lanes are never
        // compacted, so `outgoing[j]` is still this occupant) — draw a straight
        // vertical. Using `outgoing.indexOf(occ)` was wrong: when the same
        // parent occupies two lanes (a commit with multiple children, common
        // around merges) it returned the *first* lane, so the other lane drew a
        // diagonal "hook" every row instead of a clean vertical.
        _connect(
          canvas,
          _stroke(row.incomingColors[j]),
          Offset(_laneX(j), 0),
          Offset(_laneX(j), h),
        );
      }
    }

    // 2. Lines from the dot to each parent at the bottom edge.
    for (final k in row.parentLanes) {
      _connect(
        canvas,
        _stroke(row.outgoingColors[k]),
        Offset(centerX, dotY),
        Offset(_laneX(k), h),
      );
    }

    // 3. The commit node. Merge commits (2+ parents) get the VS Code treatment:
    //    a solid inner dot with a *separate* outer ring (a surface gap between
    //    them), so convergence points read distinctly from ordinary commits.
    final center = Offset(centerX, dotY);
    final nodeColor = _color(row.commitColor);
    final r = dotSize / 2;
    final isMerge = row.commit.parents.length > 1;
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
