import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uxnan/domain/entities/agent_view_page.dart';
import 'package:uxnan/domain/value_objects/agent_view.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/composer_handoff_provider.dart';
import 'package:uxnan/presentation/screens/conversation/messages/view_host_session.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

/// Inline card hosting a bridge-prepared page in an isolated WebView.
class ViewBlock extends ConsumerStatefulWidget {
  const ViewBlock({required this.content, this.threadId, super.key});

  final ViewContent content;
  final String? threadId;

  @override
  ConsumerState<ViewBlock> createState() => _ViewBlockState();
}

class _ViewBlockState extends ConsumerState<ViewBlock> {
  static final Set<_ViewBlockState> _liveInline = {};
  static const int _maxLiveInline = 3;
  AgentViewPage? _page;
  WebViewController? _controller;
  Object? _error;
  int _height = viewDefaultHeight;
  bool _annotating = false;
  bool _busy = false;
  bool _creating = false;
  ViewHostSession? _session;
  late final ValueNotifier<ViewAnnotationNotes> _notes;
  Map<String, Object?>? _lastContext;

  @override
  void initState() {
    super.initState();
    _notes = ValueNotifier(const ViewAnnotationNotes());
    _notes.addListener(_syncInlineMarks);
    _height = clampViewHeight(widget.content.height);
    _load();
  }

  @override
  void didUpdateWidget(covariant ViewBlock oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.content.viewId != widget.content.viewId) {
      _release();
      _controller = null;
      _page = null;
      _error = null;
      _load();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = _hostContext(context, fullscreen: false);
    if (_lastContext != null && jsonEncode(next) != jsonEncode(_lastContext)) {
      _lastContext = next;
      _sendHostMessage(_session?.contextChanged(next));
    } else {
      _lastContext = next;
    }
  }

  @override
  void dispose() {
    _release();
    _notes.removeListener(_syncInlineMarks);
    _notes.dispose();
    super.dispose();
  }

  void _release() {
    _liveInline.remove(this);
    _controller = null;
  }

