import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/metrics_backup_io.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_button.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';

/// The profile's **Backup** card: a note that the stats live on this phone and
/// the PC (and can be lost without a backup), plus Export / Import actions that
/// drive the bridge's tamper-proof `metrics/export` / `metrics/import`.
///
/// Both actions need a connected PC (the bridge seals + verifies the file); the
/// buttons are disabled with a hint while offline.
class ProfileBackupSection extends ConsumerWidget {
  /// Creates the [ProfileBackupSection].
  const ProfileBackupSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final connected = ref.watch(connectedDeviceProvider).value != null;

    return NeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.shield_outlined, size: 20, color: colors.primary),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Text(
                  l10n.profileBackupNote,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.md),
          Row(
            children: [
              Expanded(
                child: NeButton.outlined(
                  label: l10n.profileBackupExport,
                  icon: Icons.ios_share,
                  onPressed: connected ? () => _export(context, ref) : null,
                ),
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: NeButton.outlined(
                  label: l10n.profileBackupImport,
                  icon: Icons.download_outlined,
                  onPressed: connected ? () => _import(context, ref) : null,
                ),
              ),
            ],
          ),
          if (!connected) ...[
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              l10n.profileBackupOfflineHint,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _export(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final passphrase = await _askPassphrase(
      context,
      title: l10n.profileBackupPassphraseOptionalTitle,
      hint: l10n.profileBackupPassphraseOptionalHint,
      confirmLabel: l10n.profileBackupExport,
    );
    if (passphrase == null) return; // cancelled
    final ({String blob, String filename, bool passphraseProtected}) result;
    try {
      result = await ref
          .read(metricsSnapshotsProvider.notifier)
          .exportBackup(passphrase: passphrase.isEmpty ? null : passphrase);
    } on MetricsExportException catch (error) {
      // Show the bridge's own reason — never a guess about the connection.
      messenger.showSnackBar(
        SnackBar(
          content: Text(l10n.profileBackupExportFailedReason(error.message)),
        ),
      );
      return;
    }
    final shared = await shareMetricsBackupFile(
      filename: result.filename,
      blob: result.blob,
      subject: l10n.profileBackupShareSubject,
    );
    if (!shared) {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.profileBackupShareFailed)),
      );
    }
  }

  Future<void> _import(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final blob = await pickMetricsBackupFile();
    if (blob == null) return;
    final controller = ref.read(metricsSnapshotsProvider.notifier);
    try {
      final imported = await controller.importBackup(blob);
      messenger.showSnackBar(
        SnackBar(content: Text(_importedMessage(l10n, imported))),
      );
    } on MetricsImportException catch (error) {
      // A passphrase-protected file: prompt for the phrase and retry once.
      if (!error.message.toLowerCase().contains('passphrase')) {
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.profileBackupImportFailed)),
        );
        return;
      }
      if (!context.mounted) return;
      final passphrase = await _askPassphrase(
        context,
        title: l10n.profileBackupPassphraseRequiredTitle,
        hint: l10n.profileBackupPassphraseRequiredHint,
        confirmLabel: l10n.profileBackupImport,
      );
      if (passphrase == null || passphrase.isEmpty) return;
      try {
        final imported =
            await controller.importBackup(blob, passphrase: passphrase);
        messenger.showSnackBar(
          SnackBar(content: Text(_importedMessage(l10n, imported))),
        );
      } on MetricsImportException {
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.profileBackupImportBadPassphrase)),
        );
      }
    }
  }

  String _importedMessage(AppLocalizations l10n, int imported) => imported > 0
      ? l10n.profileBackupImportedNew(imported)
      : l10n.profileBackupImportedNone;

  /// Shows a passphrase dialog. Returns the entered text (possibly empty, when
  /// [hint] marks it optional) on confirm, or null when cancelled/dismissed.
  Future<String?> _askPassphrase(
    BuildContext context, {
    required String title,
    required String hint,
    required String confirmLabel,
  }) {
    final l10n = AppLocalizations.of(context);
    return showDialog<String>(
      context: context,
      builder: (_) => _PassphraseDialog(
        title: title,
        hint: hint,
        fieldLabel: l10n.profileBackupPassphraseField,
        confirmLabel: confirmLabel,
        cancelLabel: l10n.profileBackupCancel,
      ),
    );
  }
}

/// A passphrase-entry dialog whose [TextEditingController] is owned by the
/// widget's [State] and disposed in `dispose()` — i.e. only after the route is
/// fully removed, so the dialog's close animation never touches a disposed
/// controller. (Disposing it right after `showDialog` returned crashed the
/// dismiss animation with a "used after being disposed" assertion.)
class _PassphraseDialog extends StatefulWidget {
  const _PassphraseDialog({
    required this.title,
    required this.hint,
    required this.fieldLabel,
    required this.confirmLabel,
    required this.cancelLabel,
  });

  final String title;
  final String hint;
  final String fieldLabel;
  final String confirmLabel;
  final String cancelLabel;

  @override
  State<_PassphraseDialog> createState() => _PassphraseDialogState();
}

class _PassphraseDialogState extends State<_PassphraseDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        controller: _controller,
        autofocus: true,
        obscureText: true,
        decoration: InputDecoration(
          labelText: widget.fieldLabel,
          helperText: widget.hint,
          helperMaxLines: 3,
        ),
        onSubmitted: (value) => Navigator.of(context).pop(value),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(widget.cancelLabel),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}
