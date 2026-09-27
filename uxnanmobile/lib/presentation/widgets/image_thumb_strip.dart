import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/message_image_bytes.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A horizontally scrolling strip of image thumbnails — inline ones, or ones
/// the bridge keeps with a message ([threadId] names where to ask).
///
/// One widget serves both ends of an image turn, so an attachment reads the
/// same before and after it is sent:
///
/// - the **composer** renders the pending attachments *inside* the pill, above
///   the text field, each with a ✕ that drops it ([onRemove]);
/// - the **user bubble** renders the sent images *above* the bubble, tappable
///   to open them full size ([onTap]).
///
/// The strip sizes itself to its content when its constraints allow it (so it
/// can be right-aligned under the bubble) and scrolls as soon as the thumbnails
/// outgrow the available width.
class ImageThumbStrip extends StatelessWidget {
  /// Creates an [ImageThumbStrip].
  const ImageThumbStrip({
    required this.images,
    required this.size,
    this.threadId,
    this.onRemove,
    this.onTap,
    super.key,
  });

  /// The conversation of the message, for images the bridge keeps.
  final String? threadId;

  /// The images to show, in order.
  final List<ImageContent> images;

  /// Side of each square thumbnail, in logical pixels. Each caller states it
  /// explicitly: pending attachments are smaller than sent ones.
  final double size;

  /// Called with the index to drop. When null no ✕ overlay is drawn.
  final ValueChanged<int>? onRemove;

  /// Called with the tapped index. When null the thumbnails are not tappable.
  final ValueChanged<int>? onTap;

  @override
  Widget build(BuildContext context) {
    if (images.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: size,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        // Hug the thumbnails when the parent allows it (bubble strip, which is
        // right-aligned); a tight width still fills and scrolls (composer).
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        itemCount: images.length,
        separatorBuilder: (_, __) => const SizedBox(width: UxnanSpacing.xs),
        itemBuilder: (context, index) => _Thumb(
          image: images[index],
          threadId: threadId,
          size: size,
          onRemove: onRemove == null ? null : () => onRemove!(index),
          onTap: onTap == null ? null : () => onTap!(index),
        ),
      ),
    );
  }
}

/// A single square thumbnail.
class _Thumb extends StatelessWidget {
  const _Thumb({
    required this.image,
    required this.size,
    this.threadId,
    this.onRemove,
    this.onTap,
  });

  final ImageContent image;
  final String? threadId;
  final double size;
  final VoidCallback? onRemove;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    const radius = BorderRadius.all(UxnanRadius.md);

    Widget thumb = ClipRRect(
      borderRadius: radius,
      child: Container(
        width: size,
        height: size,
        color: colors.surfaceContainerHighest,
        alignment: Alignment.center,
        child: MessageImageBytes(
          image: image,
          threadId: threadId,
          builder: (context, bytes, {required loading}) => bytes == null
              ? UxIcon(
                  loading ? UxIcons.image : UxIcons.brokenImage,
                  color: colors.onSurfaceVariant,
                )
              : Image.memory(
                  bytes,
                  width: size,
                  height: size,
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  errorBuilder: (context, _, __) => UxIcon(
                    UxIcons.brokenImage,
                    color: colors.onSurfaceVariant,
                  ),
                ),
        ),
      ),
    );

    if (onTap != null) {
      thumb = Semantics(
        button: true,
        label: l10n.attachmentImage,
        child: InkWell(
          onTap: onTap,
          borderRadius: radius,
          child: thumb,
        ),
      );
    } else {
      thumb = Semantics(image: true, label: l10n.attachmentImage, child: thumb);
    }

    if (onRemove == null) return thumb;

    return Stack(
      children: [
        thumb,
        Positioned(
          top: 2,
          right: 2,
          child: Tooltip(
            message: l10n.attachmentRemove,
            // A solid surface chip rather than a translucent scrim: it stays
            // legible over any photo in both light and dark themes.
            child: InkResponse(
              onTap: onRemove,
              radius: UxnanSpacing.lg,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: colors.surface,
                  shape: BoxShape.circle,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(2),
                  child: UxIcon(
                    UxIcons.close,
                    size: 16,
                    color: colors.onSurface,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
