import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/git/git_log.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen commit history view for the workspace's git repo. Two views
/// share the same underlying paged data:
///
///   - **List** — newest-first chronological list of commits.
///   - **Graph** — same data rendered as a GitKraken-style graph: each commit
///     occupies a "lane" based on its parents, lines are drawn with bezier
///     curves so branches stay readable.
///
/// Both views back onto the `git/log` JSON-RPC method via
/// `GitActionManager.log(GitLogParams)`. Pagination is cursor-based: each
/// batch fetches 50 commits; "Load older commits" fetches the next page
/// using the previous result's `nextCursor`.
///
/// Built on the Neural Expressive design system (`docs/neural-expressive-design.md`):
///   - `ExpressiveCard` (24 dp outer radius, `spatialFast` press spring) for
///     commit rows (§2.2 / §4.6).
///   - `ConnectedButtonGroup` for the List ↔ Graph toggle (§4.5).
///   - `PolygonLoader` for the initial-load spinner (§4.7).
///   - `UxnanSpacing` + `UxnanRadius` tokens throughout.
class GitHistoryScreen extends ConsumerStatefulWidget {
  /// Creates a [GitHistoryScreen].
  const GitHistoryScreen({this.cwd, this.ref, super.key});

  /// Workspace directory whose history is shown. Null disables loading.
  final String? cwd;

  /// Optional ref (branch / tag / remote) to start the log from. Defaults to
  /// HEAD on the bridge.
  final String? ref;

  /// Pushes the screen onto the navigator.
  static Future<void> push(
    BuildContext context, {
    String? cwd,
    String? ref,
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => GitHistoryScreen(cwd: cwd, ref: ref),
      ),
    );
  }

  @override
  ConsumerState<GitHistoryScreen> createState() => _GitHistoryScreenState();
}

/// Which sub-view is currently rendered.
enum _HistoryView { list, graph }

class _GitHistoryScreenState extends ConsumerState<GitHistoryScreen> {
  /// Currently-loaded commits, oldest at the bottom. Never mutated in place
  /// — we only ever replace the list when a page arrives.
  List<GitCommit> _commits = const [];

  /// SHA to pass as the next `cursor`. `null` once `hasMore` is false.
  String? _nextCursor;

  /// True when more commits are available past the last fetched page.
  bool _hasMore = false;

  /// True on the initial load (skeleton / spinner).
  bool _initialLoading = true;

  /// True when the user pressed *Load older* and a page is in flight.
  bool _pageLoading = false;

  /// True when the user pulled to refresh or hit retry.
  bool _refreshLoading = false;

  /// Last error message; null when no error. Surfaced as an inline state.
  Object? _error;

