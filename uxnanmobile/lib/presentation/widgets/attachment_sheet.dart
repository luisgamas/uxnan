import 'package:flutter/material.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/workspace/files/widgets/file_tree_tile.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/attachment_chip.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/message_image_bytes.dart';
import 'package:uxnan/presentation/widgets/ne_button.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Opens a chip of the message being written: the image itself (or the
/// file's name, size and type) in a bottom sheet, with [onRemove] taking it
/// out of the message — the one action a chip in the composer needs besides
/// a backspace.
///
/// Resolves once the sheet is closed; [onRemove] runs after it has closed.
Future<void> showAttachmentSheet(
  BuildContext context, {
  required AttachmentContent attachment,
  String? threadId,
  VoidCallback? onRemove,
}) async {
  final removed = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => _AttachmentSheet(
      attachment: attachment,
      threadId: threadId,
      removable: onRemove != null,
    ),
  );
  if (removed ?? false) onRemove?.call();
}

class _AttachmentSheet extends StatelessWidget {
  const _AttachmentSheet({
    required this.attachment,
    required this.removable,
    this.threadId,
  });

  final AttachmentContent attachment;
  final String? threadId;
  final bool removable;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final maxPreview = MediaQuery.sizeOf(context).height * 0.5;
    final name = attachmentLabel(attachment, l10n);

    final Widget preview = switch (attachment) {
      final ImageContent image => ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxPreview),
          child: ClipRRect(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            child: MessageImageBytes(
              key: const ValueKey('attachment-sheet-image'),
              image: image,
              threadId: threadId,
              builder: (context, bytes, {required loading}) => bytes == null
                  ? SizedBox(
                      height: UxnanSize.mediaPlaceholderMinHeight * 2,
                      child: Center(
                        child: loading
                            ? const PolygonLoader(size: 32)
                            : UxIcon(
                                UxIcons.brokenImage,
                                color: colors.onSurfaceVariant,
                              ),
                      ),
                    )
                  : Image.memory(
                      bytes,
                      fit: BoxFit.contain,
                      gaplessPlayback: true,
                    ),
            ),
          ),
        ),
      final AttachedFileContent file => Row(
          children: [
            Container(
              width: UxnanSize.iconSurface,
              height: UxnanSize.iconSurface,
              decoration: BoxDecoration(
                color: colors.surfaceContainerHigh,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: UxIcon(
                fileTypeVisuals(name: file.name, type: FileEntryType.file).icon,
                size: UxnanSize.iconSurfaceGlyph,
                color: colors.primary,
              ),
            ),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Text(
                [formatFileSize(file.bytes), file.mimeType].join(' · '),
                style: textTheme.bodyMedium
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ),
          ],
        ),
    };

    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            0,
            UxnanSpacing.lg,
            UxnanSpacing.lg,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              // The whole name: the chip shortened it.
              Text(name, style: textTheme.titleMedium),
              const SizedBox(height: UxnanSpacing.md),
              Center(child: preview),
              if (removable) ...[
                const SizedBox(height: UxnanSpacing.lg),
                NeButton.outlined(
                  key: const ValueKey('attachment-sheet-remove'),
                  label: l10n.attachmentRemoveFromMessage,
                  icon: UxIcons.delete,
                  onPressed: () => Navigator.of(context).pop(true),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
