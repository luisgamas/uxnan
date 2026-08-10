import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:jovial_svg/jovial_svg.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/infrastructure/media/remote_resource_service.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_preview_support.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';
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
      return WorkspaceVectorImage(
        bytes: bytes,
        fit: fit,
        width: width,
        height: height,
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

/// SVG renderer for workspace and Markdown vector resources.
///
/// Uses `jovial_svg` rather than the `flutter_svg` the rest of the app uses for
/// its own bundled logos, because this surface renders **arbitrary** SVG the
/// user did not author. `flutter_svg` (vector_graphics) does not apply
/// transforms to `<text>`: every badge service emits
/// `font-size="110" … transform="scale(.1)"` (shields.io, badgen, GitHub
/// Actions all do, for coordinate precision), so the label was painted ten
/// times too large and covered the whole shield. `jovial_svg` honours the
/// transform, so a badge reads as a badge.
///
/// Sizing is computed from the document's own viewport instead of being left
/// to the renderer: given one axis, the other follows the aspect ratio, so an
/// inline badge occupies exactly its shield and nothing more.
class WorkspaceVectorImage extends StatefulWidget {
  /// Creates a [WorkspaceVectorImage] from raw SVG [bytes].
  const WorkspaceVectorImage({
    required this.bytes,
    required this.fit,
    this.width,
    this.height,
    super.key,
  });

  /// Raw SVG document.
  final Uint8List bytes;

  /// How the drawing is fitted into the resolved box.
  final BoxFit fit;

  /// Optional explicit width.
  final double? width;

  /// Optional explicit height.
  final double? height;

  @override
  State<WorkspaceVectorImage> createState() => _WorkspaceVectorImageState();
}

class _WorkspaceVectorImageState extends State<WorkspaceVectorImage> {
  ScalableImage? _image;

  @override
  void initState() {
    super.initState();
    _parse();
  }

  @override
  void didUpdateWidget(covariant WorkspaceVectorImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.bytes, widget.bytes)) _parse();
  }

  void _parse() {
    try {
      _image = ScalableImage.fromSvgString(
        utf8.decode(widget.bytes, allowMalformed: true),
        // Unsupported constructs (filters, for instance) are skipped by the
        // renderer; they are a trace detail, not something to print per frame.
        warnF: (message) => AppLogger.trace('SVG: $message'),
      );
    } on Object catch (error) {
      AppLogger.warn('SVG parse failed', error);
      _image = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final image = _image;
    if (image == null) return const _BrokenImage(message: 'image/svg+xml');

    final viewport = image.viewport;
    final aspect =
        viewport.height <= 0 ? null : viewport.width / viewport.height;
    var width = widget.width;
    var height = widget.height;
    if (aspect != null && aspect > 0) {
      width ??= height == null ? null : height * aspect;
      height ??= width == null ? null : width / aspect;
    }

    return SizedBox(
      width: width,
      height: height,
      child: ScalableImageWidget(si: image, fit: widget.fit),
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
/// fetched through the bridge; HTTPS resources go through
/// [RemoteResourceService], which types them from the response.
class MarkdownResourceImage extends StatefulWidget {
  const MarkdownResourceImage({
    required this.manager,
    required this.remoteResources,
    required this.cwd,
    required this.documentPath,
    required this.uri,
    this.title,
    super.key,
  });

  final FileBrowserManager manager;
  final RemoteResourceService remoteResources;
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
    // A shield defaults to the compact badge height, but only when the document
    // did not declare a width: forcing both axes on a badge whose aspect ratio
    // is fixed would letterbox it inside its own slot.
    final height = declaredHeight ??
        (badge && width == null ? UxnanSize.inlineBadgeHeight : null);
    final constraints = BoxConstraints(
      maxWidth: width ?? UxnanSpacing.maxContentWidth,
      maxHeight: height ?? UxnanSize.maxInlineMediaHeight,
    );

    if (isSafeRemoteResource(target)) {
      return ConstrainedBox(
        constraints: constraints,
        child: _RemoteImage(
          service: widget.remoteResources,
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

/// Remote Markdown resource fetched once through [RemoteResourceService] and
/// decoded by the media type the response declares.
///
/// The bytes are fetched here rather than handed to `Image.network` /
/// `SvgPicture.network` because the URL is not a reliable format hint: shields
/// are served from extensionless endpoints (`img.shields.io/github/stars/…`)
/// as `image/svg+xml`, so an extension-based decoder choice sent SVG markup to
/// the platform raster decoder and every badge collapsed into a broken image.
class _RemoteImage extends StatefulWidget {
  const _RemoteImage({
    required this.service,
    required this.target,
    this.width,
    this.height,
  });

  final RemoteResourceService service;
  final String target;
  final double? width;
  final double? height;

  @override
  State<_RemoteImage> createState() => _RemoteImageState();
}

class _RemoteImageState extends State<_RemoteImage> {
  late Future<RemoteResource> _resource;

  @override
  void initState() {
    super.initState();
    _resource = widget.service.load(widget.target);
  }

  @override
  void didUpdateWidget(covariant _RemoteImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.target != widget.target ||
        oldWidget.service != widget.service) {
      _resource = widget.service.load(widget.target);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<RemoteResource>(
      future: _resource,
      builder: (context, snapshot) {
        if (snapshot.hasError) return const _BrokenImage();
        final resource = snapshot.data;
        if (resource == null) return const _ImageLoading();
        return WorkspaceImageBytes(
          bytes: resource.bytes,
          mimeType: resource.mimeType,
          fit: BoxFit.contain,
          width: widget.width,
          height: widget.height,
        );
      },
    );
  }
}

/// Loading placeholder that degrades to a bare indicator inside a slot too
/// short for the padded box (an inline 20dp shield).
class _ImageLoading extends StatelessWidget {
  const _ImageLoading();

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          if (_isCompactSlot(constraints)) {
            // Sized to the glyph, not to the slot: an expanding placeholder
            // would hold a full content-width gap until the badge resolves.
            return PolygonLoader(size: _compactGlyphSize(constraints));
          }
          return const SizedBox(
            width: UxnanSpacing.xxl,
            height: UxnanSpacing.xxl,
            child: Center(child: PolygonLoader(size: UxnanSpacing.xl)),
          );
        },
      );
}

/// Broken-resource placeholder.
///
/// Inline Markdown media is often constrained to a badge's height, which is
/// shorter than the padded icon + caption column; rendering that column inside
/// a 20dp slot overflowed the layout (the striped RenderFlex banner). The
/// placeholder therefore measures its slot and degrades to a single glyph when
/// the full box does not fit.
class _BrokenImage extends StatelessWidget {
  const _BrokenImage({this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, constraints) {
        if (_isCompactSlot(constraints)) {
          return UxIcon(
            UxIcons.brokenImage,
            size: _compactGlyphSize(constraints),
            color: colors.error,
          );
        }
        return Padding(
          padding: const EdgeInsets.all(UxnanSpacing.sm),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              UxIcon(UxIcons.brokenImage, color: colors.error),
              if (message case final message?) ...[
                const SizedBox(height: UxnanSpacing.xs),
                Text(message, style: UxnanTypography.codeSmall),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// Whether [constraints] describe a slot too short for the padded placeholder.
bool _isCompactSlot(BoxConstraints constraints) =>
    constraints.maxHeight.isFinite &&
    constraints.maxHeight < UxnanSize.mediaPlaceholderMinHeight;

/// Glyph size that always fits a compact slot, never larger than a badge.
double _compactGlyphSize(BoxConstraints constraints) => math.min(
      constraints.maxHeight,
      UxnanSpacing.lg,
    );
