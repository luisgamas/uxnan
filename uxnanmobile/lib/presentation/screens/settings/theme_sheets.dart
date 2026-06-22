import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Bottom sheets shared by the theme manager and the theme editor for
/// importing and exporting theme JSON.
///
/// Neural Expressive uses **bottom sheets** (not dialogs) for input and for
/// action menus on mobile — pasting a JSON blob or choosing copy-vs-file is an
/// input/menu task, so a sheet (rounded top, neutral surface, keyboard-aware)
/// is the right surface. Confirmations stay [AlertDialog]s elsewhere.

/// Opens a keyboard-aware bottom sheet with a multi-line field to paste theme
/// JSON. Returns the pasted text, or null if dismissed/cancelled.
Future<String?> showImportThemeSheet(
  BuildContext context, {
  required String title,
  required String body,
  required String hint,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => _ImportThemeSheet(title: title, body: body, hint: hint),
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

class _ImportThemeSheet extends StatefulWidget {
  const _ImportThemeSheet({
    required this.title,
    required this.body,
    required this.hint,
  });

  final String title;
  final String body;
  final String hint;

  @override
  State<_ImportThemeSheet> createState() => _ImportThemeSheetState();
}

class _ImportThemeSheetState extends State<_ImportThemeSheet> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    // Lift the sheet above the keyboard; cap the field so the sheet stays a
    // sheet (not a full-screen takeover) on tall devices.
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
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
              Text(widget.title, style: textTheme.titleLarge),
              const SizedBox(height: UxnanSpacing.xs),
              Text(
                widget.body,
                style: textTheme.bodyMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: UxnanSpacing.md),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 240),
                child: TextField(
                  controller: _controller,
                  maxLines: null,
                  minLines: 6,
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
              const SizedBox(height: UxnanSpacing.md),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(l10n.actionCancel),
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  FilledButton.icon(
                    onPressed: () =>
                        Navigator.of(context).pop(_controller.text),
                    icon: const Icon(Icons.file_download_outlined),
                    label: Text(l10n.personalizationCustomThemesImportAction),
                  ),
                ],
              ),
            ],
          ),
        ),
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
