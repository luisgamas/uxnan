import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// The theme-import editor and the export choice sheet.
///
/// **Import is a full-screen editor** (`ThemeImportScreen`), not a sheet:
/// pasting/reviewing a large multi-theme JSON needs room (a capped sheet
/// overflowed), and it's a fill→confirm task, so it mirrors the app's
/// Neural Expressive form pattern (à la `ManualCodeScreen`) — a transparent
/// `NeTopBar` with a Close Icon Surface, the paste field filling the screen,
/// the alternative sources on one row, and a bottom full-width primary CTA.
///
/// Import accepts three sources — all resolve to the same JSON text the caller
/// parses: **paste**, **a `.json` file** (`file_picker`), and **an http(s)
/// URL** (`dio`). Export stays a small bottom sheet (copy vs save-to-file).

/// Opens the full-screen theme-import editor. Returns the JSON text to import,
/// or null if the user cancelled.
Future<String?> showThemeImportEditor(
  BuildContext context, {
  required String title,
  required String body,
  required String hint,
}) {
  return Navigator.of(context).push<String>(
    MaterialPageRoute<String>(
      builder: (_) => ThemeImportScreen(title: title, body: body, hint: hint),
    ),
  );
}

/// What the user picked in [showThemeExportSheet]: copy the JSON to the
/// clipboard, or save it to a file through the platform share sheet.
enum ThemeExportChoice {
  /// Copy the JSON to the system clipboard.
  copy,

  /// Save the JSON to a file via the native share sheet.
  file,
}

/// Opens a small bottom sheet offering *copy to clipboard* or *save to file*.
/// Returns the chosen action, or null if dismissed.
Future<ThemeExportChoice?> showThemeExportSheet(
  BuildContext context, {
  required String title,
  required String copyLabel,
  required String fileLabel,
}) {
  return showModalBottomSheet<ThemeExportChoice>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => _ExportChoiceSheet(
      title: title,
      copyLabel: copyLabel,
      fileLabel: fileLabel,
    ),
  );
}

/// Distinguishes a "bad URL / bad file" from a network/read failure so the UI
/// can show the right message.
class _ThemeSourceException implements Exception {
  const _ThemeSourceException({required this.invalidInput});

  /// True when the user's input was malformed (bad URL); false for a
  /// network/read failure.
  final bool invalidInput;
}

/// Picks a `.json` file and returns its UTF-8 text, or null if the user
/// cancelled. Throws [_ThemeSourceException] if the file can't be read.
Future<String?> _pickThemeJsonFile() async {
  final FilePickerResult? result;
  try {
    result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['json'],
      withData: true,
    );
  } on Object {
    throw const _ThemeSourceException(invalidInput: false);
  }
  if (result == null || result.files.isEmpty) return null; // cancelled
  final bytes = result.files.first.bytes;
  if (bytes == null) throw const _ThemeSourceException(invalidInput: false);
  try {
    return utf8.decode(bytes);
  } on Object {
    throw const _ThemeSourceException(invalidInput: false);
  }
}

/// Fetches theme JSON from an http(s) [url] as plain text. Throws
/// [_ThemeSourceException] (invalid URL, or network failure / too large).
Future<String> _fetchThemeJsonFromUrl(String url) async {
  final uri = Uri.tryParse(url.trim());
  if (uri == null ||
      !(uri.isScheme('https') || uri.isScheme('http')) ||
      uri.host.isEmpty) {
    throw const _ThemeSourceException(invalidInput: true);
  }
  final dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
      responseType: ResponseType.plain,
    ),
  );
  try {
    final res = await dio.getUri<String>(uri);
    final data = res.data ?? '';
    if (data.length > 5 * 1024 * 1024) {
      // Guard against a huge response OOMing the app.
      throw const _ThemeSourceException(invalidInput: false);
    }
    return data;
  } on _ThemeSourceException {
    rethrow;
  } on Object {
    throw const _ThemeSourceException(invalidInput: false);
  }
}

/// Prompts for an http(s) URL to fetch a theme JSON from. Returns the URL, or
/// null if cancelled.
Future<String?> _promptThemeUrl(BuildContext context) {
  final l10n = AppLocalizations.of(context);
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(l10n.themeImportUrlTitle),
      content: TextField(
        controller: controller,
        autofocus: true,
        keyboardType: TextInputType.url,
        autocorrect: false,
        decoration: InputDecoration(hintText: l10n.themeImportUrlHint),
        onSubmitted: (v) => Navigator.of(ctx).pop(v.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(),
          child: Text(l10n.actionCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
          child: Text(l10n.themeImportUrlFetch),
        ),
      ],
    ),
  );
}

/// The full-screen theme-import editor: a paste field that fills the screen, an
/// alternative-sources row (file / URL), and a bottom full-width Import CTA.
class ThemeImportScreen extends StatefulWidget {
  /// Creates a [ThemeImportScreen].
  const ThemeImportScreen({
    required this.title,
    required this.body,
    required this.hint,
    super.key,
  });

  /// Screen title.
  final String title;

  /// One-line explanation under the top bar.
  final String body;

  /// Hint text for the empty paste field.
  final String hint;

