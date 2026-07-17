import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:highlight/highlight.dart' as syntax;
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/file_diff_viewer.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/markdown.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
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
        builder: (_) => FileViewerScreen(cwd: cwd, path: path, node: node),
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

  /// Whether the inline editor is active. Editing shows a monospace text field
  /// over the raw file content; saving writes back through the manager and
  /// re-fetches so the diff/git colours stay in sync.
  bool _editing = false;

  /// `true` while a save (`workspace/applyPatch`) is in flight.
  bool _saving = false;

  /// Backing buffer for the inline editor. Seeded from the loaded text when
  /// the user enters edit mode; compared against to detect unsaved edits.
  final TextEditingController _editController = TextEditingController();

  /// The text the editor opened with — used to detect a dirty buffer so we can
  /// confirm before discarding.
  String _editOriginal = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _editController.dispose();
    super.dispose();
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

  /// Whether the current payload is an editable text file (UTF-8, not an
  /// image, not binary). Drives the visibility of the edit action.
  bool _isEditable(bool isImage) {
    final content = _payload?.content;
    return !isImage &&
        _payload?.error == null &&
        content != null &&
        content.encoding == FileEncoding.utf8;
  }

  void _startEditing() {
    final text = _payload?.content?.content ?? '';
    setState(() {
      _editOriginal = text;
      _editController.text = text;
      _editing = true;
    });
  }

  Future<void> _cancelEditing() async {
    if (_editController.text != _editOriginal) {
      final discard = await _confirmDiscard();
      if (discard != true) return;
    }
    if (!mounted) return;
    setState(() => _editing = false);
  }

  Future<bool?> _confirmDiscard() {
    final l10n = AppLocalizations.of(context);
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.fileViewerDiscardTitle),
        content: Text(l10n.fileViewerDiscardBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.fileViewerKeepEditing),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.fileViewerDiscard),
          ),
        ],
      ),
    );
  }

  Future<void> _save() async {
    if (_saving) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    try {
      final manager = ref.read(fileBrowserManagerProvider);
      await manager.writeFile(widget.cwd, widget.path, _editController.text);
      // Re-fetch so the freshly-written content + its new git diff render.
      await _load();
      if (!mounted) return;
      setState(() {
        _editing = false;
        _saving = false;
      });
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.fileViewerSaved)));
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(content: Text(l10n.fileViewerSaveFailed('$error'))),
        );
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
    // While editing the raw buffer is the only surface — the markdown preview
    // and the diff overlay both step aside so the user edits plain source.
    final showDiffOverlay = showDiff && status != null && !isImage && !_editing;
    final editable = _isEditable(isImage);
    final topInset = NeTopBar.preferredHeight(context);
    // Block an accidental system-back while editing with unsaved changes; the
    // pop is routed through the same discard confirmation as the close button.
    final dirtyEdit = _editing && _editController.text != _editOriginal;

    return PopScope(
      canPop: !dirtyEdit,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_cancelEditing());
      },
      child: Scaffold(
        // Resize for the keyboard so the inline editor stays above it.
        resizeToAvoidBottomInset: true,
        body: Stack(
          // StackFit.expand forces the bar to the full row width — the
          // default loose fit would size the stack to its non-Positioned
          // child (the markdown body) which reports a narrow intrinsic
          // width and starves the NeTopBar's actions row of horizontal
          // space, triggering a RenderFlex overflow in the bar's Row.
          fit: StackFit.expand,
          children: [
            // The content fills the stack and each scrollable body pads its top
            // by [topInset] so the content scrolls *under* the transparent
            // NeTopBar (matching `ConversationScreen`, `FileBrowserScreen`,
            // `GitScreen`) — the gradient dissolves into the live content
            // instead of sitting over a blank band.
            _buildBody(
              context,
              topInset: topInset,
              showMdPreview: showMdPreview,
              showDiffOverlay: showDiffOverlay,
              isImage: isImage,
              isMarkdown: isMarkdown,
            ),
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: NeTopBar(
                leading: IconSurface(
                  icon:
                      _editing ? Icons.close_rounded : Icons.arrow_back_rounded,
                  tooltip: _editing
                      ? MaterialLocalizations.of(context).cancelButtonLabel
                      : MaterialLocalizations.of(context).backButtonTooltip,
                  onPressed: () {
                    if (_editing) {
                      unawaited(_cancelEditing());
                    } else {
                      Navigator.of(context).maybePop();
                    }
                  },
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
                actions: _editing
                    ? [
                        if (_saving)
                          const Padding(
                            padding: EdgeInsets.symmetric(
                              horizontal: UxnanSpacing.md,
                            ),
                            child: SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          )
                        else
                          IconSurface(
                            icon: Icons.check_rounded,
                            tooltip: l10n.fileViewerSave,
                            background: colors.secondaryContainer,
                            foreground: colors.onSecondaryContainer,
                            onPressed: _save,
                          ),
                      ]
                    : [
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
                        if (editable)
                          IconSurface(
                            icon: Icons.edit_outlined,
                            tooltip: l10n.fileViewerEdit,
                            onPressed: _startEditing,
                          ),
                        // Refreshing moved to pull-to-refresh on the content
                        // body (see [_buildBody]) — matching FileBrowserScreen
                        // and GitScreen — so the appbar stays lean.
                      ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(
    BuildContext context, {
    required double topInset,
    required bool showMdPreview,
    required bool showDiffOverlay,
    required bool isImage,
    required bool isMarkdown,
  }) {
    final payload = _payload;

    // The inline editor wins over every read-only view while active.
    if (_editing) {
      return _EditorBody(controller: _editController, topInset: topInset);
    }

    // Scrollable bodies pad their own top by [topInset] so they scroll under
    // the bar. Binary/error placeholders are nudged below it with [_belowBar],
    // while an image intentionally owns the full surface behind the top bar.
    if (_loading && payload == null) {
      return const Center(
        child: PolygonLoader(size: UxnanSpacing.xxl),
      );
    }
    if (payload == null) {
      return const SizedBox.shrink();
    }
    if (payload.error != null) {
      return _belowBar(
        topInset,
        _ErrorState(message: payload.error!, onRetry: _load),
      );
    }
    if (isImage && payload.image != null) {
      return _ImageBody(
        base64: payload.image!.base64Data,
        mimeType: payload.image!.mimeType,
      );
    }
    if (isImage) {
      return _belowBar(
        topInset,
        _ErrorState(
          message: payload.error ?? 'Image not available',
          onRetry: _load,
        ),
      );
    }
    final textContent = payload.content;
    if (textContent == null) {
      return _belowBar(
        topInset,
        _ErrorState(message: 'File not readable', onRetry: _load),
      );
    }
    if (textContent.encoding == FileEncoding.base64) {
      return _belowBar(
        topInset,
        _BinaryState(sizeBytes: textContent.content.length),
      );
    }
    final text = textContent.content;
    if (isMarkdown && showMdPreview) {
      return _refreshable(_MarkdownBody(text: text, topInset: topInset));
    }
    if (showDiffOverlay && payload.diff != null && payload.diff!.isNotEmpty) {
      return _refreshable(
        SelectionArea(
          child: FileDiffViewer(
            diff: payload.diff!,
            path: widget.path,
            topInset: topInset,
          ),
        ),
      );
    }
    return _refreshable(
      _CodeBody(
        text: text,
        language: _languageForPath(widget.path),
        topInset: topInset,
      ),
    );
  }

  /// Wraps a scrollable content body in a pull-to-refresh that re-fetches the
  /// file (the same `_load` the old appbar refresh button called). The bodies
  /// scroll under the transparent [NeTopBar], so `edgeOffset` pushes the
  /// spinner below the bar instead of behind it.
  Widget _refreshable(Widget child) => RefreshIndicator(
        onRefresh: _load,
        edgeOffset: NeTopBar.preferredHeight(context),
        child: child,
      );

  /// Wraps a non-scrolling placeholder so it sits below the transparent bar
  /// rather than under it.
  static Widget _belowBar(double topInset, Widget child) => Padding(
        padding: EdgeInsets.only(top: topInset),
        child: child,
      );
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

/// Full-surface image preview. The image starts fully visible with
/// [BoxFit.contain]; pinch zoom and pan then use the complete screen viewport
/// instead of a smaller padded rectangle.
class _ImageBody extends StatelessWidget {
  const _ImageBody({required this.base64, required this.mimeType});
  final String base64;
  final String mimeType;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ColoredBox(
      color: colors.surfaceContainerLowest,
      child: SizedBox.expand(
        child: InteractiveViewer(
          maxScale: 6,
          minScale: 1,
          clipBehavior: Clip.none,
          child: Image.memory(
            base64Decode(base64),
            width: double.infinity,
            height: double.infinity,
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
      ),
    );
  }
}

/// Markdown body — `MarkdownBody` (from `flutter_markdown_plus`) wrapped in a
/// `SingleChildScrollView` with `BouncingScrollPhysics`. Using `MarkdownBody`
/// instead of `Markdown` is deliberate: `Markdown` carries its own scroll
/// view + a `Column` of `Wrap`s that occasionally overflow horizontally
/// when the parent `NeTopBar` is also constrained (the wrap tries to size
/// against the constraint chain through the parent's Row, and the
/// `NeTopBar`'s actions end up off-screen with a "RenderFlex overflowed"
/// exception). `MarkdownBody` renders directly into the surrounding scroll
/// surface and stays at the correct width.
///
/// The horizontal padding (`UxnanSpacing.lg`) matches the rest of the app's
/// content surfaces so the rendered text doesn't kiss the screen edges.
class _MarkdownBody extends StatelessWidget {
  const _MarkdownBody({required this.text, required this.topInset});
  final String text;

  /// Top padding so the rendered markdown scrolls under the transparent bar.
  final double topInset;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(
        parent: AlwaysScrollableScrollPhysics(),
      ),
      padding: EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        topInset + UxnanSpacing.sm,
        UxnanSpacing.lg,
        UxnanSpacing.lg,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: UxnanSpacing.maxContentWidth,
          ),
          child: MarkdownBody(
            data: text,
            selectable: true,
            styleSheet: uxnanMarkdownStyleSheet(context),
            onTapLink: (linkText, href, title) => _onTapLink(context, href),
          ),
        ),
      ),
    );
  }

  /// Copies a tapped link's target to the clipboard (no `url_launcher`
  /// dependency — the viewer never opens an external browser on its own).
  void _onTapLink(BuildContext context, String? href) {
    if (href == null || href.isEmpty) return;
    final l10n = AppLocalizations.of(context);
    Clipboard.setData(ClipboardData(text: href));
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.fileViewerLinkCopied(href))));
  }
}

