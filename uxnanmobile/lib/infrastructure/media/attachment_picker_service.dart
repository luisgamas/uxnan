import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// Where a composer attachment comes from.
enum AttachmentSource {
  /// The device photo library / gallery.
  gallery,

  /// The device camera (capture a new photo).
  camera,

  /// Any file from the device's files (sent as a file, not an image).
  file,
}

/// The largest file a message carries: the bridge's `MAX_ATTACHMENT_BYTES`.
const int kMaxAttachmentBytes = 20 * 1024 * 1024;

/// Picks images for the composer and returns them as inline-base64
/// [ImageContent] blocks ready to ride on `turn/send`.
///
/// Guarded like the other infrastructure services: every plugin call is wrapped
/// so a cancel / denied permission / missing plugin yields an empty result
/// instead of throwing. Images are downscaled (max 2048 px, quality 85) to keep
/// the base64 payload well under the bridge's 10 MB `workspace/readImage`
/// ceiling. The plugin is injectable so tests run without the platform channel.
class AttachmentPickerService {
  /// Creates an [AttachmentPickerService], optionally injecting the plugin.
  AttachmentPickerService([
    ImagePicker? picker,
    Future<FilePickerResult?> Function()? pickFiles,
  ])  : _picker = picker ?? ImagePicker(),
        _pickFiles = pickFiles ??
            (() => FilePicker.platform
                .pickFiles(allowMultiple: true, withData: true));

  final ImagePicker _picker;
  final Future<FilePickerResult?> Function() _pickFiles;

  /// Picks images from [source]: the gallery allows a multi-selection (capped
  /// at [limit] when given, since every image rides inline on the turn), the
  /// camera captures a single photo. Returns the decoded images in the order
  /// they were picked, or an empty list when the user cancels or the pick
  /// fails.
  Future<List<ImageContent>> pickImages(
    AttachmentSource source, {
    int? limit,
  }) async {
    try {
      final files = source == AttachmentSource.camera
          ? [
              await _picker.pickImage(
                source: ImageSource.camera,
                maxWidth: 2048,
                maxHeight: 2048,
                imageQuality: 85,
              ),
            ].nonNulls.toList()
          : await _picker.pickMultiImage(
              maxWidth: 2048,
              maxHeight: 2048,
              imageQuality: 85,
              // The plugin's multi-selection rejects a limit below 2, so a
              // single free slot is left unbounded here and capped by the
              // caller instead.
              limit: limit != null && limit >= 2 ? limit : null,
            );
      final images = <ImageContent>[];
      for (final file in files) {
        final bytes = await file.readAsBytes();
        images.add(
          ImageContent(
            mimeType: _mimeFor(file.name),
            base64Data: base64Encode(bytes),
          ),
        );
      }
      return images;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('image pick failed', error, stackTrace);
      return const [];
    }
  }

  /// Picks files of any kind (up to [limit]) and returns them as inline
  /// [AttachedFileContent] blocks, with how many were left out for being
  /// larger than [kMaxAttachmentBytes]. Empty when the user cancels or the
  /// pick fails.
  Future<({List<AttachedFileContent> files, int tooLarge})> pickFiles({
    int? limit,
  }) async {
    try {
      final result = await _pickFiles();
      if (result == null) {
        return (files: const <AttachedFileContent>[], tooLarge: 0);
      }
      final files = <AttachedFileContent>[];
      var tooLarge = 0;
      for (final picked in result.files) {
        if (limit != null && files.length >= limit) break;
        final bytes = picked.bytes;
        if (bytes == null) continue;
        if (bytes.length > kMaxAttachmentBytes) {
          tooLarge++;
          continue;
        }
        files.add(
          AttachedFileContent(
            name: picked.name,
            mimeType: _fileMimeFor(picked.name),
            bytes: bytes.length,
            base64Data: base64Encode(bytes),
          ),
        );
      }
      return (files: files, tooLarge: tooLarge);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('file pick failed', error, stackTrace);
      return (files: const <AttachedFileContent>[], tooLarge: 0);
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

/// The MIME type a picked file travels as, from its extension.
String _fileMimeFor(String name) {
  final dot = name.lastIndexOf('.');
  final ext = dot < 0 ? '' : name.substring(dot + 1).toLowerCase();
  return switch (ext) {
    'pdf' => 'application/pdf',
    'txt' || 'log' => 'text/plain',
    'md' || 'markdown' => 'text/markdown',
    'csv' => 'text/csv',
    'json' => 'application/json',
    'yaml' || 'yml' => 'application/yaml',
    'xml' => 'application/xml',
    'html' || 'htm' => 'text/html',
    'zip' => 'application/zip',
    'png' => 'image/png',
    'jpg' || 'jpeg' => 'image/jpeg',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
    _ => 'application/octet-stream',
  };
}
