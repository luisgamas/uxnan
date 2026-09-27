import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A file attached to a message, as a chip: its icon, name and size — in the
/// composer while it waits to be sent (with [onRemove]), and in the message
/// after.
class FileChip extends StatelessWidget {
  /// Creates a [FileChip].
  const FileChip({required this.file, this.onRemove, super.key});

  /// The file.
  final AttachedFileContent file;

  /// Takes it off the message being written; null in a sent message.
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Semantics(
      label: '${file.name}, ${formatFileSize(file.bytes)}',
      child: Container(
        constraints: const BoxConstraints(maxWidth: 240),
        padding: EdgeInsets.only(
          left: UxnanSpacing.sm,
          right: onRemove == null ? UxnanSpacing.md : 0,
          top: UxnanSpacing.xs,
          bottom: UxnanSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: colors.surfaceContainerHigh,
          borderRadius: const BorderRadius.all(UxnanRadius.md),
          border: Border.all(color: colors.outlineVariant),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            UxIcon(UxIcons.description, size: 20, color: colors.primary),
            const SizedBox(width: UxnanSpacing.sm),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    file.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.bodyMedium,
                  ),
                  Text(
                    formatFileSize(file.bytes),
                    style: textTheme.labelSmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (onRemove != null)
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: MaterialLocalizations.of(context).deleteButtonTooltip,
                onPressed: onRemove,
                icon: UxIcon(
                  UxIcons.close,
                  size: 16,
                  color: colors.onSurfaceVariant,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A size for people: `980 B`, `12 KB`, `3.4 MB`.
String formatFileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  final mb = bytes / (1024 * 1024);
  return mb >= 10 ? '${mb.round()} MB' : '${mb.toStringAsFixed(1)} MB';
}