/// Plain code/text body with optional syntax highlighting. Pads the
/// content horizontally with `UxnanSpacing.lg` (matches the rest of the
/// app's content surfaces) so the text doesn't kiss the screen edges.
class _CodeBody extends StatelessWidget {
  const _CodeBody({
    required this.text,
    required this.language,
    required this.topInset,
  });
  final String text;
  final String language;

  /// Top padding so the highlighted source scrolls under the transparent bar.
  final double topInset;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final theme = isDark ? atomOneDarkTheme : atomOneLightTheme;
    return SingleChildScrollView(
      // AlwaysScrollable so the parent RefreshIndicator can be pulled even
      // when the source fits the viewport (matches the markdown body).
      physics: const BouncingScrollPhysics(
        parent: AlwaysScrollableScrollPhysics(),
      ),
      padding: EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        topInset + UxnanSpacing.sm,
        UxnanSpacing.lg,
        UxnanSpacing.lg,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: UxnanSpacing.maxContentWidth,
          ),
          child: Align(
            alignment: Alignment.topLeft,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: _SelectableHighlightView(
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
        ),
      ),
    );
  }
}

/// Syntax-highlighted source rendered through [SelectableText.rich]. The
/// `flutter_highlight` widget uses a plain `RichText`, which cannot expose the
/// platform selection/copy menu; this keeps the same parser and themes while
/// making every source range genuinely selectable.
class _SelectableHighlightView extends StatelessWidget {
  const _SelectableHighlightView(
    this.source, {
    required this.language,
    required this.theme,
    required this.textStyle,
    required this.padding,
  });

