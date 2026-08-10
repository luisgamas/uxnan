import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A monospaced, copyable shell command (e.g. the bridge install command).
class CommandCardWidget extends StatelessWidget {
  /// Creates a [CommandCardWidget] for [command].
  const CommandCardWidget({required this.command, super.key});

  /// The shell command shown and copied.
  final String command;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          UxnanSpacing.sm,
          UxnanSpacing.sm,
          UxnanSpacing.sm,
        ),
        child: Row(
          children: [
            const UxIcon(
              UxIcons.terminal,
              color: UxnanColors.secondary,
              semanticLabel: 'Terminal',
            ),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Text(
                command,
                style: UxnanTypography.codeBody,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            IconButton(
              tooltip: l10n.actionCopy,
              icon: const UxIcon(UxIcons.copy),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: command));
                ScaffoldMessenger.of(context)
                  ..hideCurrentSnackBar()
                  ..showSnackBar(
                    SnackBar(content: Text(l10n.commandCopied)),
                  );
              },
            ),
          ],
        ),
      ),
    );
  }
}
