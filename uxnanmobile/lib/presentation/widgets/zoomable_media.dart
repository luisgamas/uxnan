import 'package:flutter/material.dart';

/// Shared pinch/drag surface for media that must remain fitted at rest.
class ZoomableMedia extends StatelessWidget {
  const ZoomableMedia({
    required this.child,
    this.minScale = 0.8,
    this.maxScale = 6,
    this.clipBehavior = Clip.hardEdge,
    super.key,
  });

  final Widget child;
  final double minScale;
  final double maxScale;
  final Clip clipBehavior;

  @override
  Widget build(BuildContext context) => InteractiveViewer(
        minScale: minScale,
        maxScale: maxScale,
        clipBehavior: clipBehavior,
        child: child,
      );
}