  final String source;
  final String language;
  final Map<String, TextStyle> theme;
  final TextStyle textStyle;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final rootStyle = TextStyle(color: theme['root']?.color).merge(textStyle);
    final nodes = syntax.highlight
        .parse(source.replaceAll('\t', '        '), language: language)
        .nodes;
    return Container(
      color: theme['root']?.backgroundColor,
      padding: padding,
      child: SelectableText.rich(
        TextSpan(
          style: rootStyle,
          children: _highlightSpans(nodes ?? const <syntax.Node>[]),
        ),
      ),
    );
  }

  List<TextSpan> _highlightSpans(List<syntax.Node> nodes) => [
        for (final node in nodes)
          if (node.value != null)
            TextSpan(
              text: node.value,
              style: node.className == null ? null : theme[node.className],
            )
          else
            TextSpan(
              style: node.className == null ? null : theme[node.className],
              children: _highlightSpans(node.children ?? const <syntax.Node>[]),
            ),
      ];
}

/// Inline editor: a full-height monospace [TextField] over the raw file
/// content. The buffer lives in the parent's controller so saving reads the
/// latest text. Top-padded by [topInset] so the first line clears the bar and
/// bottom-padded so the keyboard never covers the caret.
class _EditorBody extends StatelessWidget {
  const _EditorBody({required this.controller, required this.topInset});
  final TextEditingController controller;
  final double topInset;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          maxWidth: UxnanSpacing.maxContentWidth,
        ),
        child: TextField(
          controller: controller,
          maxLines: null,
          expands: true,
          autofocus: true,
          keyboardType: TextInputType.multiline,
          textAlignVertical: TextAlignVertical.top,
          style: UxnanTypography.codeBody.copyWith(color: colors.onSurface),
          cursorColor: colors.primary,
          decoration: InputDecoration(
            border: InputBorder.none,
            filled: false,
            contentPadding: EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              topInset + UxnanSpacing.sm,
              UxnanSpacing.lg,
              bottomInset + UxnanSpacing.lg,
            ),
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
      padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.lg),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: UxnanSpacing.maxContentWidth,
          ),
          child: NeCard(
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
        ),
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
      padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.lg),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: UxnanSpacing.maxContentWidth,
          ),
          child: NeCard(
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
        ),
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

