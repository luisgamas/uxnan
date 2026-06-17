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
import 'package:uxnan/presentation/screens/conversation/files/file_browser_screen.dart';
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

  /// Workspace root used to resolve the file (a thread's `cwd`).
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

    return Scaffold(
      body: Stack(
        children: [
          Column(
            children: [
              Expanded(
                child: _buildBody(
                  context,
                  showMdPreview: showMdPreview,
                  showDiffOverlay: showDiffOverlay,
                  isImage: isImage,
                  isMarkdown: isMarkdown,
                ),
              ),
              _FooterBar(
                cwd: widget.cwd,
                path: widget.path,
                name: name,
                status: status,
                showDiff: showDiffOverlay,
                isMarkdown: isMarkdown,
                showMdPreview: showMdPreview,
              ),
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
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
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
                    onPressed: () => ref
                        .read(showMarkdownPreviewProvider.notifier)
                        .set(value: !showMdPreview),
                  ),
                if (status != null)
                  IconSurface(
                    icon: showDiff
                        ? Icons.difference_rounded
                        : Icons.difference_outlined,
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
                  onPressed: () => _copyContent(),
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
    final topInset = NeTopBar.preferredHeight(context);
    final payload = _payload;
    if (_loading && payload == null) {
      return Padding(
        padding: EdgeInsets.only(top: topInset),
        child: const Center(child: CircularProgressIndicator()),
      );
    }
    if (payload == null) {
      return const SizedBox.shrink();
    }
    if (payload.error != null) {
      return _ErrorState(
        message: payload.error!,
        topInset: topInset,
        onRetry: _load,
      );
    }
    if (isImage && payload.image != null) {
      return _ImageBody(
        base64: payload.image!.base64Data,
        mimeType: payload.image!.mimeType,
        topInset: topInset,
      );
    }
    if (isImage) {
      return _ErrorState(
        message: payload.error ?? 'Image not available',
        topInset: topInset,
        onRetry: _load,
      );
    }
    final content = payload.content;
    if (content == null) {
      return _ErrorState(
        message: 'File not readable',
        topInset: topInset,
        onRetry: _load,
      );
    }
    if (content.encoding == FileEncoding.base64) {
      return _BinaryState(
        topInset: topInset,
        sizeBytes: content.content.length,
      );
    }
    final text = content.content;
    if (isMarkdown && showMdPreview) {
      return _MarkdownBody(text: text, topInset: topInset);
    }
    if (showDiffOverlay && payload.diff != null && payload.diff!.isNotEmpty) {
      return FileDiffViewer(
        diff: payload.diff!,
        topInset: topInset,
        path: widget.path,
      );
    }
    // Plain code/text with optional syntax highlighting.
    return _CodeBody(
      text: text,
      language: _languageForPath(widget.path),
      topInset: topInset,
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
    final value = switch (payload!.content!.encoding) {
      FileEncoding.utf8 => payload.content!.content,
      FileEncoding.base64 => payload.content!.content,
    };
    await Clipboard.setData(ClipboardData(text: value));
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
  const _ImageBody({
    required this.base64,
    required this.mimeType,
    required this.topInset,
  });
  final String base64;
  final String mimeType;
  final double topInset;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(top: topInset),
      child: Center(
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
                  Text('$mimeType', style: UxnanTypography.codeSmall),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Markdown body — `MarkdownBody` from `flutter_markdown` (read-only, styled
/// preview). Scrolled via a `Markdown(controller: …, …)` so it sits inside the
/// page's scrollable surface.
class _MarkdownBody extends StatelessWidget {
  const _MarkdownBody({required this.text, required this.topInset});
  final String text;
  final double topInset;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: EdgeInsets.only(top: topInset),
      child: Markdown(
        data: text,
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          UxnanSpacing.sm,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        selectable: true,
        styleSheet: MarkdownStyleSheet(
          p: Theme.of(context).textTheme.bodyMedium,
          h1: Theme.of(context).textTheme.headlineMedium,
          h2: Theme.of(context).textTheme.titleLarge,
          h3: Theme.of(context).textTheme.titleMedium,
          code: UxnanTypography.codeBody.copyWith(
            backgroundColor: colors.surfaceContainerHigh,
          ),
          codeblockDecoration: BoxDecoration(
            color: isDark ? const Color(0xFF282C34) : const Color(0xFFFAFAFA),
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
  const _CodeBody({
    required this.text,
    required this.language,
    required this.topInset,
  });
  final String text;
  final String language;
  final double topInset;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final theme = isDark ? atomOneDarkTheme : atomOneLightTheme;
    return Padding(
      padding: EdgeInsets.only(top: topInset),
      child: SingleChildScrollView(
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
      ),
    );
  }
}

class _BinaryState extends StatelessWidget {
  const _BinaryState({required this.topInset, required this.sizeBytes});
  final double topInset;
  final int sizeBytes;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.only(top: topInset),
      child: Padding(
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
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({
    required this.message,
    required this.topInset,
    required this.onRetry,
  });
  final String message;
  final double topInset;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.only(top: topInset),
      child: Padding(
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
      ),
    );
  }
}

/// Bottom bar with the file path, the git status pill, and a "Reveal in
/// browser" action that pushes back to [FileBrowserScreen] (mostly useful
/// when the viewer is opened from a deep link, e.g. a notification).
class _FooterBar extends StatelessWidget {
  const _FooterBar({
    required this.cwd,
    required this.path,
    required this.name,
    required this.status,
    required this.showDiff,
    required this.isMarkdown,
    required this.showMdPreview,
  });
  final String cwd;
  final String path;
  final String name;
  final GitFileStatus? status;
  final bool showDiff;
  final bool isMarkdown;
  final bool showMdPreview;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final dir = _directoryOf(path);
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
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    name,
                    style: UxnanTypography.codeSmall.copyWith(
                      color: _statusColor(status, colors),
                    ),
                    overflow: TextOverflow.ellipsis,
                    maxLines: 1,
                  ),
                  if (dir.isNotEmpty)
                    Text(
                      dir,
                      style: UxnanTypography.codeSmall.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                ],
              ),
            ),
            if (status != null) ...[
              const SizedBox(width: UxnanSpacing.sm),
              _StatusPill(status: status!, showDiff: showDiff),
            ],
            if (isMarkdown) ...[
              const SizedBox(width: UxnanSpacing.sm),
              _ModePill(
                label: showMdPreview
                    ? l10n.fileViewerModePreview
                    : l10n.fileViewerModeSource,
                icon: showMdPreview
                    ? Icons.visibility_outlined
                    : Icons.code_rounded,
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _directoryOf(String path) {
    final i = path.lastIndexOf('/');
    return i < 0 ? '' : path.substring(0, i);
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status, required this.showDiff});
  final GitFileStatus status;
  final bool showDiff;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final (label, color) = switch (status) {
      GitFileStatus.added => (l10n.gitStatusAdded, UxnanColors.gitAdded),
      GitFileStatus.modified => (
          l10n.gitStatusModified,
          UxnanColors.gitModified
        ),
      GitFileStatus.deleted => (l10n.gitStatusDeleted, UxnanColors.gitDeleted),
      GitFileStatus.renamed => (l10n.gitStatusRenamed, UxnanColors.gitModified),
      GitFileStatus.untracked => (
          l10n.gitStatusUntracked,
          UxnanColors.gitUntracked
        ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: const BorderRadius.all(UxnanRadius.full),
        border: Border.all(
          color: color.withValues(alpha: 0.4),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.fiber_manual_record, size: 8, color: color),
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            label,
            style: UxnanTypography.codeSmall.copyWith(
              color: colors.onSurface,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _ModePill extends StatelessWidget {
  const _ModePill({required this.label, required this.icon});
  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: colors.onSurfaceVariant),
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            label,
            style: UxnanTypography.codeSmall.copyWith(
              color: colors.onSurfaceVariant,
            ),
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
