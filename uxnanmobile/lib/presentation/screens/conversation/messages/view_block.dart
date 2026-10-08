import 'dart:convert';

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
  Map<String, Object?>? _lastContext;

  @override
  void initState() {
    super.initState();
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
    super.dispose();
  }

  void _release() {
    _liveInline.remove(this);
    _controller = null;
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
    await session.handle(
      raw,
      hostContext: _hostContext(context, fullscreen: false),
      sendToPage: (message) async {
        final json = jsonEncode(message);
        await _controller?.runJavaScript('window.__uxnanHost($json)');
      },
      confirmOpenLink: _confirmOpenLink,
      offerMessage: (text) async {
        final threadId = widget.threadId;
        if (threadId != null && mounted) {
          ref.read(composerHandoffsProvider.notifier).offerText(threadId, text);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                AppLocalizations.of(context).conversationViewAddedToComposer,
              ),
            ),
          );
        }
      },
      annotate: (annotation) =>
          _annotating ? _requestAnnotation(annotation) : Future<void>.value(),
      sizeChanged: (height) {
        if (mounted && !_annotating) {
          setState(() => _height = clampViewHeight(height));
        }
      },
    );
  }

  Future<bool> _confirmOpenLink(Uri uri) async {
    if (!mounted) return false;
    final open = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppLocalizations.of(context).conversationViewLinkTitle),
        content:
            Text(uri.toString(), maxLines: 3, overflow: TextOverflow.ellipsis),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child:
                Text(AppLocalizations.of(context).conversationViewLinkCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(AppLocalizations.of(context).conversationViewLinkOpen),
          ),
        ],
      ),
    );
    if (open != true) return false;
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _requestAnnotation(ViewAnnotation annotation) async {
    if (!mounted || widget.threadId == null) return;
    final note = await showViewAnnotationSheet(context, annotation);
    if (note == null || !mounted) return;
    final text = formatViewAnnotations(
      widget.content.title,
      [(annotation: annotation, note: note)],
    );
    ref
        .read(composerHandoffsProvider.notifier)
        .offerText(widget.threadId!, text);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          AppLocalizations.of(context).conversationViewAddedToComposer,
        ),
      ),
    );
  }

  Map<String, Object?> _hostContext(
    BuildContext context, {
    required bool fullscreen,
  }) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final vars = <String, String>{
      '--color-background-primary': _hex(colors.surface),
      '--color-background-secondary': _hex(colors.surfaceContainer),
      '--color-text-primary': _hex(colors.onSurface),
      '--color-text-secondary': _hex(colors.onSurfaceVariant),
      '--color-border-primary': _hex(colors.outlineVariant),
      '--color-ring-primary': _hex(colors.primary),
      '--color-background-info': _hex(colors.secondaryContainer),
      '--color-background-danger': _hex(colors.errorContainer),
      '--color-background-success': _hex(colors.tertiaryContainer),
      '--color-background-warning': _hex(colors.tertiaryContainer),
      '--font-sans': UxnanTypography.fontFamily,
      '--font-mono': UxnanTypography.monoFontFamily,
      '--border-radius-sm': '8px',
      '--border-radius-md': '14px',
      '--border-radius-lg': '20px',
    };
    return {
      'theme': dark ? 'dark' : 'light',
      'styles': {'variables': vars},
      'displayMode': fullscreen ? 'fullscreen' : 'inline',
      'platform': 'mobile',
      'locale': Localizations.localeOf(context).toLanguageTag(),
    };
  }

  String _hex(Color color) =>
      '#${color.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}';

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
        ),
      ),
    );
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
            child: Row(
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
                      : AppLocalizations.of(context).conversationViewAnnotate,
                  onPressed: _controller == null ? null : _toggleAnnotation,
                  icon: UxIcon(
                    _annotating ? UxIcons.close : UxIcons.edit,
                    size: 20,
                  ),
                ),
                IconButton(
                  tooltip: AppLocalizations.of(context).conversationViewExpand,
                  onPressed: _page == null ? null : _expand,
                  icon: const UxIcon(UxIcons.openInNew, size: 20),
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

class _FullscreenView extends ConsumerStatefulWidget {
  const _FullscreenView({
    required this.page,
    required this.threadId,
  });
  final AgentViewPage page;
  final String? threadId;

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
    if (mounted) setState(() {});
  }

  Future<void> _handleMessage(String raw) => _session.handle(
        raw,
        hostContext: _fullscreenContext(context),
        sendToPage: _send,
        confirmOpenLink: (uri) async {
          final confirmed = await showDialog<bool>(
            context: context,
            builder: (context) => AlertDialog(
              title:
                  Text(AppLocalizations.of(context).conversationViewLinkTitle),
              content: Text(uri.toString()),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: Text(
                    AppLocalizations.of(context).conversationViewLinkCancel,
                  ),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: Text(
                    AppLocalizations.of(context).conversationViewLinkOpen,
                  ),
                ),
              ],
            ),
          );
          return (confirmed ?? false) &&
              await launchUrl(uri, mode: LaunchMode.externalApplication);
        },
        offerMessage: (text) async {
          final threadId = widget.threadId;
          if (threadId != null) {
            ref
                .read(composerHandoffsProvider.notifier)
                .offerText(threadId, text);
          }
        },
        annotate: (annotation) =>
            _annotating ? _annotate(annotation) : Future<void>.value(),
        sizeChanged: (_) {},
      );

  Future<void> _annotate(ViewAnnotation annotation) async {
    final threadId = widget.threadId;
    if (threadId == null) return;
    final note = await showViewAnnotationSheet(context, annotation);
    if (note == null || !mounted) return;
    ref.read(composerHandoffsProvider.notifier).offerText(
          threadId,
          formatViewAnnotations(
            widget.page.title,
            [(annotation: annotation, note: note)],
          ),
        );
  }

  Future<void> _send(Map<String, Object?> message) async {
    await _controller
        ?.runJavaScript('window.__uxnanHost(${jsonEncode(message)})');
  }

  Map<String, Object?> _fullscreenContext(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    String color(Color value) =>
        '#${value.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}';
    return {
      'theme': dark ? 'dark' : 'light',
      'displayMode': 'fullscreen',
      'platform': 'mobile',
      'locale': Localizations.localeOf(context).toLanguageTag(),
      'styles': {
        'variables': {
          '--color-background-primary': color(scheme.surface),
          '--color-background-secondary': color(scheme.surfaceContainer),
          '--color-text-primary': color(scheme.onSurface),
          '--color-text-secondary': color(scheme.onSurfaceVariant),
          '--color-border-primary': color(scheme.outlineVariant),
          '--color-ring-primary': color(scheme.primary),
          '--color-background-info': color(scheme.secondaryContainer),
          '--color-background-danger': color(scheme.errorContainer),
          '--color-background-success': color(scheme.tertiaryContainer),
          '--color-background-warning': color(scheme.tertiaryContainer),
          '--font-sans': UxnanTypography.fontFamily,
          '--font-mono': UxnanTypography.monoFontFamily,
          '--border-radius-sm': '8px',
          '--border-radius-md': '14px',
          '--border-radius-lg': '20px',
        },
      },
    };
  }

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