  void _syncInlineMarks() {
    unawaited(_sendAnnotations(_controller, _session, _notes.value));
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final page = await ref
          .read(agentViewRepositoryProvider)
          .readView(widget.content.viewId);
      if (!mounted) return;
      setState(() {
        _page = page;
        _busy = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _busy = false;
      });
    }
  }

  Future<void> _mountWebView({required bool fullscreen}) async {
    final page = _page;
    if (page == null || _controller != null || _creating) return;
    if (!fullscreen &&
        !_liveInline.contains(this) &&
        _liveInline.length >= _maxLiveInline) {
      return;
    }
    _creating = true;
    if (!fullscreen) _liveInline.add(this);
    try {
      final session = ViewHostSession(viewId: page.viewId, title: page.title);
      final controller = WebViewController();
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      if (controller.platform is AndroidWebViewController) {
        final android = controller.platform as AndroidWebViewController;
        await android.setAllowFileAccess(false);
        await android.setAllowContentAccess(false);
        await android.enableZoom(false);
      }
      await controller.setBackgroundColor(Colors.transparent);
      await controller.addJavaScriptChannel(
        'UxnanView',
        onMessageReceived: (message) =>
            _handlePageMessage(session, message.message),
      );
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: viewNavigationDecision,
          onWebResourceError: (error) {
            if (!mounted || error.isForMainFrame != true) return;
            _release();
            setState(() {
              _controller = null;
              _session = null;
              _error = StateError('The view could not be rendered.');
            });
          },
        ),
      );
      _session = session;
      _controller = controller;
      await controller.loadHtmlString(page.html);
      if (!mounted) return;
      await _sendAnnotations(controller, session, _notes.value);
      if (!fullscreen) {
        await controller.runJavaScript(
          'document.documentElement.style.overflow="hidden";'
          'document.body.style.overflow="hidden";',
        );
      }
      setState(() => _creating = false);
    } on Object catch (error) {
      _liveInline.remove(this);
      if (!mounted) return;
      setState(() {
        _creating = false;
        _controller = null;
        _error = error;
      });
    }
  }

  Future<void> _handlePageMessage(ViewHostSession session, String raw) async {
    await _handleViewMessage(
      context: context,
      ref: ref,
      session: session,
      raw: raw,
      threadId: widget.threadId,
      annotating: _annotating,
      notes: _notes,
      sendToPage: (message) async {
        final json = jsonEncode(message);
        await _controller?.runJavaScript('window.__uxnanHost($json)');
      },
      hostContext: _hostContext(context, fullscreen: false),
      confirmOpenLink: _confirmOpenLink,
      sizeChanged: (height) {
        if (mounted && !_annotating) {
          setState(() => _height = clampViewHeight(height));
        }
      },
    );
  }

  Future<bool> _confirmOpenLink(Uri uri) async {
    if (!mounted) return false;
    return _confirmViewOpenLink(context, uri);
  }

  Map<String, Object?> _hostContext(
    BuildContext context, {
    required bool fullscreen,
  }) =>
      _viewHostContext(context, fullscreen: fullscreen);

  Future<void> _sendHostMessage(Map<String, Object?>? message) async {
    if (message == null) return;
    await _controller
        ?.runJavaScript('window.__uxnanHost(${jsonEncode(message)})');
  }

  Future<void> _toggleAnnotation() async {
    setState(() => _annotating = !_annotating);
    await _sendHostMessage(_session?.annotateMode(on: _annotating));
  }

  Future<void> _expand() async {
    final page = _page;
    if (page == null) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => _FullscreenView(
          page: page,
          threadId: widget.threadId,
          notes: _notes,
        ),
      ),
    );
  }

  Future<void> _addNotesToMessage() async {
    final threadId = widget.threadId;
    if (threadId == null || _notes.value.items.isEmpty) return;
    ref.read(composerHandoffsProvider.notifier).offerText(
          threadId,
          formatViewAnnotations(widget.content.title, _notes.value.items),
        );
    _notes.value = _notes.value.discard();
    setState(() => _annotating = false);
    await _sendHostMessage(_session?.annotateMode(on: false));
    await _sendAnnotations(_controller, _session, _notes.value);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppLocalizations.of(context).conversationViewAddedToComposer,
          ),
        ),
      );
    }
  }

  Future<void> _discardNotes() async {
    _notes.value = _notes.value.discard();
    await _sendAnnotations(_controller, _session, _notes.value);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final border = BorderRadius.circular(24);
    final full = _controller != null;
    final maxed =
        _liveInline.length >= _maxLiveInline && !_liveInline.contains(this);
    if (_page != null &&
        !full &&
        !maxed &&
        !_creating &&
        !_busy &&
        _error == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _mountWebView(fullscreen: false);
      });
    }
    return Card(
      color: colors.surfaceContainerLow,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: border,
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.md,
              UxnanSpacing.sm,
              UxnanSpacing.sm,
              UxnanSpacing.sm,
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.content.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: textTheme.titleSmall,
                      ),
                    ),
                    IconButton(
                      tooltip: _annotating
                          ? AppLocalizations.of(context)
                              .conversationViewStopAnnotating
                          : AppLocalizations.of(context)
                              .conversationViewAnnotate,
                      onPressed: _controller == null ? null : _toggleAnnotation,
                      icon: UxIcon(
                        _annotating ? UxIcons.close : UxIcons.edit,
                        size: 20,
                      ),
                    ),
                    IconButton(
                      tooltip:
                          AppLocalizations.of(context).conversationViewExpand,
                      onPressed: _page == null ? null : _expand,
                      icon: const UxIcon(UxIcons.openInNew, size: 20),
                    ),
                  ],
                ),
                ViewNotesHeader(
                  notes: _notes,
                  onAddToMessage:
                      widget.threadId == null ? null : _addNotesToMessage,
                  onDiscard: _discardNotes,
                ),
              ],
            ),
          ),
          SizedBox(
            height: _height.toDouble(),
            child: _error != null
                ? _ViewError(onRetry: _load)
                : _busy
                    ? const Center(child: PolygonLoader(size: 28))
                    : _page == null
                        ? const SizedBox.shrink()
                        : full
                            ? WebViewWidget(controller: _controller!)
                            : maxed
                                ? _TapToLoad(
                                    onTap: () =>
                                        _mountWebView(fullscreen: false),
                                  )
                                : _TapToLoad(
                                    onTap: () =>
                                        _mountWebView(fullscreen: false),
                                  ),
          ),
        ],
      ),
    );
  }
}

