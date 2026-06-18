import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/file_diff_viewer.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen file viewer. Renders one of: an inline image, a markdown file
/// (preview or raw), a syntax-highlighted code/text file (with the git diff
/// overlay when the file has changes), or a binary placeholder.
///
/// Driven by the [FileBrowserManager] for content reads and diff fetches; the
/// chrome mirrors the [FileBrowserScreen] so navigating list → file → back
/// feels like a single surface.
class FileViewerScreen extends ConsumerStatefulWidget {
  /// Creates a [FileViewerScreen].
  const FileViewerScreen({
    required this.cwd,
    required this.path,
    this.node,
    super.key,
  });

  /// Workspace root used to resolve the file (a thread's `cwd`, absolute).
  final String cwd;

  /// Workspace-relative file path to view.
  final String path;

  /// Optional cached tree node (so the viewer can pre-paint the file's name
  /// and git status from the browser without re-fetching). When null, the
  /// viewer fetches a fresh snapshot.
  final FileTreeNode? node;

  /// Pushes the viewer onto the navigator.
  static Future<void> push(
    BuildContext context, {
    required String cwd,
    required String path,
    FileTreeNode? node,
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileViewerScreen(
          cwd: cwd,
          path: path,
          node: node,
        ),
      ),
    );
  }

  @override
  ConsumerState<FileViewerScreen> createState() => _FileViewerScreenState();
}

