import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';

/// Asks for a device's name — a paired PC's, or this phone's — prefilled with
/// the current one. Resolves to the trimmed name, or null when cancelled.
class DeviceNameDialog extends StatefulWidget {
  /// Creates a [DeviceNameDialog].
  const DeviceNameDialog({required this.initial, this.title, super.key});

  /// The name the field starts with.
  final String initial;

  /// The dialog's title; the generic "device name" title when null.
  final String? title;

  /// Shows the dialog.

  static Future<String?> show(
    BuildContext context,
    String initial, {
    String? title,
  }) {
    return showDialog<String>(
      context: context,
      builder: (_) => DeviceNameDialog(initial: initial, title: title),
    );
  }

  @override
  State<DeviceNameDialog> createState() => DeviceNameDialogState();
}

class DeviceNameDialogState extends State<DeviceNameDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(widget.title ?? l10n.deviceNameTitle),
      content: TextField(
        controller: _controller,
        autofocus: true,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(hintText: l10n.deviceNameHint),
        onSubmitted: (value) => Navigator.of(context).pop(value.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.actionCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_controller.text.trim()),
          child: Text(l10n.actionSave),
        ),
      ],
    );
  }
}
