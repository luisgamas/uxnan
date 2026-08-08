import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A horizontally scrolling strip of inline-base64 image thumbnails.
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
    this.onRemove,
    this.onTap,
    super.key,
  });

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
          size: size,
          onRemove: onRemove == null ? null : () => onRemove!(index),
          onTap: onTap == null ? null : () => onTap!(index),
        ),
      ),
    );
  }
}

/// A single square thumbnail. The base64 payload is decoded once per image
/// (not on every rebuild) because the strip lives in a scrolling timeline.
class _Thumb extends StatefulWidget {
  const _Thumb({
    required this.image,
    required this.size,
    this.onRemove,
    this.onTap,
  });

  final ImageContent image;
  final double size;
  final VoidCallback? onRemove;
  final VoidCallback? onTap;

  @override
  State<_Thumb> createState() => _ThumbState();
}

class _ThumbState extends State<_Thumb> {
  Uint8List? _bytes;

  @override
  void initState() {
    super.initState();
    _decode();
  }

  @override
  void didUpdateWidget(_Thumb oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.image.base64Data != widget.image.base64Data) _decode();
  }

  void _decode() {
    final data = widget.image.base64Data;
    if (data == null) {
      _bytes = null;
      return;
    }
    try {
      _bytes = base64Decode(data);
    } on FormatException {
      _bytes = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final bytes = _bytes;
    const radius = BorderRadius.all(UxnanRadius.md);

    Widget thumb = ClipRRect(
      borderRadius: radius,
      child: Container(
        width: widget.size,
        height: widget.size,
        color: colors.surfaceContainerHighest,
        alignment: Alignment.center,
        child: bytes == null
            ? UxIcon(UxIcons.image, color: colors.onSurfaceVariant)
            : Image.memory(
                bytes,
                width: widget.size,
                height: widget.size,
                fit: BoxFit.cover,
                gaplessPlayback: true,
                errorBuilder: (context, _, __) => UxIcon(
                  UxIcons.brokenImage,
                  color: colors.onSurfaceVariant,
                ),
              ),
      ),
    );

    if (widget.onTap != null) {
      thumb = Semantics(
        button: true,
        label: l10n.attachmentImage,
        child: InkWell(
          onTap: widget.onTap,
          borderRadius: radius,
          child: thumb,
        ),
      );
    } else {
      thumb = Semantics(image: true, label: l10n.attachmentImage, child: thumb);
    }

    if (widget.onRemove == null) return thumb;

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
              onTap: widget.onRemove,
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
