import 'package:flutter/material.dart';
import 'package:uxnan/core/extensions/string_ext.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/workspace/files/widgets/file_tree_tile.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/message_image_bytes.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Horizontal room a chip spends on everything but its name: its padding,
/// border, leading thumbnail or glyph and the gap after it.
const double _chipChrome =
    3 + UxnanSpacing.sm + 2 + UxnanSize.attachmentChipThumb + UxnanSpacing.xs;

/// Where an [AttachmentChip] is drawn, which decides its tone.
enum AttachmentChipTone {
  /// Inside the composer pill (`surfaceContainerHighest`).
  composer,

  /// Inside the user's sent bubble (`primaryContainer`).
  bubble,
}

/// One attachment as a token of a sentence: a small rounded chip at the place
/// the person put it — an image's thumbnail or a file's type glyph, then its
/// name, shortened in the middle when long so its extension stays readable.
///
/// The same chip is drawn in the composer (a `WidgetSpan` of its controller)
/// and in the sent message, so a message reads the same before and after it
/// is sent. [onTap] opens it (a preview, the remove action).
class AttachmentChip extends StatelessWidget {
  /// Creates an [AttachmentChip].
  const AttachmentChip({
    required this.attachment,
    this.threadId,
    this.tone = AttachmentChipTone.composer,
    this.onTap,
    super.key,
  });

  /// The image or file.
  final AttachmentContent attachment;

  /// The conversation of a sent message, for an image the bridge keeps.
  final String? threadId;

  /// Where it is drawn.
  final AttachmentChipTone tone;

  /// Opens the attachment; null draws an inert chip.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final inBubble = tone == AttachmentChipTone.bubble;
    final foreground = inBubble ? colors.onPrimaryContainer : colors.onSurface;
    final name = attachmentLabel(attachment, l10n);
    final labelStyle = textTheme.labelMedium?.copyWith(color: foreground);
    const radius = BorderRadius.all(UxnanRadius.md);

    final lead = switch (attachment) {
      final ImageContent image => ClipRRect(
          borderRadius: const BorderRadius.all(UxnanRadius.sm),
          child: SizedBox.square(
            dimension: UxnanSize.attachmentChipThumb,
            child: MessageImageBytes(
              image: image,
              threadId: threadId,
              builder: (context, bytes, {required loading}) => bytes == null
                  ? ColoredBox(
                      color: colors.surfaceContainerHighest,
                      child: UxIcon(
                        loading ? UxIcons.image : UxIcons.brokenImage,
                        size: UxnanSize.iconContentSmall - 4,
                        color: colors.onSurfaceVariant,
                      ),
                    )
                  : Image.memory(
                      bytes,
                      fit: BoxFit.cover,
                      gaplessPlayback: true,
                      cacheWidth: 64,
                      errorBuilder: (context, _, __) => UxIcon(
                        UxIcons.brokenImage,
                        size: UxnanSize.iconContentSmall - 4,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
            ),
          ),
        ),
      final AttachedFileContent file => UxIcon(
          fileTypeVisuals(name: file.name, type: FileEntryType.file).icon,
          size: UxnanSize.iconContentSmall,
          color: inBubble ? colors.onPrimaryContainer : colors.primary,
        ),
    };

    final chip = Container(
      height: UxnanSize.attachmentChip,
      constraints:
          const BoxConstraints(maxWidth: UxnanSize.attachmentChipMaxWidth),
      padding: const EdgeInsets.only(
        left: 3,
        right: UxnanSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: inBubble
            ? colors.onPrimaryContainer.withValues(alpha: 0.08)
            : colors.surface,
        borderRadius: radius,
        border: Border.all(
          color: inBubble
              ? colors.onPrimaryContainer.withValues(alpha: 0.16)
              : colors.outlineVariant,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          lead,
          const SizedBox(width: UxnanSpacing.xs),
          Flexible(
            child: Text(
              fitNameToWidth(
                name,
                style: labelStyle,
                maxWidth: UxnanSize.attachmentChipMaxWidth - _chipChrome,
                textScaler: MediaQuery.textScalerOf(context),
                textDirection: Directionality.of(context),
              ),
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.ellipsis,
              style: labelStyle,
            ),
          ),
        ],
      ),
    );

    final semantics = switch (attachment) {
      ImageContent() => l10n.attachmentChipImage(name),
      final AttachedFileContent file =>
        l10n.attachmentChipFile(name, formatFileSize(file.bytes)),
    };

    return Semantics(
      button: onTap != null,
      label: semantics,
      excludeSemantics: true,
      child: onTap == null
          ? chip
          : Material(
              type: MaterialType.transparency,
              child: InkWell(
                onTap: onTap,
                borderRadius: radius,
                child: chip,
              ),
            ),
    );
  }
}

/// [name] shortened in the middle just enough to fit [maxWidth] in [style] —
/// so a long file name keeps its start and its extension instead of losing
/// its end to an ellipsis.
String fitNameToWidth(
  String name, {
  required TextStyle? style,
  required double maxWidth,
  required TextScaler textScaler,
  required TextDirection textDirection,
}) {
  double widthOf(String text) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: textDirection,
      textScaler: textScaler,
      maxLines: 1,
    )..layout();
    final width = painter.width;
    painter.dispose();
    return width;
  }

  if (widthOf(name) <= maxWidth) return name;
  // The longest middle-shortened form that still fits.
  var low = 2;
  var high = name.runes.length - 1;
  var best = name.truncateMiddle(low);
  while (low <= high) {
    final mid = (low + high) ~/ 2;
    final candidate = name.truncateMiddle(mid);
    if (widthOf(candidate) <= maxWidth) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/// The name an attachment is shown by: its own, or "Image" for a pasted
/// picture that has none.
String attachmentLabel(AttachmentContent attachment, AppLocalizations l10n) {
  final name = attachment.name?.trim();
  if (name != null && name.isNotEmpty) return name;
  return attachment.isImage ? l10n.attachmentUnnamedImage : 'file';
}

/// A size for people: `980 B`, `12 KB`, `3.4 MB`.
String formatFileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  final mb = bytes / (1024 * 1024);
  return mb >= 10 ? '${mb.round()} MB' : '${mb.toStringAsFixed(1)} MB';
}
