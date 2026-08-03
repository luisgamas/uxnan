import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:url_launcher/url_launcher.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/infrastructure/media/remote_resource_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_preview_support.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/file_diff_viewer.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/file_preview_media.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/markdown_blocks.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/markdown.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/highlighted_source.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen file viewer for images (including animated GIF and SVG), PDF,
/// Markdown, syntax-highlighted code/text, git diffs, and binary placeholders.
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

  /// Whether the current payload is editable source rather than binary media.
  bool _isEditable(FilePreviewKind kind) {
    final content = _payload?.content;
    return kind != FilePreviewKind.rasterImage &&
        kind != FilePreviewKind.pdf &&
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
    final showPreview = ref.watch(showFilePreviewProvider);
    final showDiff = ref.watch(showFileDiffProvider);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final textStyles = theme.textTheme;
    final name = node?.displayName(showExtension: showExt) ??
        widget.path.split('/').last;
    final status = node?.gitStatus;
    final kind = previewKindForPath(widget.path);
    final supportsPreview =
        kind == FilePreviewKind.markdown || kind == FilePreviewKind.svg;
    // While editing the raw buffer is the only surface — the markdown preview
    // and the diff overlay both step aside so the user edits plain source.
    final showDiffOverlay = showDiff &&
        status != null &&
        kind != FilePreviewKind.rasterImage &&
        kind != FilePreviewKind.pdf &&
        !_editing;
    final editable = _isEditable(kind);
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
            _FileViewerBody(
              payload: _payload,
              loading: _loading,
              editing: _editing,
              editController: _editController,
              manager: ref.read(fileBrowserManagerProvider),
              remoteResources: ref.read(remoteResourceServiceProvider),
              cwd: widget.cwd,
              path: widget.path,
              kind: kind,
              topInset: topInset,
              showPreview: showPreview,
              showDiffOverlay: showDiffOverlay,
              onRefresh: _load,
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
                  style: textStyles.titleLarge?.copyWith(
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
                            child: PolygonLoader(size: 20),
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
                        if (supportsPreview)
                          IconSurface(
                            icon: showPreview
                                ? Icons.code_rounded
                                : Icons.visibility_outlined,
                            tooltip: showPreview
                                ? l10n.fileViewerViewSource
                                : l10n.fileViewerViewPreview,
                            selected: showPreview,
                            onPressed: () => ref
                                .read(showFilePreviewProvider.notifier)
                                .set(value: !showPreview),
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
                        // body — matching FileBrowserScreen
                        // and GitScreen — so the appbar stays lean.
                      ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FileViewerBody extends StatelessWidget {
  const _FileViewerBody({
    required this.payload,
    required this.loading,
    required this.editing,
    required this.editController,
    required this.manager,
    required this.remoteResources,
    required this.cwd,
    required this.path,
    required this.kind,
    required this.topInset,
    required this.showPreview,
    required this.showDiffOverlay,
    required this.onRefresh,
  });

  final _ViewerPayload? payload;
  final bool loading;
  final bool editing;
  final TextEditingController editController;
  final FileBrowserManager manager;
  final RemoteResourceService remoteResources;
  final String cwd;
  final String path;
  final FilePreviewKind kind;
  final double topInset;
  final bool showPreview;
  final bool showDiffOverlay;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    if (editing) {
      return _EditorBody(controller: editController, topInset: topInset);
    }
    if (loading && payload == null) {
      return const Center(child: PolygonLoader(size: UxnanSpacing.xxl));
    }
    final current = payload;
    if (current == null) return const SizedBox.shrink();
    if (current.error case final error?) {
      return _BelowTopBar(
        topInset: topInset,
        child: _ErrorState(message: error, onRetry: onRefresh),
      );
    }

    if (kind == FilePreviewKind.rasterImage ||
        (kind == FilePreviewKind.svg && showPreview)) {
      final image = current.image;
      if (image != null) return WorkspaceImagePreview(image: image);
      return _BelowTopBar(
        topInset: topInset,
        child: _ErrorState(
          message: AppLocalizations.of(context).fileViewerMediaUnavailable,
          onRetry: onRefresh,
        ),
      );
    }

    final content = current.content;
    if (content == null) {
      return _BelowTopBar(
        topInset: topInset,
        child: _ErrorState(
          message: AppLocalizations.of(context).fileViewerMediaUnavailable,
          onRetry: onRefresh,
        ),
      );
    }
    if (kind == FilePreviewKind.pdf) {
      if (content.encoding != FileEncoding.base64) {
        return _BelowTopBar(
          topInset: topInset,
          child: _ErrorState(
            message: AppLocalizations.of(context).fileViewerPdfInvalid,
            onRetry: onRefresh,
          ),
        );
      }
      return WorkspacePdfPreview(
        base64Data: content.content,
        path: path,
        topInset: topInset,
      );
    }
    if (content.encoding == FileEncoding.base64) {
      return _BelowTopBar(
        topInset: topInset,
        child: _BinaryState(sizeBytes: content.content.length),
      );
    }

    final text = content.content;
    if (kind == FilePreviewKind.markdown && showPreview) {
      return _RefreshableBody(
        topInset: topInset,
        onRefresh: onRefresh,
        child: _MarkdownBody(
          text: text,
          topInset: topInset,
          manager: manager,
          remoteResources: remoteResources,
          cwd: cwd,
          path: path,
        ),
      );
    }
    if (showDiffOverlay && (current.diff?.isNotEmpty ?? false)) {
      return _RefreshableBody(
        topInset: topInset,
        onRefresh: onRefresh,
        child: SelectionArea(
          child: FileDiffViewer(
            diff: current.diff!,
            path: path,
            topInset: topInset,
          ),
        ),
      );
    }
    return _RefreshableBody(
      topInset: topInset,
      onRefresh: onRefresh,
      child: _CodeBody(
        text: text,
        language: _languageForPath(path),
        topInset: topInset,
      ),
    );
  }
}

class _RefreshableBody extends StatelessWidget {
  const _RefreshableBody({
    required this.topInset,
    required this.onRefresh,
    required this.child,
  });

  final double topInset;
  final Future<void> Function() onRefresh;
  final Widget child;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: onRefresh,
        edgeOffset: topInset,
        child: child,
      );
}

class _BelowTopBar extends StatelessWidget {
  const _BelowTopBar({required this.topInset, required this.child});

  final double topInset;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: topInset),
        child: child,
      );
}

