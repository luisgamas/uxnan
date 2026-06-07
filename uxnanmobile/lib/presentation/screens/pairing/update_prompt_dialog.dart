import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';

/// Dialog shown when a scanned bridge uses an unsupported (newer) QR version.
class UpdatePromptDialog extends StatelessWidget {
  /// Creates an [UpdatePromptDialog].
  const UpdatePromptDialog({super.key});

  /// Shows the dialog.
  static Future<void> show(BuildContext context) => showDialog<void>(
        context: context,
        builder: (_) => const UpdatePromptDialog(),
      );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      icon: const Icon(Icons.system_update_rounded),
      title: Text(l10n.updateRequiredTitle),
      content: Text(l10n.updateRequiredBody),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.actionDismiss),
        ),
      ],
    );
  }
}