class _FileViewerScreenState extends ConsumerState<FileViewerScreen> {
  /// The fetch result — content + (optional) image, (optional) diff, plus the
  /// error when the bridge refused. We keep the success + error in one
  /// discriminated union (`AsyncSnapshot` would be heavier).
  _ViewerPayload? _payload;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final manager = ref.read(fileBrowserManagerProvider);
      final viewer = await _loadViewer(manager, widget.cwd, widget.path);
      if (!mounted) return;
      setState(() {
        _payload = viewer;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _payload = _ViewerPayload.error('$error');
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final node = widget.node;
    final showExt = ref.watch(showFileExtensionsProvider);
    final showMdPreview = ref.watch(showMarkdownPreviewProvider);
    final showDiff = ref.watch(showFileDiffProvider);
    final colors = Theme.of(context).colorScheme;
    final name = node?.displayName(showExtension: showExt) ??
        widget.path.split('/').last;
    final status = node?.gitStatus;
    final isImage = _isImagePath(widget.path);
    final isMarkdown = _isMarkdownPath(widget.path);
    final showDiffOverlay = showDiff && status != null && !isImage;
    final topInset = NeTopBar.preferredHeight(context);

    return Scaffold(
      body: Stack(
        // StackFit.expand forces the bar to the full row width — the
        // default loose fit would size the stack to its non-Positioned
        // child (the markdown body) which reports a narrow intrinsic
        // width and starves the NeTopBar's actions row of horizontal
        // space, triggering a RenderFlex overflow in the bar's Row.
        fit: StackFit.expand,
        children: [
          Padding(
            padding: EdgeInsets.only(top: topInset),
            child: _buildBody(
              context,
              showMdPreview: showMdPreview,
              showDiffOverlay: showDiffOverlay,
              isImage: isImage,
              isMarkdown: isMarkdown,
            ),
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
              // Same `titleLarge.copyWith(fontSize: 20)` style as
              // `ConversationScreen` and `GitScreen` so the file viewer's
              // chrome is indistinguishable from the rest of the app.
              title: Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontSize: 20,
                      color: _statusColor(status, colors),
                    ),
              ),
              actions: [
                if (isMarkdown)
                  IconSurface(
                    icon: showMdPreview
                        ? Icons.code_rounded
                        : Icons.visibility_outlined,
                    tooltip: showMdPreview
                        ? l10n.fileViewerViewSource
                        : l10n.fileViewerViewPreview,
                    selected: showMdPreview,
                    onPressed: () => ref
                        .read(showMarkdownPreviewProvider.notifier)
                        .set(value: !showMdPreview),
                  ),
                if (status != null)
                  IconSurface(
                    icon: Icons.difference_rounded,
                    tooltip: showDiff
                        ? l10n.fileViewerHideDiff
                        : l10n.fileViewerShowDiff,
                    selected: showDiff,
                    onPressed: () => ref
                        .read(showFileDiffProvider.notifier)
                        .set(value: !showDiff),
                  ),
                IconSurface(
                  icon: Icons.content_copy_outlined,
                  tooltip: l10n.fileViewerCopy,
                  onPressed: _copyContent,
                ),
                IconSurface(
                  icon: Icons.refresh_rounded,
                  tooltip: l10n.gitRefresh,
                  onPressed: _load,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(
    BuildContext context, {
    required bool showMdPreview,
    required bool showDiffOverlay,
    required bool isImage,
    required bool isMarkdown,
  }) {
    final payload = _payload;
    if (_loading && payload == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (payload == null) {
      return const SizedBox.shrink();
    }
    if (payload.error != null) {
      return _ErrorState(
        message: payload.error!,
        onRetry: _load,
      );
    }
    if (isImage && payload.image != null) {
      return _ImageBody(
        base64: payload.image!.base64Data,
        mimeType: payload.image!.mimeType,
      );
    }
    if (isImage) {
      return _ErrorState(
        message: payload.error ?? 'Image not available',
        onRetry: _load,
      );
    }
    final content = payload.content;
    if (content == null) {
      return _ErrorState(
        message: 'File not readable',
        onRetry: _load,
      );
    }
    if (content.encoding == FileEncoding.base64) {
      return _BinaryState(
        sizeBytes: content.content.length,
      );
    }
    final text = content.content;
    if (isMarkdown && showMdPreview) {
      return _MarkdownBody(text: text);
    }
    if (showDiffOverlay && payload.diff != null && payload.diff!.isNotEmpty) {
      return FileDiffViewer(
        diff: payload.diff!,
        path: widget.path,
      );
    }
    // Plain code/text with optional syntax highlighting.
    return _CodeBody(
      text: text,
      language: _languageForPath(widget.path),
    );
  }

  Future<void> _copyContent() async {
    final payload = _payload;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (payload?.content == null) {
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.fileViewerCopyFailed)));
      return;
    }
    await Clipboard.setData(
      ClipboardData(text: payload!.content!.content),
    );
    if (!mounted) return;
    messenger
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.fileViewerCopied)));
  }
}

Future<_ViewerPayload> _loadViewer(
  FileBrowserManager manager,
  String cwd,
  String path,
) async {
  if (_isImagePath(path)) {
    try {
      final image = await manager.readImage(cwd, path);
      return _ViewerPayload.image(image);
    } on Object catch (error) {
      // Fall through to readFile: some image extensions might not be in the
      // bridge's allowlist and the user might still want to see the file
      // content as base64 (binary body).
      return _ViewerPayload.error('$error');
    }
  }
  try {
    final content = await manager.readFile(cwd, path);
    String? diff;
    try {
      diff = await manager.fileDiff(cwd, path);
    } on Object {
      // No diff (not a git repo or no changes) — leave null so the viewer
      // falls back to the raw file content.
      diff = null;
    }
    return _ViewerPayload.text(content, diff);
  } on Object catch (error) {
    return _ViewerPayload.error('$error');
  }
}

/// Discriminated result for [_loadViewer]: exactly one of [content]/[image]
/// is set on success, or [error] is set on failure.
class _ViewerPayload {
  const _ViewerPayload.text(this.content, this.diff)
      : image = null,
        error = null;
  const _ViewerPayload.image(this.image)
      : content = null,
        diff = null,
        error = null;
  const _ViewerPayload.error(this.error)
      : content = null,
        diff = null,
        image = null;

