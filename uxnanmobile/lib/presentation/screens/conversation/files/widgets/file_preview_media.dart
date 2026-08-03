import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_preview_support.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/zoomable_media.dart';

/// Full-surface raster or SVG preview with pinch-to-zoom.
class WorkspaceImagePreview extends StatelessWidget {
  const WorkspaceImagePreview({required this.image, super.key});

  final ImageFile image;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ColoredBox(
      color: colors.surfaceContainerLowest,
      child: SizedBox.expand(
        child: ZoomableMedia(
          minScale: 1,
          clipBehavior: Clip.none,
          child: WorkspaceImageBytes(
            bytes: base64Decode(image.base64Data),
            mimeType: image.mimeType,
            fit: BoxFit.contain,
            width: double.infinity,
            height: double.infinity,
          ),
        ),
      ),
    );
  }
}

/// Decodes either SVG or animated/static raster bytes with shared constraints.
class WorkspaceImageBytes extends StatelessWidget {
  const WorkspaceImageBytes({
    required this.bytes,
    required this.mimeType,
    required this.fit,
    this.width,
    this.height,
    super.key,
  });

  final Uint8List bytes;
  final String mimeType;
  final BoxFit fit;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    if (mimeType == 'image/svg+xml') {
      return SvgPicture.memory(
        bytes,
        width: width,
        height: height,
        fit: fit,
        placeholderBuilder: (context) => const _ImageLoading(),
        errorBuilder: (context, error, stackTrace) =>
            _BrokenImage(message: mimeType),
      );
    }
    return Image.memory(
      bytes,
      width: width,
      height: height,
      fit: fit,
      gaplessPlayback: true,
      errorBuilder: (context, error, stackTrace) =>
          _BrokenImage(message: mimeType),
    );
  }
}

/// PDF viewer backed by the original workspace bytes.
class WorkspacePdfPreview extends StatelessWidget {
  const WorkspacePdfPreview({
    required this.base64Data,
    required this.path,
    required this.topInset,
    super.key,
  });

  final String base64Data;
  final String path;
  final double topInset;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(top: topInset),
      child: PdfViewer.data(
        base64Decode(base64Data),
        sourceName: path,
        params: PdfViewerParams(
          backgroundColor: colors.surfaceContainerLowest,
          pageDropShadow: BoxShadow(
            color: colors.shadow.withValues(alpha: 0.18),
            blurRadius: UxnanSpacing.sm,
            offset: const Offset(0, UxnanSpacing.xs),
          ),
        ),
      ),
    );
  }
}

/// Image embedded by a Markdown document. Workspace-relative resources are
/// fetched through the bridge; HTTPS resources use Flutter's image clients.
class MarkdownResourceImage extends StatefulWidget {
  const MarkdownResourceImage({
    required this.manager,
    required this.cwd,
    required this.documentPath,
    required this.uri,
    this.title,
    super.key,
  });

  final FileBrowserManager manager;
  final String cwd;
  final String documentPath;
  final Uri uri;
  final String? title;

  @override
  State<MarkdownResourceImage> createState() => _MarkdownResourceImageState();
}

class _MarkdownResourceImageState extends State<MarkdownResourceImage> {
  Future<ImageFile>? _localImage;

  @override
  void initState() {
    super.initState();
    _prepareLocalImage();
  }

  @override
  void didUpdateWidget(covariant MarkdownResourceImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.uri != widget.uri ||
        oldWidget.cwd != widget.cwd ||
        oldWidget.documentPath != widget.documentPath) {
      _prepareLocalImage();
    }
  }

  void _prepareLocalImage() {
    final target = widget.uri.toString();
    final path = resolveWorkspaceResourcePath(widget.documentPath, target);
    _localImage =
        path == null ? null : widget.manager.readImage(widget.cwd, path);
  }

  @override
  Widget build(BuildContext context) {
    final target = widget.uri.toString();
    final metadata = MarkdownImageMetadata.fromTitle(widget.title);
    final badge = isLikelyBadgeResource(target);
    final width =
        metadata.width?.clamp(1, UxnanSpacing.maxContentWidth).toDouble();
    final declaredHeight =
        metadata.height?.clamp(1, UxnanSize.maxInlineMediaHeight).toDouble();
    final height =
        declaredHeight ?? (badge ? UxnanSize.inlineBadgeHeight : null);
    final constraints = BoxConstraints(
      maxWidth: width ?? UxnanSpacing.maxContentWidth,
      maxHeight: height ?? UxnanSize.maxInlineMediaHeight,
    );

    if (isSafeRemoteResource(target)) {
      return ConstrainedBox(
        constraints: constraints,
        child: _RemoteImage(
          target: target,
          width: width,
          height: height,
        ),
      );
    }

    final localImage = _localImage;
    if (localImage == null) return const _BrokenImage();
    return ConstrainedBox(
      constraints: constraints,
      child: FutureBuilder<ImageFile>(
        future: localImage,
        builder: (context, snapshot) {
          if (snapshot.hasError) return const _BrokenImage();
          final image = snapshot.data;
          if (image == null) return const _ImageLoading();
          return WorkspaceImageBytes(
            bytes: base64Decode(image.base64Data),
            mimeType: image.mimeType,
            fit: BoxFit.contain,
            width: width,
            height: height,
          );
        },
      ),
    );
  }
}

class _RemoteImage extends StatelessWidget {
  const _RemoteImage({required this.target, this.width, this.height});

  final String target;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final uri = Uri.parse(target);
    final isSvg = uri.path.toLowerCase().endsWith('.svg');
    if (isSvg) {
      return SvgPicture.network(
        target,
        width: width,
        height: height,
        placeholderBuilder: (context) => const _ImageLoading(),
        errorBuilder: (context, error, stackTrace) => const _BrokenImage(),
      );
    }
    return Image.network(
      target,
      width: width,
      height: height,
      fit: BoxFit.contain,
      gaplessPlayback: true,
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : const _ImageLoading(),
      errorBuilder: (context, error, stackTrace) => const _BrokenImage(),
    );
  }
}

class _ImageLoading extends StatelessWidget {
  const _ImageLoading();

  @override
  Widget build(BuildContext context) => const SizedBox(
        width: UxnanSpacing.xxl,
        height: UxnanSpacing.xxl,
        child: Center(child: PolygonLoader(size: UxnanSpacing.xl)),
      );
}

class _BrokenImage extends StatelessWidget {
  const _BrokenImage({this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(UxnanSpacing.sm),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.broken_image_outlined, color: colors.error),
          if (message case final message?) ...[
            const SizedBox(height: UxnanSpacing.xs),
            Text(message, style: UxnanTypography.codeSmall),
          ],
        ],
      ),
    );
  }
}
