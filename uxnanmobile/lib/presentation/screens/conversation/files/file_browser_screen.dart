import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_viewer_screen.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/file_tree_tile.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen workspace file browser for the active thread's `cwd`.
///
/// Lists every file/folder (incl. hidden dotfiles when enabled) with the
/// git-aware color treatment: tracked-but-unchanged files are neutral,
/// modified/added/deleted/renamed/untracked each get a distinct color, and
/// the file name is the painted surface. Tapping a directory toggles its
/// expansion; tapping a file opens the file viewer.
///
/// Mirrors the chrome of the rest of the app: a Neural Expressive top bar
/// (back, title, refresh, show-extensions toggle, show-hidden toggle)
/// sitting over a `BouncingScrollPhysics` content surface, with a
/// persistent bottom bar carrying the workspace path + git branch + a
/// copy-path action.
class FileBrowserScreen extends ConsumerStatefulWidget {
  /// Creates a [FileBrowserScreen].
  const FileBrowserScreen({required this.cwd, this.threadId, super.key});

  /// The workspace directory the browser lists (a thread's `cwd`).
  final String cwd;

  /// Optional owning thread (for context — currently unused beyond the deep
  /// link back to the conversation).
  final String? threadId;

  /// Pushes the screen onto the navigator.
  static Future<void> push(
    BuildContext context, {
    required String cwd,
    String? threadId,
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileBrowserScreen(cwd: cwd, threadId: threadId),
      ),
    );
  }

  @override
  ConsumerState<FileBrowserScreen> createState() => _FileBrowserScreenState();
}

class _FileBrowserScreenState extends ConsumerState<FileBrowserScreen> {
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _revealedFileKey = GlobalKey();
  String? _revealedFilePath;