  @override
  State<ThemeImportScreen> createState() => _ThemeImportScreenState();
}

class _ThemeImportScreenState extends State<ThemeImportScreen> {
  final TextEditingController _controller = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_onTextChanged)
      ..dispose();
    super.dispose();
  }

  void _onTextChanged() => setState(() {});

  Future<void> _fromFile() async {
    final l10n = AppLocalizations.of(context);
    setState(() => _error = null);
    try {
      final text = await _pickThemeJsonFile();
      if (text == null || !mounted) return; // cancelled
      _controller.text = text;
    } on _ThemeSourceException {
      if (mounted) setState(() => _error = l10n.themeImportFileError);
    }
  }

  Future<void> _fromUrl() async {
    final l10n = AppLocalizations.of(context);
    final url = await _promptThemeUrl(context);
    if (url == null || url.isEmpty || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final text = await _fetchThemeJsonFromUrl(url);
      if (mounted) _controller.text = text;
    } on _ThemeSourceException catch (e) {
      final message = e.invalidInput
          ? l10n.themeImportUrlInvalid
          : l10n.themeImportUrlError;
      if (mounted) setState(() => _error = message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final canImport = _controller.text.trim().isNotEmpty;

    // NE form pattern (à la ManualCodeScreen): a transparent NeTopBar over a
    // full-height Column. The paste field fills the middle and scrolls
    // internally (never overflows, however big the JSON); the source buttons
    // and the primary Import CTA stay pinned at the bottom. The Scaffold's
    // resizeToAvoidBottomInset already shrinks the body for the keyboard — do
    // NOT add viewInsets to the padding too, or it double-counts and the field
    // collapses (the bottom row then overflows and the buttons ride up).
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  UxnanSpacing.lg,
                  NeTopBar.preferredHeight(context),
                  UxnanSpacing.lg,
                  UxnanSpacing.lg,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      widget.body,
                      style: textTheme.bodyMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: UxnanSpacing.md),
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        expands: true,
                        maxLines: null,
                        autofocus: true,
                        textAlignVertical: TextAlignVertical.top,
                        style: textTheme.bodySmall?.copyWith(
                          fontFamily: 'JetBrainsMono',
                        ),
                        decoration: InputDecoration(
                          hintText: widget.hint,
                          filled: true,
                          fillColor: colors.surfaceContainerHighest,
                          border: const OutlineInputBorder(
                            borderRadius: BorderRadius.all(UxnanRadius.md),
                            borderSide: BorderSide.none,
                          ),
                          contentPadding: const EdgeInsets.all(UxnanSpacing.md),
                        ),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: UxnanSpacing.sm),
                      Text(
                        _error!,
                        style:
                            textTheme.bodySmall?.copyWith(color: colors.error),
                      ),
                    ],
                    const SizedBox(height: UxnanSpacing.md),
                    // Alternative sources: fill the field from a file or a URL
                    // so the user can review before importing.
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _busy ? null : _fromFile,
                            icon: const Icon(
                              Icons.folder_open_outlined,
                              size: 18,
                            ),
                            label: Text(l10n.themeImportFromFile),
                          ),
                        ),
                        const SizedBox(width: UxnanSpacing.sm),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _busy ? null : _fromUrl,
                            icon: _busy
                                ? const PolygonLoader(size: 16)
                                : const Icon(Icons.link_rounded, size: 18),
                            label: Text(l10n.themeImportFromUrl),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: UxnanSpacing.md),
                    FilledButton.icon(
                      onPressed: canImport
                          ? () => Navigator.of(context).pop(_controller.text)
                          : null,
                      icon: const Icon(Icons.file_download_outlined),
                      label: Text(l10n.personalizationCustomThemesImportAction),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: NeTopBar(
              leading: IconSurface(
                icon: Icons.close_rounded,
                tooltip: l10n.actionCancel,
                onPressed: () => Navigator.of(context).maybePop(),
              ),
              title: Text(
                widget.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: textTheme.titleLarge?.copyWith(fontSize: 20),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ExportChoiceSheet extends StatelessWidget {
  const _ExportChoiceSheet({
    required this.title,
    required this.copyLabel,
    required this.fileLabel,
  });

  final String title;
  final String copyLabel;
  final String fileLabel;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: UxnanSpacing.xs,
                vertical: UxnanSpacing.sm,
              ),
              child: Text(title, style: textTheme.titleMedium),
            ),
            const SizedBox(height: UxnanSpacing.sm),
            _ExportTile(
              icon: Icons.copy_rounded,
              label: copyLabel,
              onTap: () => Navigator.of(context).pop(ThemeExportChoice.copy),
            ),
            const SizedBox(height: UxnanSpacing.xs),
            _ExportTile(
              icon: Icons.save_alt_rounded,
              label: fileLabel,
              onTap: () => Navigator.of(context).pop(ThemeExportChoice.file),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExportTile extends StatelessWidget {
  const _ExportTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerHigh,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.md,
            vertical: UxnanSpacing.md,
          ),
          child: Row(
            children: [
              Icon(icon, color: colors.onSurfaceVariant),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child:
                    Text(label, style: Theme.of(context).textTheme.bodyLarge),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