/// Maps a file path to a `highlight`-package language id for syntax
/// highlighting. Resolves a handful of well-known *extensionless* filenames
/// first (Dockerfile, Makefile, …), then by extension. Unknown ids are safe:
/// the `highlight` package falls back to `plaintext` for any grammar it has
/// not registered, so a wrong/missing id never throws.
String _languageForPath(String path) {
  final lower = path.toLowerCase();
  final base = lower.split('/').last;

  // Extensionless / fixed-name files.
  if (base == 'dockerfile' || base.startsWith('dockerfile.')) {
    return 'dockerfile';
  }
  if (base == 'makefile' || base == 'gnumakefile') return 'makefile';
  if (base == 'cmakelists.txt') return 'cmake';
  if (base == '.env' || base.startsWith('.env.')) return 'bash';

  for (final entry in _languageByExtension.entries) {
    if (lower.endsWith(entry.key)) return entry.value;
  }
  // `.lock` is ambiguous (pubspec.lock is YAML, Cargo.lock is TOML→ini); YAML
  // renders both acceptably.
  if (lower.endsWith('.lock')) return 'yaml';
  return 'plaintext';
}

/// Extension → `highlight` language id. Only ids registered in the `highlight`
/// package are used; families it lacks map to a safe relative (C → `cpp`,
/// Vue/Svelte/Astro → `xml`, TOML → `ini`).
const Map<String, String> _languageByExtension = {
  '.dart': 'dart',
  '.tsx': 'typescript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.js': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.java': 'java',
  '.scala': 'scala',
  '.groovy': 'groovy',
  '.gradle': 'gradle',
  '.go': 'go',
  '.rs': 'rust',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.r': 'r',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.c': 'cpp',
  '.h': 'cpp',
  '.m': 'objectivec',
  '.mm': 'objectivec',
  '.cs': 'cs',
  '.fs': 'fsharp',
  '.vb': 'vbnet',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.vue': 'xml',
  '.svelte': 'xml',
  '.astro': 'xml',
  '.html': 'xml',
  '.htm': 'xml',
  '.xml': 'xml',
  '.xaml': 'xml',
  '.svg': 'xml',
  '.plist': 'xml',
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.properties': 'properties',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.ps1': 'powershell',
  '.bat': 'dos',
  '.cmd': 'dos',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.diff': 'diff',
  '.patch': 'diff',
  '.cmake': 'cmake',
  '.md': 'markdown',
  '.markdown': 'markdown',
};