/// Compact card-header actions for a view's pending notes.
class ViewNotesHeader extends StatelessWidget {
  const ViewNotesHeader({
    required this.notes,
    required this.onAddToMessage,
    required this.onDiscard,
    super.key,
  });

  final ValueListenable<ViewAnnotationNotes> notes;
  final VoidCallback? onAddToMessage;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return ValueListenableBuilder<ViewAnnotationNotes>(
      valueListenable: notes,
      builder: (context, value, _) {
        if (value.items.isEmpty) return const SizedBox.shrink();
        final l10n = AppLocalizations.of(context);
        return Row(
          children: [
            Expanded(
              child: Text(
                l10n.conversationViewNotesCount(value.items.length),
                style: textTheme.labelMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
            TextButton(
              onPressed: onAddToMessage,
              child: Text(l10n.conversationViewAddToMessage),
            ),
            TextButton(
              onPressed: onDiscard,
              child: Text(l10n.conversationViewDiscardNotes),
            ),
          ],
        );
      },
    );
  }
}

class _FullscreenView extends ConsumerStatefulWidget {
  const _FullscreenView({
    required this.page,
    required this.threadId,
    required this.notes,
  });
  final AgentViewPage page;
  final String? threadId;
  final ValueNotifier<ViewAnnotationNotes> notes;

  @override
  ConsumerState<_FullscreenView> createState() => _FullscreenViewState();
}

class _FullscreenViewState extends ConsumerState<_FullscreenView> {
  WebViewController? _controller;
  late final ViewHostSession _session;
  bool _annotating = false;
  Map<String, Object?>? _lastContext;

  @override
  void initState() {
    super.initState();
    _session =
        ViewHostSession(viewId: widget.page.viewId, title: widget.page.title);
    _create();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final host = _fullscreenContext(context);
    if (_lastContext != null && jsonEncode(host) != jsonEncode(_lastContext)) {
      _send(_session.contextChanged(host));
    }
    _lastContext = host;
  }

  Future<void> _create() async {
    final controller = WebViewController();
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    if (controller.platform is AndroidWebViewController) {
      final android = controller.platform as AndroidWebViewController;
      await android.setAllowFileAccess(false);
      await android.setAllowContentAccess(false);
      await android.enableZoom(false);
    }
    await controller.setBackgroundColor(Colors.transparent);
    await controller.addJavaScriptChannel(
      'UxnanView',
      onMessageReceived: (message) => _handleMessage(message.message),
    );
    await controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: viewNavigationDecision,
      ),
    );
    _controller = controller;
    await controller.loadHtmlString(widget.page.html);
    await _sendAnnotations(controller, _session, widget.notes.value);
    if (mounted) setState(() {});
  }

  Future<void> _handleMessage(String raw) => _handleViewMessage(
        context: context,
        ref: ref,
        session: _session,
        raw: raw,
        threadId: widget.threadId,
        annotating: _annotating,
        notes: widget.notes,
        sendToPage: _send,
        hostContext: _fullscreenContext(context),
        confirmOpenLink: (uri) => _confirmViewOpenLink(context, uri),
        sizeChanged: (_) {},
      );

  Future<void> _send(Map<String, Object?> message) async {
    await _controller
        ?.runJavaScript('window.__uxnanHost(${jsonEncode(message)})');
  }

  Map<String, Object?> _fullscreenContext(BuildContext context) =>
      _viewHostContext(context, fullscreen: true);

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(widget.page.title),
          actions: [
            IconButton(
              tooltip: _annotating
                  ? AppLocalizations.of(context).conversationViewStopAnnotating
                  : AppLocalizations.of(context).conversationViewAnnotate,
              onPressed: () {
                setState(() => _annotating = !_annotating);
                _send(_session.annotateMode(on: _annotating));
              },
              icon: const UxIcon(UxIcons.edit, size: 20),
            ),
          ],
        ),
        body: _controller == null
            ? const Center(child: PolygonLoader(size: 32))
            : WebViewWidget(controller: _controller!),
      );
}

Future<bool> _confirmViewOpenLink(BuildContext context, Uri uri) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(AppLocalizations.of(context).conversationViewLinkTitle),
      content: Text(uri.toString()),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text(AppLocalizations.of(context).conversationViewLinkCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text(AppLocalizations.of(context).conversationViewLinkOpen),
        ),
      ],
    ),
  );
  return (confirmed ?? false) &&
      await launchUrl(uri, mode: LaunchMode.externalApplication);
}