  final FileContent? content;
  final ImageFile? image;
  final String? diff;
  final String? error;
}

/// Image body — base64 → `Image.memory` with an `InteractiveViewer` so the
/// user can pinch-zoom and pan.
class _ImageBody extends StatelessWidget {
  const _ImageBody({required this.base64, required this.mimeType});
  final String base64;
  final String mimeType;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Center(
      child: InteractiveViewer(
        maxScale: 6,
        minScale: 1,
        child: Image.memory(
          base64Decode(base64),
          fit: BoxFit.contain,
          gaplessPlayback: true,
          errorBuilder: (context, error, stack) => Padding(
            padding: const EdgeInsets.all(UxnanSpacing.xl),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.broken_image_outlined,
                  size: 40,
                  color: colors.error,
                ),
                const SizedBox(height: UxnanSpacing.sm),
                Text(mimeType, style: UxnanTypography.codeSmall),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Markdown body — `MarkdownBody` (from `flutter_markdown`) wrapped in a
/// `SingleChildScrollView` with `BouncingScrollPhysics`. Using `MarkdownBody`
/// instead of `Markdown` is deliberate: `Markdown` carries its own scroll
/// view + a `Column` of `Wrap`s that occasionally overflow horizontally
/// when the parent `NeTopBar` is also constrained (the wrap tries to size
/// against the constraint chain through the parent's Row, and the
/// `NeTopBar`'s actions end up off-screen with a "RenderFlex overflowed"
/// exception). `MarkdownBody` renders directly into the surrounding scroll
/// surface and stays at the correct width.
class _MarkdownBody extends StatelessWidget {
  const _MarkdownBody({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(
        parent: AlwaysScrollableScrollPhysics(),
      ),
      child: MarkdownBody(
        data: text,
        selectable: true,
        styleSheet: MarkdownStyleSheet(
          p: Theme.of(context).textTheme.bodyMedium,
          h1: Theme.of(context).textTheme.headlineMedium,
          h2: Theme.of(context).textTheme.titleLarge,
          h3: Theme.of(context).textTheme.titleMedium,
          code: UxnanTypography.codeBody.copyWith(
            backgroundColor: colors.surfaceContainerHigh,
          ),
          // Codeblocks use the same surface tone as elevated surfaces
          // (surfaceContainerHighest in dark, surfaceContainerHigh in
          // light) — never raw hex literals. Keeps the M3 surface
          // hierarchy intact.
          codeblockDecoration: BoxDecoration(
            color: isDark
                ? colors.surfaceContainerHighest
                : colors.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(8),
          ),
          blockquoteDecoration: BoxDecoration(
            border: Border(
              left: BorderSide(color: colors.outline, width: 3),
            ),
          ),
        ),
      ),
    );
  }
}

/// Plain code/text body with optional syntax highlighting.
class _CodeBody extends StatelessWidget {
  const _CodeBody({required this.text, required this.language});
  final String text;
  final String language;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final theme = isDark ? atomOneDarkTheme : atomOneLightTheme;
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          UxnanSpacing.sm,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        child: HighlightView(
          text,
          language: language,
          theme: theme,
          textStyle: UxnanTypography.codeBody,
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.sm,
            vertical: UxnanSpacing.xs,
          ),
        ),
      ),
    );
  }
}

class _BinaryState extends StatelessWidget {
  const _BinaryState({required this.sizeBytes});
  final int sizeBytes;

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
            Icons.archive_outlined,
            size: 40,
            color: colors.onSurfaceVariant,
          ),
          const SizedBox(height: UxnanSpacing.md),
          Text(l10n.fileViewerBinaryTitle, style: textTheme.titleSmall),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            l10n.fileViewerBinaryBody,
            style: textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: UxnanSpacing.sm),
          Text(
            '$sizeBytes bytes (base64)',
            style: UxnanTypography.codeSmall,
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

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
            l10n.fileViewerLoadFailed,
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
          const SizedBox(height: UxnanSpacing.md),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: Text(l10n.gitRefresh),
          ),
        ],
      ),
    );
  }
}

Color _statusColor(GitFileStatus? status, ColorScheme colors) {
  return switch (status) {
    GitFileStatus.added => UxnanColors.gitAdded,
    GitFileStatus.modified => UxnanColors.gitModified,
    GitFileStatus.deleted => UxnanColors.gitDeleted,
    GitFileStatus.renamed => UxnanColors.gitModified,
    GitFileStatus.untracked => UxnanColors.gitUntracked,
    null => colors.onSurface,
  };
}

bool _isImagePath(String path) {
  final lower = path.toLowerCase();
  return lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.bmp');
}

bool _isMarkdownPath(String path) {
  final lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

String _languageForPath(String path) {
  final lower = path.toLowerCase();
  if (lower.endsWith('.dart')) return 'dart';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.swift')) return 'swift';
  if (lower.endsWith('.kt')) return 'kotlin';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.cpp') ||
      lower.endsWith('.cc') ||
      lower.endsWith('.cxx')) {
    return 'cpp';
  }
  if (lower.endsWith('.c')) return 'c';
  if (lower.endsWith('.h')) return 'objectivec';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.scss')) return 'scss';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'xml';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.toml')) return 'ini';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'bash';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.lock')) return 'yaml';
  return 'plaintext';
}
