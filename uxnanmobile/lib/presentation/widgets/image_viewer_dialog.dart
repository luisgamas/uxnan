import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Opens the sent [images] full size, starting at [initialIndex].
///
/// Thumbnails in the timeline are deliberately small, so this is where an image
/// is actually inspected: pinch/drag to zoom, swipe to move between the images
/// of the same message.
Future<void> showImageViewerDialog(
  BuildContext context, {
  required List<ImageContent> images,
  int initialIndex = 0,
}) {
  if (images.isEmpty) return Future<void>.value();
  return showDialog<void>(
    context: context,
    barrierColor: Theme.of(context).colorScheme.scrim.withValues(alpha: 0.9),
    builder: (context) => _ImageViewerDialog(
      images: images,
      initialIndex: initialIndex.clamp(0, images.length - 1),
    ),
  );
}

class _ImageViewerDialog extends StatefulWidget {
  const _ImageViewerDialog({required this.images, required this.initialIndex});

  final List<ImageContent> images;
  final int initialIndex;

  @override
  State<_ImageViewerDialog> createState() => _ImageViewerDialogState();
}

class _ImageViewerDialogState extends State<_ImageViewerDialog> {
  late final PageController _controller =
      PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Uint8List? _bytesOf(ImageContent image) {
    final data = image.base64Data;
    if (data == null) return null;
    try {
      return base64Decode(data);
    } on FormatException {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final materialL10n = MaterialLocalizations.of(context);
    final multiple = widget.images.length > 1;

    return Dialog.fullscreen(
      backgroundColor: Colors.transparent,
      child: Stack(
        children: [
          PageView.builder(
            controller: _controller,
            itemCount: widget.images.length,
            onPageChanged: (value) => setState(() => _index = value),
            itemBuilder: (context, index) {
              final bytes = _bytesOf(widget.images[index]);
              return InteractiveViewer(
                maxScale: 6,
                child: Center(
                  child: bytes == null
                      ? Icon(
                          Icons.broken_image_outlined,
                          color: colors.onSurfaceVariant,
                        )
                      : Image.memory(bytes, fit: BoxFit.contain),
                ),
              );
            },
          ),
          Positioned(
            top: UxnanSpacing.sm,
            right: UxnanSpacing.sm,
            child: SafeArea(
              child: IconButton.filledTonal(
                tooltip: materialL10n.closeButtonTooltip,
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close_rounded),
              ),
            ),
          ),
          if (multiple)
            Positioned(
              bottom: UxnanSpacing.xl,
              left: 0,
              right: 0,
              child: SafeArea(
                child: Center(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.surfaceContainerHighest,
                      borderRadius: const BorderRadius.all(UxnanRadius.full),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: UxnanSpacing.md,
                        vertical: UxnanSpacing.xs,
                      ),
                      child: Text(
                        '${_index + 1} / ${widget.images.length}',
                        style: textTheme.labelMedium
                            ?.copyWith(color: colors.onSurfaceVariant),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