Future<_ViewerPayload> _loadViewer(
  FileBrowserManager manager,
  String cwd,
  String path,
) async {
  final kind = previewKindForPath(path);
  if (kind == FilePreviewKind.rasterImage) {
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
    if (kind == FilePreviewKind.pdf) {
      return _ViewerPayload.media(content: content);
    }
    ImageFile? image;
    if (kind == FilePreviewKind.svg) {
      image = await manager.readImage(cwd, path);
    }
    String? diff;
    try {
      diff = await manager.fileDiff(cwd, path);
    } on Object {
      // No diff (not a git repo or no changes) — leave null so the viewer
      // falls back to the raw file content.
      diff = null;
    }
    return _ViewerPayload.media(content: content, image: image, diff: diff);
  } on Object catch (error) {
    return _ViewerPayload.error('$error');
  }
}

/// Result for [_loadViewer]. SVG deliberately carries both source and image.
class _ViewerPayload {
  const _ViewerPayload.media({this.content, this.image, this.diff})
      : error = null;
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
/// The renderer's syntax set: exactly the GitHub-flavored one the viewer has
/// always used (tables, strikethrough, autolinks, task lists) plus `:emoji:`
/// shortcodes.
///
/// Deliberately **not** `gitHubWeb`: that set also turns on inline-HTML
/// parsing, which silently swallows any residual `<tag>`-looking text instead
/// of showing it — a change in how every existing document parses, in exchange
/// for heading anchors this viewer does not navigate.
final _markdownExtensions = md.ExtensionSet(
  md.ExtensionSet.gitHubFlavored.blockSyntaxes,
  <md.InlineSyntax>[
    md.EmojiSyntax(),
    ...md.ExtensionSet.gitHubFlavored.inlineSyntaxes,
  ],
);

class _MarkdownBody extends StatelessWidget {
  const _MarkdownBody({
    required this.text,
    required this.topInset,
    required this.manager,
    required this.remoteResources,
    required this.cwd,
    required this.path,
  });

  final String text;
  final FileBrowserManager manager;
  final RemoteResourceService remoteResources;
  final String cwd;
  final String path;

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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final block in splitMarkdownBlocks(text))
                _blockWidget(context, block),
            ],
          ),
        ),
      ),
    );
  }

  /// Renders one document block: GitHub's two container constructs get their
  /// own chrome, everything else is Markdown rendered as before.
  Widget _blockWidget(BuildContext context, MarkdownBlock block) {
    return switch (block) {
      MarkdownTextBlock(:final text) => _markdown(context, text),
      MarkdownAlertBlock(:final kind, :final body) => MarkdownAlertCard(
          kind: kind,
          child: _markdown(context, body),
        ),
      MarkdownDetailsBlock(:final summary, :final body, :final expanded) =>
        MarkdownDetailsTile(
          summary: summary,
          initiallyExpanded: expanded,
          child: _markdown(context, body),
        ),
    };
  }

  Widget _markdown(BuildContext context, String source) {
    final colors = Theme.of(context).colorScheme;
    return MarkdownBody(
      data: normalizeReadmeHtml(source),
      selectable: true,
      styleSheet: uxnanMarkdownStyleSheet(context),
      extensionSet: _markdownExtensions,
      builders: {'pre': MarkdownCodeBlockBuilder()},
      checkboxBuilder: (checked) => Padding(
        padding: const EdgeInsets.only(right: UxnanSpacing.xs),
        child: Icon(
          checked
              ? Icons.check_box_rounded
              : Icons.check_box_outline_blank_rounded,
          size: UxnanSpacing.lg,
          color: checked ? colors.primary : colors.onSurfaceVariant,
        ),
      ),
      imageBuilder: (uri, title, alt) => MarkdownResourceImage(
        key: ValueKey('$path::$uri'),
        manager: manager,
        remoteResources: remoteResources,
        cwd: cwd,
        documentPath: path,
        uri: uri,
        title: title,
      ),
      onTapLink: (linkText, href, title) =>
          unawaited(_onTapLink(context, href)),
    );
  }

  Future<void> _onTapLink(BuildContext context, String? href) async {
    if (href == null || href.isEmpty) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);

    switch (resolveMarkdownLinkAction(path, href)) {
      case OpenWorkspaceFile(:final path):
        await FileViewerScreen.push(context, cwd: cwd, path: path);
        return;
      case OpenExternalLink(:final uri):
        try {
          if (await launchUrl(uri, mode: LaunchMode.externalApplication)) {
            return;
          }
        } on Object catch (error, stackTrace) {
          AppLogger.warn('Failed to open a Markdown link', error, stackTrace);
        }
      case CopyLinkTarget():
        break;
    }
    // Anything the OS would not take — an in-page anchor, an unusual scheme, a
    // device with no handler — still lands on the clipboard rather than
    // silently doing nothing.
    await Clipboard.setData(ClipboardData(text: href));
    messenger
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
              child: HighlightedSource(source: text, language: language),
            ),
          ),
        ),
      ),
    );
  }
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