class _TapToLoad extends StatelessWidget {
  const _TapToLoad({required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Center(
        child: TextButton.icon(
          onPressed: onTap,
          icon: const UxIcon(UxIcons.openInNew, size: 20),
          label: Text(
            AppLocalizations.of(context).conversationViewLoadInteractive,
          ),
        ),
      );
}

class _ViewError extends StatelessWidget {
  const _ViewError({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
        child: TextButton.icon(
          onPressed: onRetry,
          icon: const UxIcon(UxIcons.refresh, size: 20),
          label: Text(
            AppLocalizations.of(context).conversationViewCouldNotLoadRetry,
          ),
        ),
      );
}

/// The only navigation a view's WebView takes: loading its own document,
/// which a platform may report as `about:blank` (WKWebView asks for the
/// `loadHtmlString` load too). Every other request — a link, a form, a
/// script setting `location` — is refused; links go through `ui/open-link`.
NavigationDecision viewNavigationDecision(NavigationRequest request) =>
    request.isMainFrame && request.url.startsWith('about:')
        ? NavigationDecision.navigate
        : NavigationDecision.prevent;

Future<void> _handleViewMessage({
  required BuildContext context,
  required WidgetRef ref,
  required ViewHostSession session,
  required String raw,
  required String? threadId,
  required bool annotating,
  required ValueNotifier<ViewAnnotationNotes> notes,
  required Future<void> Function(Map<String, Object?> message) sendToPage,
  required Map<String, Object?> hostContext,
  required Future<bool> Function(Uri uri) confirmOpenLink,
  required void Function(double height) sizeChanged,
}) async {
  Future<void> editNote(int index) async {
    if (index < 0 || index >= notes.value.items.length) return;
    await _editViewNote(
      context: context,
      session: session,
      notes: notes,
      annotation: notes.value.items[index].annotation,
      index: index,
      sendToPage: sendToPage,
    );
  }

  await session.handle(
    // Each WebView reaches this same handler, sheet and notes model.
    // Requests remain validated by the pure session before any UI callback.
    raw,
    hostContext: hostContext,
    sendToPage: sendToPage,
    confirmOpenLink: confirmOpenLink,
    offerMessage: (text) async {
      if (threadId == null) return;
      ref.read(composerHandoffsProvider.notifier).offerText(threadId, text);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppLocalizations.of(context).conversationViewAddedToComposer,
          ),
        ),
      );
    },
    annotate: (annotation) async {
      if (!annotating) return;
      final existingIndex = notes.value.items.indexWhere(
        (entry) => entry.annotation.selector == annotation.selector,
      );
      await _editViewNote(
        context: context,
        session: session,
        notes: notes,
        annotation: annotation,
        index: existingIndex < 0 ? null : existingIndex,
        sendToPage: sendToPage,
      );
    },
    annotationCount: () => notes.value.items.length,
    mark: editNote,
    sizeChanged: sizeChanged,
  );
}

Future<void> _editViewNote({
  required BuildContext context,
  required ViewHostSession session,
  required ValueNotifier<ViewAnnotationNotes> notes,
  required ViewAnnotation annotation,
  required int? index,
  required Future<void> Function(Map<String, Object?> message) sendToPage,
}) async {
  final noteIndex = index ?? notes.value.items.length;
  try {
    final result = await showViewAnnotationSheet(
      context,
      annotation,
      number: noteIndex + 1,
      initialNote: index == null ? '' : notes.value.items[index].note,
      canDelete: index != null,
    );
    if (!context.mounted || result == null) return;
    switch (result.action) {
      case ViewAnnotationSheetAction.save:
        notes.value = index == null
            ? notes.value.add(annotation, result.note)
            : notes.value.edit(index, result.note);
      case ViewAnnotationSheetAction.delete:
        if (index != null) notes.value = notes.value.delete(index);
    }
  } finally {
    // A pick holds its element until the sheet closes, including a dismissal.
    await sendToPage(session.annotations(notes.value.marks));
  }
}

Future<void> _sendAnnotations(
  WebViewController? controller,
  ViewHostSession? session,
  ViewAnnotationNotes notes,
) async {
  if (controller == null || session == null) return;
  await controller.runJavaScript(
    'window.__uxnanHost(${jsonEncode(session.annotations(notes.marks))})',
  );
}