class _TapToLoad extends StatelessWidget {
  const _TapToLoad({required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Center(
        child: TextButton.icon(
          onPressed: onTap,
          icon: const Icon(Icons.touch_app),
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
          icon: const Icon(Icons.refresh),
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

/// Asks for the note on an element the person picked in a view (inline and
/// full screen alike) and resolves with it, or null when dismissed.
Future<String?> showViewAnnotationSheet(
  BuildContext context,
  ViewAnnotation annotation,
) =>
    showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ViewAnnotationSheet(annotation: annotation),
    );

/// The note sheet. It owns its text controller, so the controller lives until
/// the route has finished closing — disposing it when the sheet's future
/// completes tore it down mid-animation, while the field still listened.
class _ViewAnnotationSheet extends StatefulWidget {
  const _ViewAnnotationSheet({required this.annotation});

  final ViewAnnotation annotation;

  @override
  State<_ViewAnnotationSheet> createState() => _ViewAnnotationSheetState();
}

class _ViewAnnotationSheetState extends State<_ViewAnnotationSheet> {
  final TextEditingController _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = widget.annotation.text;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.conversationViewAnnotationFor(widget.annotation.tag),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (text != null && text.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(text, maxLines: 3, overflow: TextOverflow.ellipsis),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            autofocus: true,
            maxLength: 500,
            decoration: InputDecoration(
              labelText: l10n.conversationViewAnnotationPrompt,
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: () => Navigator.pop(context, _note.text),
              child: Text(l10n.conversationViewAnnotationAdd),
            ),
          ),
        ],
      ),
    );
  }
}