  /// Which sub-view the user picked last.
  _HistoryView _view = _HistoryView.list;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadFirstPage());
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
      final result = await ref.read(gitActionManagerProvider).log(
            GitLogParams(cwd: cwd, limit: 50, ref: widget.ref),
          );
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
      final result = await ref.read(gitActionManagerProvider).log(
            GitLogParams(cwd: cwd, limit: 50, ref: widget.ref),
          );
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
    setState(() {
      _pageLoading = true;
      _error = null;
    });
    try {
      final result = await ref.read(gitActionManagerProvider).log(
            GitLogParams(cwd: cwd, limit: 50, cursor: cursor),
          );
      if (!mounted) return;
      setState(() {
        // Replace the local cache: cursor pagination always returns strictly
        // older commits, so concatenation is safe.
        _commits = [..._commits, ...result.commits];
        _hasMore = result.hasMore;
        _nextCursor = result.nextCursor;
        _pageLoading = false;
      });
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _pageLoading = false;
        _error = e;
      });
    }
  }

  /// Pull-to-refresh handler: refreshes the first page (newest commits).
  Future<void> _pullToRefresh() => _refresh();

  void _openDetails(GitCommit commit) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Theme.of(context).colorScheme.surfaceContainerHigh,
      builder: (_) => _CommitDetailsSheet(commit: commit),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    Widget sliver;
    if (_initialLoading) {
      sliver = SliverFillRemaining(
        hasScrollBody: false,
        child: Center(child: PolygonLoader(size: 48, color: colors.primary)),
      );
    } else if (_error != null && _commits.isEmpty) {
      sliver = SliverFillRemaining(
        hasScrollBody: false,
        child: _ErrorState(
          title: l10n.gitHistoryErrorTitle,
          retryLabel: l10n.gitHistoryRetry,
          onRetry: _loadFirstPage,
        ),
      );
    } else if (_commits.isEmpty) {
      sliver = SliverFillRemaining(
        hasScrollBody: false,
        child: _EmptyState(
          title: l10n.gitHistoryEmpty,
          body: l10n.gitHistoryEmptyBody,
        ),
      );
    } else {
      switch (_view) {
        case _HistoryView.list:
          sliver = SliverList.builder(
            itemCount: _commits.length + (_hasMore ? 1 : 0),
            itemBuilder: (context, index) {
              if (index >= _commits.length) {
                return _LoadMoreTile(
                  loading: _pageLoading,
                  label: _pageLoading
                      ? l10n.gitHistoryLoadingMore
                      : l10n.gitHistoryLoadMore,
                  onTap: _loadMore,
                );
              }
              final commit = _commits[index];
              return Padding(
                padding: const EdgeInsets.only(bottom: UxnanSpacing.xs),
                child: _CommitListTile(
                  commit: commit,
                  onTap: () => _openDetails(commit),
                ),
              );
            },
          );
        case _HistoryView.graph:
          final lanes = _assignLanes(_commits);
          sliver = SliverList.builder(
            itemCount: lanes.length + (_hasMore ? 1 : 0),
            itemBuilder: (context, index) {
              if (index >= lanes.length) {
                return _LoadMoreTile(
                  loading: _pageLoading,
                  label: _pageLoading
                      ? l10n.gitHistoryLoadingMore
                      : l10n.gitHistoryLoadMore,
                  onTap: _loadMore,
                );
              }
              final entry = lanes[index];
              final next = index + 1 < lanes.length ? lanes[index + 1] : null;
              return Padding(
                padding: const EdgeInsets.only(bottom: UxnanSpacing.xs),
                child: _CommitGraphRow(
                  entry: entry,
                  nextEntry: next,
                  hasMoreBelow: next == null && _hasMore,
                  onTap: () => _openDetails(entry.commit),
                ),
              );
            },
          );
      }
    }

    return NeScaffold(
      title: l10n.gitHistoryTitle,
      onRefresh: _initialLoading ? null : _pullToRefresh,
      slivers: [
        if (!_initialLoading && _commits.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.lg,
                UxnanSpacing.xs,
                UxnanSpacing.lg,
                UxnanSpacing.md,
              ),
              child: _ViewToggle(
                view: _view,
                onChanged: (v) => setState(() => _view = v),
              ),
            ),
          ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.xs,
            UxnanSpacing.lg,
            UxnanSpacing.lg,
          ),
          sliver: sliver,
        ),
      ],
    );
  }
}

/// Connected Button Group that toggles between the list and graph views.
/// Lives above the commits list when at least one commit is loaded.
class _ViewToggle extends StatelessWidget {
  /// Creates a [_ViewToggle].
  const _ViewToggle({required this.view, required this.onChanged});

  /// Currently selected view.
  final _HistoryView view;

  /// Tap handler — receives the new selected value.
  final ValueChanged<_HistoryView> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ConnectedButtonGroup<_HistoryView>(
      values: _HistoryView.values,
      selected: view,
      onChanged: onChanged,
      labelBuilder: (v, selected) => Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            v == _HistoryView.list
                ? Icons.view_list_rounded
                : Icons.account_tree_rounded,
          ),
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            v == _HistoryView.list
                ? l10n.gitHistoryListView
                : l10n.gitHistoryGraphView,
          ),
        ],
      ),
    );
  }
}

/// A flat list row — title, author + relative date, optional merge badge and
/// stats summary. Uses [ExpressiveCard] so the press feedback matches the
/// rest of the app (24 dp outer radius + `spatialFast` scale spring).
class _CommitListTile extends StatelessWidget {
  /// Creates a [_CommitListTile].
  const _CommitListTile({required this.commit, required this.onTap});

  /// Commit being rendered.
  final GitCommit commit;