Map<String, Object?> _viewHostContext(
  BuildContext context, {
  required bool fullscreen,
}) {
  final colors = Theme.of(context).colorScheme;
  final dark = Theme.of(context).brightness == Brightness.dark;
  String hex(Color color) =>
      '#${color.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}';
  return {
    'theme': dark ? 'dark' : 'light',
    'displayMode': fullscreen ? 'fullscreen' : 'inline',
    'platform': 'mobile',
    'locale': Localizations.localeOf(context).toLanguageTag(),
    'styles': {
      'variables': {
        '--color-background-primary': hex(colors.surface),
        '--color-background-secondary': hex(colors.surfaceContainer),
        '--color-text-primary': hex(colors.onSurface),
        '--color-text-secondary': hex(colors.onSurfaceVariant),
        '--color-border-primary': hex(colors.outlineVariant),
        '--color-ring-primary': hex(colors.primary),
        '--color-background-info': hex(colors.secondaryContainer),
        '--color-background-danger': hex(colors.errorContainer),
        '--color-background-success': hex(colors.tertiaryContainer),
        '--color-background-warning': hex(colors.tertiaryContainer),
        '--font-sans': UxnanTypography.fontFamily,
        '--font-mono': UxnanTypography.monoFontFamily,
        '--border-radius-sm': '8px',
        '--border-radius-md': '14px',
        '--border-radius-lg': '20px',
      },
    },
  };
}

enum ViewAnnotationSheetAction { save, delete }

class ViewAnnotationSheetResult {
  const ViewAnnotationSheetResult(this.action, [this.note = '']);
  final ViewAnnotationSheetAction action;
  final String note;
}

/// Asks for a note on a picked element or edits an existing note.
Future<ViewAnnotationSheetResult?> showViewAnnotationSheet(
  BuildContext context,
  ViewAnnotation annotation, {
  required int number,
  required String initialNote,
  required bool canDelete,
}) =>
    showModalBottomSheet<ViewAnnotationSheetResult>(
      context: context,
      isScrollControlled: true,
      useRootNavigator: true,
      builder: (_) => _ViewAnnotationSheet(
        annotation: annotation,
        number: number,
        initialNote: initialNote,
        canDelete: canDelete,
      ),
    );

/// The note sheet. It owns its text controller, so the controller lives until
/// the route has finished closing — disposing it when the sheet's future
/// completes tore it down mid-animation, while the field still listened.
class _ViewAnnotationSheet extends StatefulWidget {
  const _ViewAnnotationSheet({
    required this.annotation,
    required this.number,
    required this.initialNote,
    required this.canDelete,
  });

  final ViewAnnotation annotation;
  final int number;
  final String initialNote;
  final bool canDelete;

  @override
  State<_ViewAnnotationSheet> createState() => _ViewAnnotationSheetState();
}

class _ViewAnnotationSheetState extends State<_ViewAnnotationSheet> {
  late final TextEditingController _note;

  @override
  void initState() {
    super.initState();
    _note = TextEditingController(text: widget.initialNote);
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = widget.annotation.text;
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.lg,
        UxnanSpacing.lg,
        MediaQuery.viewInsetsOf(context).bottom + UxnanSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${l10n.conversationViewNote(widget.number)} · '
            '${widget.annotation.tag}',
            style: textTheme.titleMedium,
          ),
          if (text != null && text.isNotEmpty) ...[
            const SizedBox(height: UxnanSpacing.sm),
            Text(text, maxLines: 3, overflow: TextOverflow.ellipsis),
          ],
          const SizedBox(height: UxnanSpacing.md),
          TextField(
            controller: _note,
            autofocus: true,
            maxLength: 500,
          ),
          Row(
            children: [
              if (widget.canDelete)
                TextButton(
                  onPressed: () => Navigator.pop(
                    context,
                    const ViewAnnotationSheetResult(
                      ViewAnnotationSheetAction.delete,
                    ),
                  ),
                  child: Text(
                    l10n.conversationViewDelete,
                    style: TextStyle(color: colors.error),
                  ),
                ),
              const Spacer(),
              FilledButton(
                onPressed: () => Navigator.pop(
                  context,
                  ViewAnnotationSheetResult(
                    ViewAnnotationSheetAction.save,
                    _note.text,
                  ),
                ),
                child: Text(l10n.conversationViewSaveNote),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