  @override
  void initState() {
    super.initState();
    // Kick the lazy load. The stream updates the screen as the tree is
    // populated and as the user expands directories.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(fileBrowserManagerProvider).loadRoot(widget.cwd);
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _openSearchResult(
    FileSearchMatch match,
    SearchController searchController,
  ) async {
    final manager = ref.read(fileBrowserManagerProvider);
    await manager.revealFile(widget.cwd, match.path);
    if (!mounted) return;

    setState(() => _revealedFilePath = match.path);
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;

    final root = manager.rootFor(widget.cwd);
    if (root != null && _scrollController.hasClients) {
      final showHidden = ref.read(showHiddenFilesProvider);
      final tiles = <_TileEntry>[];
      _walk(root, 0, showHidden: showHidden, into: tiles);
      final index = tiles.indexWhere((entry) => entry.node.path == match.path);
      if (index >= 0 && tiles.length > 1) {
        // SliverList builds lazily, so first jump near the result to mount it.
        // Search still covers the tree at this point, making the repositioning
        // imperceptible. ensureVisible below then performs the exact alignment.
        final position = _scrollController.position;
        final estimatedOffset =
            position.maxScrollExtent * index / (tiles.length - 1);
        position.jumpTo(
          estimatedOffset.clamp(
            position.minScrollExtent,
            position.maxScrollExtent,
          ),
        );
        await WidgetsBinding.instance.endOfFrame;
      }
    }

    if (!mounted) return;
    final revealedContext = _revealedFileKey.currentContext;
    if (revealedContext != null && revealedContext.mounted) {
      await Scrollable.ensureVisible(revealedContext, alignment: 0.45);
    }
    if (!mounted) return;

    searchController.closeView(_basename(match.path));
    await FileViewerScreen.push(
      context,
      cwd: widget.cwd,
      path: match.path,
      node: FileTreeNode(
        name: _basename(match.path),
        path: match.path,
        type: match.type,
      ),
    );
    if (mounted) FocusManager.instance.primaryFocus?.unfocus();
  }

  /// Pull-to-refresh handler: re-issues the root load so the tree rebuilds
  /// with any out-of-band changes (a write from the file viewer, a git
  /// commit, a CLI edit). Matches the gesture on the threads list.
  Future<void> _refresh() async {
    await ref.read(fileBrowserManagerProvider).loadRoot(widget.cwd);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final showExtension = ref.watch(showFileExtensionsProvider);
    final showHidden = ref.watch(showHiddenFilesProvider);
    final showDetails = ref.watch(showFileDetailsProvider);
    final compact = ref.watch(compactFileRowsProvider);
    // The stream-based tree is the canonical state: the manager owns the
    // mutation, the UI just renders whatever was last emitted.
    final rootAsync = ref.watch(_fileTreeStreamProvider(widget.cwd));
    // Whether any directory is currently expanded — gates the collapse-all
    // action so it only appears when there's something to collapse.
    final anyExpanded = _anyExpanded(rootAsync.value);

    return Scaffold(
      // The browser has no text input of its own — the persistent path bar at
      // the bottom is read-only chrome, not a composer. If a stray soft
      // keyboard lingers (e.g. when returning from the file viewer), it must
      // NOT shove the path bar upward as if it were an input. Pinning the body
      // (no bottom-inset resize) keeps the path bar anchored; we also drop
      // focus when returning from the viewer so the keyboard dismisses.
      resizeToAvoidBottomInset: false,
      body: Stack(
        // StackFit.expand keeps the bar at the full row width — the
        // default loose fit sizes the stack to its non-Positioned child
        // (the file tree) which reports a narrow intrinsic width and
        // starves the NeTopBar's actions row of horizontal space,
        // triggering a RenderFlex overflow in the bar's Row.
        fit: StackFit.expand,
        children: [
          Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    // The content surface — the actual scroll view, the
                    // error state, or the loading spinner, depending on the
                    // stream's current state.
                    Positioned.fill(
                      child: rootAsync.when(
                        data: (FileTreeNode? root) => _buildList(
                          context,
                          root,
                          showExtension: showExtension,
                          showHidden: showHidden,
                          showDetails: showDetails,
                          compact: compact,
                        ),
                        loading: () => const Center(
                          child: PolygonLoader(size: UxnanSpacing.xxl),
                        ),
                        error: (Object error, StackTrace _) =>
                            _ErrorBody(message: '$error'),
                      ),
                    ),
                    // Bottom scroll veil mirroring the top bar's: the last
                    // rows fade into the surface just above the status bar.
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: IgnorePointer(
                        child: Container(
                          height: UxnanSpacing.xl,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                colors.surface.withValues(alpha: 0),
                                colors.surface,
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              _StatusBar(cwd: widget.cwd),
            ],
          ),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: NeTopBar(
              leading: IconSurface(
                icon: Icons.arrow_back_rounded,
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => Navigator.of(context).maybePop(),
              ),
              title: Text(
                l10n.fileBrowserTitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontSize: 20),
              ),
              actions: [
                _FileSearchAnchor(cwd: widget.cwd, onSelect: _openSearchResult),
                // Collapse-all: only shown when at least one directory is
                // expanded, so the bar stays clean on a fresh (flat) listing.
                if (anyExpanded)
                  IconSurface(
                    icon: Icons.unfold_less_rounded,
                    tooltip: l10n.fileBrowserCollapseAll,
                    onPressed: () => ref
                        .read(fileBrowserManagerProvider)
                        .collapseAll(widget.cwd),
                  ),
                // The view toggles (extensions, hidden files) live in a popup
                // menu on the right so the bar stays under the M3 ≤3-actions
                // guideline and the same chrome as every other NE screen
                // (the conversation screen uses the same `IconSurfaceMenu`
                // pattern for its overflow). Refresh was here before; it's
                // now pull-to-refresh only — matches the threads list.
                IconSurfaceMenu<void>(
                  tooltip: l10n.threadsMore,
                  icon: Icons.more_vert_rounded,
                  constraints: const BoxConstraints(minWidth: 240),
                  itemBuilder: (_) => [
                    CheckedPopupMenuItem<void>(
                      checked: showExtension,
                      onTap: () => ref
                          .read(showFileExtensionsProvider.notifier)
                          .set(value: !showExtension),
                      child: Row(
                        children: [
                          const Icon(Icons.text_fields_rounded, size: 18),
                          const SizedBox(width: UxnanSpacing.sm),
                          Text(l10n.fileBrowserShowExtensions),
                        ],
                      ),
                    ),
                    CheckedPopupMenuItem<void>(
                      checked: showHidden,
                      onTap: () => ref
                          .read(showHiddenFilesProvider.notifier)
                          .set(value: !showHidden),
                      child: Row(
                        children: [
                          const Icon(Icons.visibility_outlined, size: 18),
                          const SizedBox(width: UxnanSpacing.sm),
                          Text(l10n.fileBrowserShowHidden),
                        ],
                      ),
                    ),
                    CheckedPopupMenuItem<void>(
                      checked: showDetails,
                      onTap: () => ref
                          .read(showFileDetailsProvider.notifier)
                          .set(value: !showDetails),
                      child: Row(
                        children: [
                          const Icon(Icons.info_outline_rounded, size: 18),
                          const SizedBox(width: UxnanSpacing.sm),
                          Text(l10n.fileBrowserShowDetails),
                        ],
                      ),
                    ),
                    CheckedPopupMenuItem<void>(
                      checked: compact,
                      onTap: () => ref
                          .read(compactFileRowsProvider.notifier)
                          .set(value: !compact),
                      child: Row(
                        children: [
                          const Icon(Icons.density_small_rounded, size: 18),
                          const SizedBox(width: UxnanSpacing.sm),
                          Text(l10n.fileBrowserCompactRows),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Renders the actual tree as a `CustomScrollView`. Errors and loading are
  /// handled by the caller; this method assumes the tree is ready to display.
  Widget _buildList(
    BuildContext context,
    FileTreeNode? root, {
    required bool showExtension,
    required bool showHidden,
    required bool showDetails,
    required bool compact,
  }) {
    final l10n = AppLocalizations.of(context);
    final topInset = NeTopBar.preferredHeight(context);
    final manager = ref.read(fileBrowserManagerProvider);

    if (root == null) {
      return Padding(
        padding: EdgeInsets.only(top: topInset),
        child: const Center(
          child: PolygonLoader(size: UxnanSpacing.xxl),
        ),
      );
    }
    if (root.error != null) {
      return Padding(
        padding: EdgeInsets.only(top: topInset),
        child: _ErrorBody(message: root.error!),
      );
    }
    if (root.children.isEmpty && !root.loading) {
      return Padding(
        padding: EdgeInsets.only(top: topInset),
        child: _EmptyState(message: l10n.fileBrowserEmpty),
      );
    }

    // Flatten the visible tree into a list of tiles. We walk depth-first,
    // skipping the descendants of collapsed directories and any children the
    // user has hidden (dotfiles when [showHidden] is off).
    final tiles = <_TileEntry>[];
    _walk(root, 0, showHidden: showHidden, into: tiles);

    final viewportWidth = MediaQuery.sizeOf(context).width;
    final horizontalInset = UxnanSpacing.lg +
        ((viewportWidth - UxnanSpacing.maxContentWidth) / 2).clamp(
          0.0,
          double.infinity,
        );

    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTap: () => FocusScope.of(context).unfocus(),
      child: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          controller: _scrollController,
          // BouncingScrollPhysics + AlwaysScrollable is the same combo
          // `NeScaffold` and `ConversationScreen` use, so the list feels
          // native on both iOS and Android and the user can always
          // drag-to-refresh even when the tree fits on a single screen.
          physics: const BouncingScrollPhysics(
            parent: AlwaysScrollableScrollPhysics(),
          ),
          slivers: [
            SliverToBoxAdapter(child: SizedBox(height: topInset)),
            SliverList.builder(
              itemCount: tiles.length,
              itemBuilder: (context, index) {
                final entry = tiles[index];
                return Padding(
                  padding: EdgeInsets.symmetric(
                    horizontal: horizontalInset - UxnanSpacing.lg,
                  ),
                  child: FileTreeTile(
                    key: entry.node.path == _revealedFilePath
                        ? _revealedFileKey
                        : null,
                    node: entry.node,
                    depth: entry.depth,
                    showExtension: showExtension,
                    showDetails: showDetails,
                    compact: compact,
                    onTap: () async {
                      if (entry.node.isDir) {
                        unawaited(
                          manager.toggleDirectory(widget.cwd, entry.node.path),
                        );
                      } else {
                        await FileViewerScreen.push(
                          context,
                          cwd: widget.cwd,
                          path: entry.node.path,
                          node: entry.node,
                        );
                        // Returning from the viewer can leave a soft keyboard
                        // up (e.g. after using its inline editor); drop focus
                        // dismisses and the read-only path bar never reads as a
                        // composer.
                        if (context.mounted) {
                          FocusManager.instance.primaryFocus?.unfocus();
                        }
                      }
                    },
                  ),
                );
              },
            ),
            const SliverToBoxAdapter(child: SizedBox(height: UxnanSpacing.lg)),
          ],
        ),
      ),
    );
  }

  void _walk(
    FileTreeNode node,
    int depth, {
    required bool showHidden,
    required List<_TileEntry> into,
  }) {
    // Sort: directories first (alphabetic), then files (alphabetic) — matches
    // the bridge's `WorkspaceService.list` ordering so the UI is consistent
    // with what `workspace/list` returns.
    final children = [...node.children]..sort((a, b) {
        if (a.isDir != b.isDir) return a.isDir ? -1 : 1;
        return a.basename.toLowerCase().compareTo(b.basename.toLowerCase());
      });
    for (final child in children) {
      if (!showHidden && _isHidden(child.basename)) continue;
      into.add(_TileEntry(node: child, depth: depth));
      if (child.isDir && child.expanded) {
        _walk(child, depth + 1, showHidden: showHidden, into: into);
      }
    }
  }

  bool _isHidden(String name) => name.startsWith('.');
}

/// Repo-wide file search using the same full-screen M3 pattern as thread and
/// commit-history search. Results keep the filename prominent and show only
/// the workspace-relative path beneath it.
class _FileSearchAnchor extends ConsumerWidget {
  const _FileSearchAnchor({required this.cwd, required this.onSelect});

  final String cwd;
  final Future<void> Function(
    FileSearchMatch match,
    SearchController controller,
  ) onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return SearchAnchor(
      isFullScreen: true,
      viewHintText: l10n.fileBrowserSearchHint,
      builder: (context, controller) => IconSurface(
        icon: Icons.search_rounded,
        tooltip: l10n.fileBrowserSearch,
        onPressed: controller.openView,
      ),
      suggestionsBuilder: (context, controller) async {
        final query = controller.text.trim();
        if (query.isEmpty) return const <Widget>[];
        try {
          final result = await ref
              .read(fileBrowserManagerProvider)
              .searchFiles(cwd, query, limit: 40);
          if (controller.text.trim() != query) return const <Widget>[];
          final matches = result.matches.where(
            (match) => match.type == FileEntryType.file,
          );
          if (matches.isEmpty) {
            return [_FileSearchMessage(message: l10n.fileBrowserSearchEmpty)];
          }
          return [
            for (final match in matches)
              _FileSearchResultTile(
                match: match,
                onTap: () => unawaited(onSelect(match, controller)),
              ),
          ];
        } on Object {
          return [_FileSearchMessage(message: l10n.fileBrowserSearchFailed)];
        }
      },
    );
  }
}

class _FileSearchResultTile extends StatelessWidget {
  const _FileSearchResultTile({required this.match, required this.onTap});

  final FileSearchMatch match;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final visuals = fileTypeVisuals(
      name: _basename(match.path),
      type: match.type,
    );
    return ListTile(
      leading: Icon(visuals.icon, color: colors.onSurfaceVariant),
      title: Text(
        _basename(match.path),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        match.path,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
      ),
      onTap: onTap,
    );
  }
}

class _FileSearchMessage extends StatelessWidget {
  const _FileSearchMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.all(UxnanSpacing.xl),
      child: Center(
        child: Text(
          message,
          style: textTheme.bodyMedium?.copyWith(color: colors.onSurfaceVariant),
        ),
      ),
    );
  }
}

String _basename(String path) {
  final normalized = path.replaceAll(r'\', '/');
  final index = normalized.lastIndexOf('/');
  return index < 0 ? normalized : normalized.substring(index + 1);
}

/// Whether any directory in [node]'s subtree is currently expanded. Drives
/// the visibility of the collapse-all action. Cheap: stops at the first
/// expanded directory.
bool _anyExpanded(FileTreeNode? node) {
  if (node == null) return false;
  for (final child in node.children) {
    if (child.isDir && (child.expanded || _anyExpanded(child))) return true;
  }
  return false;
}

/// Adapts the manager's per-cwd stream into a [StreamProvider] the UI can
/// watch directly with `ref.watch`. One provider per (cwd) — the manager
/// caches the tree so multiple `watch`es on the same cwd re-emit the same
/// cached tree.
final _fileTreeStreamProvider =
    StreamProvider.autoDispose.family<FileTreeNode?, String>((ref, String cwd) {
  final manager = ref.watch(fileBrowserManagerProvider);
  // Eagerly start the load so a screen opened before any other call still
  // receives the root — `loadRoot` is idempotent and cheap to re-issue.
  unawaited(manager.loadRoot(cwd));
  return manager.watchRoot(cwd);
});

/// Lightweight value type for the flattened tile list — keeps the tree node
/// paired with its indent depth without mutating the tree itself.
class _TileEntry {
  const _TileEntry({required this.node, required this.depth});
  final FileTreeNode node;
  final int depth;
}

/// Persistent bottom bar showing the workspace path, the git status summary
/// (branch + ahead/behind), and a quick copy-path action. Lighter than the
/// `GitScreen`'s commit composer — this is read-only workspace chrome.
class _StatusBar extends ConsumerWidget {
  const _StatusBar({required this.cwd});
  final String cwd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final gitState = ref.watch(gitRepoStateProvider).value;
    return SafeArea(
      top: false,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: UxnanSpacing.maxContentWidth,
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.xs,
              UxnanSpacing.lg,
              UxnanSpacing.sm,
            ),
            child: NeCard(
              color: colors.surfaceContainerHigh,
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.lg,
                UxnanSpacing.sm,
                UxnanSpacing.xs,
                UxnanSpacing.sm,
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.folder_outlined,
                    size: 20,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          cwd,
                          style: UxnanTypography.codeSmall.copyWith(
                            color: colors.onSurface,
                          ),
                          overflow: TextOverflow.ellipsis,
                          maxLines: 1,
                        ),
                        if (gitState != null && gitState.branch.isNotEmpty) ...[
                          const SizedBox(height: UxnanSpacing.xs),
                          Row(
                            children: [
                              const Icon(
                                Icons.account_tree_outlined,
                                size: 14,
                                color: UxnanColors.success,
                              ),
                              const SizedBox(width: UxnanSpacing.xs),
                              Flexible(
                                child: Text(
                                  gitState.branch,
                                  style: textTheme.bodySmall?.copyWith(
                                    color: colors.onSurfaceVariant,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (gitState.ahead > 0) ...[
                                const SizedBox(width: UxnanSpacing.sm),
                                Text(
                                  '↑${gitState.ahead}',
                                  style: UxnanTypography.codeSmall.copyWith(
                                    color: UxnanColors.success,
                                  ),
                                ),
                              ],
                              if (gitState.behind > 0) ...[
                                const SizedBox(width: UxnanSpacing.xs),
                                Text(
                                  '↓${gitState.behind}',
                                  style: UxnanTypography.codeSmall.copyWith(
                                    color: UxnanColors.warning,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  IconSurface(
                    icon: Icons.content_copy_outlined,
                    tooltip: l10n.fileBrowserCopyPath,
                    background: colors.surfaceContainerHighest,
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: cwd));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context)
                          ..clearSnackBars()
                          ..showSnackBar(
                            SnackBar(content: Text(l10n.fileBrowserPathCopied)),
                          );
                      }
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xxl),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.folder_off_outlined,
            size: 40,
            color: colors.onSurfaceVariant,
          ),
          const SizedBox(height: UxnanSpacing.sm),
          Text(l10n.fileBrowserEmptyTitle, style: textTheme.titleSmall),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            message,
            style: textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _ErrorBody extends StatelessWidget {
  const _ErrorBody({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.all(UxnanSpacing.xl),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.error_outline, size: 40, color: colors.error),
          const SizedBox(height: UxnanSpacing.md),
          Text(
            l10n.fileBrowserLoadFailed,
            style: textTheme.titleSmall,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            message,
            style: textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