  /// Tap handler — opens the details bottom sheet.
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final stats = commit.stats;
    return ExpressiveCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (commit.isMerge) ...[
                _MergeBadge(label: l10n.gitHistoryMergeBadge),
                const SizedBox(width: UxnanSpacing.sm),
              ],
              Expanded(
                child: Text(
                  commit.messageTitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.xs),
          Row(
            children: [
              Flexible(
                child: Text(
                  l10n.gitHistoryCommitBy(commit.authorName),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ),
              Text(
                ' · ',
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
              Text(
                _relativeDate(commit.authorDate),
                maxLines: 1,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
              if (stats != null) ...[
                const Spacer(),
                Text(
                  '+${stats.additions}  -${stats.deletions}',
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ],
          ),
          if (commit.shortSha.isNotEmpty) ...[
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              commit.shortSha,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
                fontFamily: 'monospace',
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A single graph row: a left-side graph lane (lanes, circle, edges) and a
/// right-side commit summary (title, author, short SHA, stats). The lane
/// width is fixed so all rows align. Renders bezier curves for merge parents
/// and parent branches.
class _CommitGraphRow extends StatelessWidget {
  /// Creates a [_CommitGraphRow].
  const _CommitGraphRow({
    required this.entry,
    required this.nextEntry,
    required this.hasMoreBelow,
    required this.onTap,
  });

  /// The row being rendered.
  final _LaneAssignment entry;

  /// The row directly below this one (for line connections). Null when this
  /// is the bottom-most rendered row.
  final _LaneAssignment? nextEntry;

  /// True when there's a *Load older* row below (so the outgoing line drops
  /// off the visible area instead of stopping at the next commit).
  final bool hasMoreBelow;

  /// Tap handler — opens the details bottom sheet.
  final VoidCallback onTap;

  /// Width in logical pixels of one graph lane.
  static const double _laneWidth = UxnanSpacing.md + UxnanSpacing.xs;

  /// Width of the commit circle / dot.
  static const double _dotSize = UxnanSpacing.md;

  /// Row height — enough to fit the circle + a short tail.
  static const double _rowHeight = 64;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final lanes = entry.totalLanes;
    final graphWidth = lanes * _laneWidth;
    final stats = entry.commit.stats;
    return ExpressiveCard(
      onTap: onTap,
      padding: EdgeInsets.zero,
      child: Row(
        children: [
          SizedBox(
            width: graphWidth + _laneWidth,
            height: _rowHeight,
            child: CustomPaint(
              painter: _GraphPainter(
                lane: entry.lane,
                totalLanes: lanes,
                laneWidth: _laneWidth,
                dotSize: _dotSize,
                color: colors.primary,
                trackColor: colors.outlineVariant,
                parentLanes: entry.parentLanes,
                nextLane: nextEntry?.lane,
                parentsContinue:
                    nextEntry?.continuesFrom == entry.commit.sha,
                hasMoreBelow: hasMoreBelow,
              ),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.sm,
                UxnanSpacing.sm,
                UxnanSpacing.lg,
                UxnanSpacing.sm,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (entry.commit.isMerge) ...[
                        _MergeBadge(label: l10n.gitHistoryMergeBadge),
                        const SizedBox(width: UxnanSpacing.sm),
                      ],
                      Expanded(
                        child: Text(
                          entry.commit.messageTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: UxnanSpacing.xs),
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          '${l10n.gitHistoryCommitBy(
                            entry.commit.authorName,
                          )}'
                          ' · ${entry.commit.shortSha}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: textTheme.bodySmall?.copyWith(
                            color: colors.onSurfaceVariant,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ),
                      if (stats != null) ...[
                        const Spacer(),
                        Text(
                          '+${stats.additions}  -${stats.deletions}',
                          style: textTheme.bodySmall?.copyWith(
                            color: colors.onSurfaceVariant,
                            fontFeatures: const [
                              FontFeature.tabularFigures(),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// "Merge" badge — small pill in `tertiaryContainer` with `labelMedium` text.
class _MergeBadge extends StatelessWidget {
  /// Creates a [_MergeBadge].
  const _MergeBadge({required this.label});

  /// Badge label.
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: UxnanSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: colors.tertiaryContainer,
        borderRadius: const BorderRadius.all(UxnanRadius.md),
      ),
      child: Text(
        label,
        style: textTheme.labelMedium?.copyWith(
          color: colors.onTertiaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Paints the left-side graph for a [_CommitGraphRow].
///
///   - A vertical track for every lane (so unfilled lanes stay subtle).
///   - A solid filled circle at `lane` for the current commit.
///   - A vertical line dropping from the circle to the next row, if the next
///     row's first parent is the current commit (so the lane continues).
///   - Bezier curves from the circle to each lane of any *other* parent (merge
///     parents, off-screen parents).
class _GraphPainter extends CustomPainter {
  /// Creates a [_GraphPainter].
  const _GraphPainter({
    required this.lane,
    required this.totalLanes,
    required this.laneWidth,
    required this.dotSize,
    required this.color,
    required this.trackColor,
    required this.parentLanes,
    required this.nextLane,
    required this.parentsContinue,
    required this.hasMoreBelow,
  });

  /// The lane (column) this commit occupies. Zero-indexed.
  final int lane;

  /// Total number of lanes in the rendered window — drives the canvas width.
  final int totalLanes;

  /// Width of a single lane in logical pixels.
  final double laneWidth;

  /// Diameter of the circle drawn at the commit.
  final double dotSize;

  /// Color of the commit circle and lines.
  final Color color;

  /// Color of the "empty" lane track (drawn behind the circle so unfilled
  /// lanes are still visible).
  final Color trackColor;

  /// Lanes of every parent commit of this row, in order:
  ///   - `parentLanes[0]` is the first parent. It always continues this lane
  ///     (the next row at the same column holds it).
  ///   - `parentLanes[1..]` are additional parents. They branch off, drawn as
  ///     bezier curves to the right of the current lane.
  final List<int> parentLanes;

  /// Lane of the next row (the commit rendered directly below), or null if
  /// this is the last rendered row.
  final int? nextLane;

  /// True when the next row continues from this commit (its `continuesFrom`
  /// is the current commit's SHA). Drives whether the outgoing line goes
  /// straight down or bends.
  final bool parentsContinue;

  /// True when the next visible row is the *Load older* footer. The outgoing
  /// line drops off-screen instead of stopping at the next lane.
  final bool hasMoreBelow;

  @override
  void paint(Canvas canvas, Size size) {
    final trackPaint = Paint()
      ..color = trackColor
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    final linePaint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;

    // 1. Subtle vertical track behind every lane.
    for (var i = 0; i < totalLanes; i++) {
      final x = i * laneWidth + laneWidth / 2;
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), trackPaint);
    }

    final centerX = lane * laneWidth + laneWidth / 2;

    // 2. Outgoing lines from the circle (downward).
    if (parentsContinue && !hasMoreBelow && nextLane == lane) {
      // Straight line down (lane continues).
      canvas.drawLine(
        Offset(centerX, size.height / 2 + dotSize / 2),
        Offset(centerX, size.height),
        linePaint,
      );
    } else if (parentsContinue &&
        !hasMoreBelow &&
        nextLane != null &&
        nextLane != lane) {
      // First parent continues in a *different* lane (this commit has a child
      // at lane != current). Bezier curve from current circle to next lane.
      final nextX = nextLane! * laneWidth + laneWidth / 2;
      _drawBezier(
        canvas,
        linePaint,
        Offset(centerX, size.height / 2 + dotSize / 2),
        Offset(nextX, size.height),
      );
    } else if (parentsContinue && hasMoreBelow) {
      // Lane continues off-screen — drop straight down to the bottom.
      canvas.drawLine(
        Offset(centerX, size.height / 2 + dotSize / 2),
        Offset(centerX, size.height),
        linePaint,
      );
    }

    // 3. Branch curves to additional (non-first) parents.
    for (var i = 1; i < parentLanes.length; i++) {
      final parentLane = parentLanes[i];
      final parentX = parentLane * laneWidth + laneWidth / 2;
      // Curve bends right from the current circle into the parent lane.
      final midX = (centerX + parentX) / 2;
      final path = Path()
        ..moveTo(centerX, size.height / 2)
        ..cubicTo(
          centerX,
          size.height * 0.75,
          midX,
          size.height * 0.75,
          parentX,
          size.height,
        );
      canvas.drawPath(path, linePaint);
    }

    // 4. The commit circle itself. We draw the stroke + fill in two passes
    //    so the circle stays visible even when the lane continues through it.
    final center = Offset(centerX, size.height / 2);
    final ringPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    final dotPaint = Paint()..color = color;
    canvas
      ..drawCircle(center, dotSize / 2, ringPaint)
      ..drawCircle(center, dotSize / 2 - 1, dotPaint);
  }

  void _drawBezier(Canvas canvas, Paint paint, Offset from, Offset to) {
    final midY = (from.dy + to.dy) / 2;
    final path = Path()
      ..moveTo(from.dx, from.dy)
      ..cubicTo(from.dx, midY, to.dx, midY, to.dx, to.dy);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(_GraphPainter old) {
    return old.lane != lane ||
        old.totalLanes != totalLanes ||
        old.parentLanes.length != parentLanes.length ||
        old.nextLane != nextLane ||
        old.parentsContinue != parentsContinue ||
        old.hasMoreBelow != hasMoreBelow ||
        old.color != color;
  }
}

/// Footer tile for *Load older commits*. Plain button, no row chrome.
class _LoadMoreTile extends StatelessWidget {
  /// Creates a [_LoadMoreTile].
  const _LoadMoreTile({
    required this.loading,
    required this.label,
    required this.onTap,
  });

  /// True when a page is in flight.
  final bool loading;

  /// Button label.
  final String label;

  /// Tap handler.
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
      child: Center(
        child: loading
            ? PolygonLoader(size: 20, color: colors.primary)
            : TextButton.icon(
                onPressed: onTap,
                icon: const Icon(Icons.expand_more_rounded),
                label: Text(label),
                style: TextButton.styleFrom(
                  foregroundColor: colors.primary,
                  textStyle: textTheme.labelLarge,
                ),
              ),
      ),
    );
  }
}

/// Empty state used when the loaded list is empty (fresh repo).
class _EmptyState extends StatelessWidget {
  /// Creates an [_EmptyState].
  const _EmptyState({required this.title, required this.body});

  /// Headline.
  final String title;

  /// Supporting body.
  final String body;

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
          Icon(
            Icons.history_toggle_off_rounded,
            size: 56,
            color: colors.onSurfaceVariant,
          ),
          const SizedBox(height: UxnanSpacing.lg),
          Text(
            title,
            style: textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: UxnanSpacing.sm),
          Text(
            body,
            style: textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

/// Error state with a retry button.
class _ErrorState extends StatelessWidget {
  /// Creates an [_ErrorState].
  const _ErrorState({
    required this.title,
    required this.retryLabel,
    required this.onRetry,
  });

  /// Headline.
  final String title;

  /// Retry button label.
  final String retryLabel;

  /// Retry handler.
  final VoidCallback onRetry;

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
          Icon(
            Icons.error_outline_rounded,
            size: 56,
            color: colors.error,
          ),
          const SizedBox(height: UxnanSpacing.lg),
          Text(
            title,
            style: textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: UxnanSpacing.lg),
          FilledButton.tonal(
            onPressed: onRetry,
            child: Text(retryLabel),
          ),
        ],
      ),
    );
  }
}

/// Bottom sheet showing the full commit message, parents, stats, and
/// copy-SHA / copy-message actions.
class _CommitDetailsSheet extends StatelessWidget {
  /// Creates a [_CommitDetailsSheet].
  const _CommitDetailsSheet({required this.commit});

  /// Commit being shown.
  final GitCommit commit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final stats = commit.stats;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          MediaQuery.of(context).viewInsets.bottom + UxnanSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.gitHistoryDetailsTitle,
              style: textTheme.labelMedium?.copyWith(
                color: colors.onSurfaceVariant,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.4,
              ),
            ),
            const SizedBox(height: UxnanSpacing.xs),
            SelectableText(
              commit.messageTitle,
              style: textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            if (commit.messageBody.trim().isNotEmpty) ...[
              const SizedBox(height: UxnanSpacing.lg),
              Text(
                l10n.gitHistoryDetailsMessage,
                style: textTheme.labelMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: UxnanSpacing.xs),
              SelectableText(
                commit.messageBody.trim(),
                style: textTheme.bodyMedium,
              ),
            ],
            const SizedBox(height: UxnanSpacing.lg),
            _DetailRow(
              label: l10n.gitHistoryDetailsAuthor,
              value: '${commit.authorName} <${commit.authorEmail}>',
            ),
            _DetailRow(
              label: l10n.gitHistoryDetailsDate,
              value: _fullDate(commit.authorDate),
            ),
            if (commit.committerName != commit.authorName ||
                commit.committerEmail != commit.authorEmail)
              _DetailRow(
                label: l10n.gitHistoryDetailsCommitter,
                value:
                    '${commit.committerName} <${commit.committerEmail}>',
              ),
            const SizedBox(height: UxnanSpacing.md),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: UxnanSpacing.md,
                vertical: UxnanSpacing.sm,
              ),
              decoration: BoxDecoration(
                color: colors.surfaceContainerHighest,
                borderRadius: const BorderRadius.all(UxnanRadius.md),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      commit.sha,
                      style: textTheme.bodySmall?.copyWith(
                        fontFamily: 'monospace',
                        color: colors.onSurfaceVariant,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.gitHistoryCopySha,
                    icon: const Icon(
                      Icons.content_copy_rounded,
                      size: 18,
                    ),
                    onPressed: () => _copy(
                      context,
                      commit.sha,
                      l10n.gitHistoryCopiedSha,
                    ),
                  ),
                ],
              ),
            ),
            if (commit.parents.isNotEmpty) ...[
              const SizedBox(height: UxnanSpacing.md),
              Text(
                l10n.gitHistoryDetailsParents(commit.parents.length),
                style: textTheme.labelMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: UxnanSpacing.xs),
              Wrap(
                spacing: UxnanSpacing.xs,
                runSpacing: UxnanSpacing.xs,
                children: [
                  for (final parent in commit.parents)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: UxnanSpacing.sm + UxnanSpacing.xs / 2,
                        vertical: UxnanSpacing.xs,
                      ),
                      decoration: BoxDecoration(
                        color: colors.surfaceContainerHighest,
                        borderRadius: const BorderRadius.all(UxnanRadius.md),
                      ),
                      child: Text(
                        parent.substring(
                          0,
                          parent.length < 7 ? parent.length : 7,
                        ),
                        style: textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                ],
              ),
            ],
            if (stats != null) ...[
              const SizedBox(height: UxnanSpacing.lg),
              Text(
                l10n.gitHistoryDetailsStats,
                style: textTheme.labelMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: UxnanSpacing.xs),
              Text(
                l10n.gitHistoryFilesTouched(
                  stats.additions,
                  stats.deletions,
                  stats.changedFileCount,
                ),
                style: textTheme.bodyMedium,
              ),
            ],
            const SizedBox(height: UxnanSpacing.lg),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _copy(
                      context,
                      '${commit.messageTitle}\n\n${commit.messageBody}',
                      l10n.gitHistoryCopiedMessage,
                    ),
                    icon: const Icon(
                      Icons.copy_all_rounded,
                      size: 18,
                    ),
                    label: Text(l10n.gitHistoryCopyMessage),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _copy(BuildContext context, String text, String toastLabel) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(toastLabel),
          duration: const Duration(seconds: 2),
        ),
      );
  }
}

/// A two-column label / value row used in the commit details sheet.
class _DetailRow extends StatelessWidget {
  /// Creates a [_DetailRow].
  const _DetailRow({required this.label, required this.value});

  /// Left-hand label.
  final String label;

  /// Right-hand value.
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: textTheme.labelMedium?.copyWith(
                color: colors.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}

/// Lane assignment for a single commit.
class _LaneAssignment {
  /// Creates a [_LaneAssignment].
  const _LaneAssignment({
    required this.commit,
    required this.lane,
    required this.totalLanes,
    required this.parentLanes,
    required this.continuesFrom,
  });

  /// Commit being placed.
  final GitCommit commit;

  /// The lane this commit occupies.
  final int lane;

  /// Total lane count in the rendered window.
  final int totalLanes;

  /// Lanes of every parent of this commit, in order. The first entry is the
  /// first parent (which continues this lane); later entries are the merge
  /// parents (which branch off).
  final List<int> parentLanes;

  /// SHA of the commit that *continues into* this commit (i.e., the previous
  /// commit on the timeline whose first parent is this commit's SHA). Null
  /// when this commit started a new lane (its previous sibling wasn't a
  /// direct parent).
  final String? continuesFrom;
}

/// Walks the commit list newest-first and assigns each commit a lane. Uses a
/// simple lane-tracker: for each commit, find the lane that's expecting it
/// (i.e., a lane whose current "expected SHA" equals this commit), or open a
/// new lane if none. After placement, the lane's "expected SHA" becomes this
/// commit's first parent (so the lane continues to it). Merge parents spawn
/// fresh lanes.
///
/// This produces the canonical GitKraken / gitui graph: linear history stays
/// in one lane, branch points fan out, merges pull two lanes back into one.
List<_LaneAssignment> _assignLanes(List<GitCommit> commits) {
  // expectedShaForLane[i] is the SHA the lane i will accept next. Null means
  // the lane is free.
  final expectedShaForLane = <String?>[];
  final bySha = {for (final c in commits) c.sha: c};
  final assignments = <_LaneAssignment>[];

  int findOrCreateLane(String sha) {
    final existing = expectedShaForLane.indexOf(sha);
    if (existing >= 0) return existing;
    final free = expectedShaForLane.indexOf(null);
    if (free >= 0) {
      expectedShaForLane[free] = sha;
      return free;
    }
    expectedShaForLane.add(sha);
    return expectedShaForLane.length - 1;
  }

  int? findLaneFor(String sha) {
    final existing = expectedShaForLane.indexOf(sha);
    return existing >= 0 ? existing : null;
  }

  for (final commit in commits) {
    final contLaneIdx = findLaneFor(commit.sha);
    String? continuesFrom;
    if (contLaneIdx != null) {
      expectedShaForLane[contLaneIdx] = null;
      continuesFrom = _findContinuation(assignments, contLaneIdx, commit.sha);
    }

    final lane = contLaneIdx ?? findOrCreateLane(commit.sha);
    expectedShaForLane[lane] = null;

    final parentLanes = <int>[];
    for (final parentSha in commit.parents) {
      if (bySha.containsKey(parentSha)) {
        final pl = findOrCreateLane(parentSha);
        parentLanes.add(pl);
      } else {
        expectedShaForLane.add(parentSha);
        parentLanes.add(expectedShaForLane.length - 1);
      }
    }

    assignments.add(
      _LaneAssignment(
        commit: commit,
        lane: lane,
        totalLanes: 0, // patched up below
        parentLanes: parentLanes,
        continuesFrom: continuesFrom,
      ),
    );
  }

  final totalLanes = expectedShaForLane.length;
  return [
    for (final a in assignments)
      _LaneAssignment(
        commit: a.commit,
        lane: a.lane,
        totalLanes: totalLanes,
        parentLanes: a.parentLanes,
        continuesFrom: a.continuesFrom,
      ),
  ];
}

/// Walk back through the existing assignments and find the SHA that was sitting
/// in `lane` right before the current commit took it over (i.e., the commit
/// whose first parent is `currentSha`).
String? _findContinuation(
  List<_LaneAssignment> assignments,
  int lane,
  String currentSha,
) {
  for (var i = assignments.length - 1; i >= 0; i--) {
    final a = assignments[i];
    if (a.lane != lane) continue;
    if (a.commit.parents.isNotEmpty && a.commit.parents.first == currentSha) {
      return a.commit.sha;
    }
    return null;
  }
  return null;
}

/// Compact relative date — "just now", "5 min ago", "2 h", "Mar 4", "2022".
String _relativeDate(DateTime when) {
  final now = DateTime.now();
  final diff = now.difference(when);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inHours < 24) return '${diff.inHours}h';
  if (diff.inDays < 7) return '${diff.inDays}d';
  final sameYear = when.year == now.year;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  final m = months[when.month - 1];
  return sameYear ? '$m ${when.day}' : '$m ${when.day}, ${when.year}';
}

/// Full date for the details sheet: "2024-03-04 12:34:56".
String _fullDate(DateTime when) {
  String two(int v) => v.toString().padLeft(2, '0');
  return '${when.year}-${two(when.month)}-${two(when.day)} '
      '${two(when.hour)}:${two(when.minute)}';
}
