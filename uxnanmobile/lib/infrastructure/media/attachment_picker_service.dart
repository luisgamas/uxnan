import 'dart:convert';

import 'package:image_picker/image_picker.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// Where a composer attachment comes from.
enum AttachmentSource {
  /// The device photo library / gallery.
  gallery,

  /// The device camera (capture a new photo).
  camera,
}

/// Picks an image for the composer and returns it as an inline-base64
/// [ImageContent] ready to ride on `turn/send`.
///
/// Guarded like the other infrastructure services: every plugin call is wrapped
/// so a cancel / denied permission / missing plugin yields `null` instead of
/// throwing. Images are downscaled (max 2048 px, quality 85) to keep the base64
/// payload well under the bridge's 10 MB `workspace/readImage` ceiling. The
/// plugin is injectable so tests run without the platform channel.
class AttachmentPickerService {
  /// Creates an [AttachmentPickerService], optionally injecting the plugin.
  AttachmentPickerService([ImagePicker? picker])
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Picks one image from [source]. Returns the decoded [ImageContent], or
  /// `null` when the user cancels or the pick fails.
  Future<ImageContent?> pickImage(AttachmentSource source) async {
    try {
      final file = await _picker.pickImage(
        source: source == AttachmentSource.camera
            ? ImageSource.camera
            : ImageSource.gallery,
        maxWidth: 2048,
        maxHeight: 2048,
        imageQuality: 85,
      );
      if (file == null) return null;
      final bytes = await file.readAsBytes();
      return ImageContent(
        mimeType: _mimeFor(file.name),
        base64Data: base64Encode(bytes),
      );
    } on Object catch (error, stackTrace) {
      AppLogger.warn('image pick failed', error, stackTrace);
      return null;
    }
  }

  /// Picks a small avatar image from the gallery, downscaled to 256 px (q80) so
  /// it stays tiny enough to store inline. Returns its base64 + MIME, or `null`
  /// when the user cancels or the pick fails.
  Future<({String base64, String mime})?> pickAvatar() async {
    try {
      final file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 256,
        maxHeight: 256,
        imageQuality: 80,
      );
      if (file == null) return null;
      final bytes = await file.readAsBytes();
      return (base64: base64Encode(bytes), mime: _mimeFor(file.name));
    } on Object catch (error, stackTrace) {
      AppLogger.warn('avatar pick failed', error, stackTrace);
      return null;
    }
  }

  String _mimeFor(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    return 'image/jpeg';
  }
}
