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
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen workspace file browser for the active thread's `cwd`.
///
/// Lists every file/folder (incl. hidden dotfiles when enabled) with the
/// git-aware color treatment the user asked for: tracked-but-unchanged files
/// are neutral, modified/added/deleted/renamed/untracked each get a distinct
/// color, and the file name is the painted surface. Tapping a directory
/// toggles its expansion; tapping a file opens the file viewer.
///
/// Mirrors the [GitScreen] chrome: a Neural Expressive top bar (back, title,
/// refresh, settings overflow) with a body that scrolls behind it. The
/// file-list state is driven by [FileBrowserManager] — see that class for the
/// lazy walk, git-status merge and caching.
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
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final manager = ref.watch(fileBrowserManagerProvider);
    final showExtension = ref.watch(showFileExtensionsProvider);
    final showHidden = ref.watch(showHiddenFilesProvider);
    // The stream-based tree is the canonical state: the manager owns the
    // mutation, the UI just renders whatever was last emitted.
    final rootAsync = ref.watch(_fileTreeStreamProvider(widget.cwd));

    return Scaffold(
      body: Stack(
        children: [
          Column(
            children: [
              Expanded(
                child: rootAsync.when(
                  data: (FileTreeNode? root) =>
                      _buildBody(context, root, showExtension, showHidden),
                  loading: () => const Center(
                    child: CircularProgressIndicator(),
                  ),
                  error: (Object error, StackTrace _) =>
                      _ErrorBody(message: '$error'),
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
                IconSurface(
                  icon: Icons.refresh_rounded,
                  tooltip: l10n.gitRefresh,
                  onPressed: () => manager.loadRoot(widget.cwd),
                ),
                _SettingsMenu(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    FileTreeNode? root,
    bool showExtension,
    bool showHidden,
  ) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final topInset = NeTopBar.preferredHeight(context);
    final manager = ref.read(fileBrowserManagerProvider);

    if (root == null) {
      return Padding(
        padding: EdgeInsets.only(top: topInset),
        child: const Center(child: CircularProgressIndicator()),
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

    return Stack(
      children: [
        GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: () => FocusScope.of(context).unfocus(),
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: SizedBox(height: topInset),
              ),
              SliverList.builder(
                itemCount: tiles.length,
                itemBuilder: (context, index) {
                  final entry = tiles[index];
                  return FileTreeTile(
                    node: entry.node,
                    depth: entry.depth,
                    showExtension: showExtension,
                    onTap: () {
                      if (entry.node.isDir) {
                        unawaited(
                          manager.toggleDirectory(widget.cwd, entry.node.path),
                        );
                      } else {
                        unawaited(
                          FileViewerScreen.push(
                            context,
                            cwd: widget.cwd,
                            path: entry.node.path,
                            node: entry.node,
                          ),
                        );
                      }
                    },
                  );
                },
              ),
              const SliverToBoxAdapter(
                child: SizedBox(height: UxnanSpacing.lg),
              ),
            ],
          ),
        ),
        // Bottom scroll veil mirroring the top bar's: the last rows fade into
        // the surface just above the status bar.
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

/// Lightweight value type for the flattened tile list — keeps the tree node
/// paired with its indent depth without mutating the tree itself.
class _TileEntry {
  const _TileEntry({required this.node, required this.depth});
  final FileTreeNode node;
  final int depth;
}

/// Adapts the manager's per-cwd stream into a [StreamProvider] the UI can
/// watch directly with `ref.watch`. One provider per (cwd) — the manager
/// caches the tree so multiple `watch`es on the same cwd re-emit the same
/// cached tree.
final _fileTreeStreamProvider =
    StreamProvider.autoDispose.family<FileTreeNode?, String>((ref, String cwd) {
  final manager = ref.watch(fileBrowserManagerProvider);
  // Eagerly start the load so a screen that opens before any other call still
  // receives the root — `loadRoot` is idempotent and cheap to re-issue.
  unawaited(manager.loadRoot(cwd));
  return manager.watchRoot(cwd);
});

/// Settings overflow — toggles for "show file extensions" and "show hidden
/// files". A third toggle (file diff overlay) lives on the file viewer itself
/// because it's a per-file concern, not a list concern.
class _SettingsMenu extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final showExt = ref.watch(showFileExtensionsProvider);
    final showHidden = ref.watch(showHiddenFilesProvider);
    return IconSurfaceMenu<void>(
      tooltip: l10n.threadsMore,
      icon: Icons.tune_rounded,
      constraints: const BoxConstraints(minWidth: 220),
      itemBuilder: (context) => [
        PopupMenuItem<void>(
          child: _ToggleRow(
            label: l10n.fileBrowserShowExtensions,
            value: showExt,
            onChanged: (v) =>
                ref.read(showFileExtensionsProvider.notifier).set(value: v),
          ),
        ),
        PopupMenuItem<void>(
          child: _ToggleRow(
            label: l10n.fileBrowserShowHidden,
            value: showHidden,
            onChanged: (v) =>
                ref.read(showHiddenFilesProvider.notifier).set(value: v),
          ),
        ),
      ],
    );
  }
}

class _ToggleRow extends StatelessWidget {
  const _ToggleRow({
    required this.label,
    required this.value,
    required this.onChanged,
  });
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label),
        Switch.adaptive(value: value, onChanged: onChanged),
      ],
    );
  }
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
      child: Container(
        decoration: BoxDecoration(
          color: colors.surfaceContainer,
          border: Border(
            top: BorderSide(color: colors.outlineVariant),
          ),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.lg,
          vertical: UxnanSpacing.sm,
        ),
        child: Row(
          children: [
            Icon(
              Icons.folder_outlined,
              size: 16,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Text(
                cwd,
                style: UxnanTypography.codeSmall.copyWith(
                  color: colors.onSurface,
                ),
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
            ),
            if (gitState != null && gitState.branch.isNotEmpty) ...[
              const SizedBox(width: UxnanSpacing.sm),
              Icon(
                Icons.account_tree_outlined,
                size: 14,
                color: UxnanColors.success,
              ),
              const SizedBox(width: UxnanSpacing.xs),
              Text(
                gitState.branch,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
                overflow: TextOverflow.ellipsis,
              ),
              if (gitState.ahead > 0) ...[
                const SizedBox(width: UxnanSpacing.xs),
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
            const SizedBox(width: UxnanSpacing.sm),
            IconSurface(
              icon: Icons.content_copy_outlined,
              tooltip: l10n.fileBrowserCopyPath,
              background: colors.surfaceContainerHigh,
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
          Icon(
            Icons.error_outline,
            size: 40,
            color: colors.error,
          ),
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
