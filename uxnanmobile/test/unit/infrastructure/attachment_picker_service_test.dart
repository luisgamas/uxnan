import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uxnan/infrastructure/media/attachment_picker_service.dart';

/// An [ImagePicker] stand-in: records what the service asked for and answers
/// with in-memory [XFile]s, so no platform channel is involved.
class _FakePicker implements ImagePicker {
  _FakePicker({this.multi = const [], this.single, this.throwOnPick = false});

  final List<XFile> multi;
  final XFile? single;
  final bool throwOnPick;

  ImageSource? lastSingleSource;
  int? lastLimit;
  int multiCalls = 0;

  @override
  Future<XFile?> pickImage({
    required ImageSource source,
    double? maxWidth,
    double? maxHeight,
    int? imageQuality,
    CameraDevice preferredCameraDevice = CameraDevice.rear,
    bool requestFullMetadata = true,
  }) async {
    if (throwOnPick) throw StateError('no camera');
    lastSingleSource = source;
    return single;
  }

  @override
  Future<List<XFile>> pickMultiImage({
    double? maxWidth,
    double? maxHeight,
    int? imageQuality,
    int? limit,
    bool requestFullMetadata = true,
  }) async {
    if (throwOnPick) throw StateError('no gallery');
    multiCalls++;
    lastLimit = limit;
    return multi;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not used');
}

/// An in-memory file. `path` (not `name`) is what backs [XFile.name] on the
/// dart:io implementation, and that is where the MIME type is read from.
XFile _file(String name, List<int> bytes) =>
    XFile.fromData(Uint8List.fromList(bytes), path: name, name: name);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AttachmentPickerService.pickImages', () {
    test('gallery returns every picked image, in order, as base64', () async {
      final picker = _FakePicker(
        multi: [
          _file('one.png', [1, 2, 3]),
          _file('two.jpg', [4, 5]),
        ],
      );
      final service = AttachmentPickerService(picker);

      final images = await service.pickImages(AttachmentSource.gallery);

      expect(images, hasLength(2));
      expect(images[0].mimeType, 'image/png');
      expect(images[0].base64Data, base64Encode([1, 2, 3]));
      expect(images[1].mimeType, 'image/jpeg');
      expect(images[1].base64Data, base64Encode([4, 5]));
    });

    test('passes a limit of 2+ through, but drops a single free slot',
        () async {
      final picker = _FakePicker(
        multi: [
          _file('one.png', [1]),
        ],
      );
      final service = AttachmentPickerService(picker);

      await service.pickImages(AttachmentSource.gallery, limit: 3);
      expect(picker.lastLimit, 3);

      // The plugin rejects a limit below 2; the caller caps that case instead.
      await service.pickImages(AttachmentSource.gallery, limit: 1);
      expect(picker.lastLimit, isNull);
      expect(picker.multiCalls, 2);
    });

    test('camera captures a single photo', () async {
      final picker = _FakePicker(single: _file('shot.jpg', [9]));
      final service = AttachmentPickerService(picker);

      final images = await service.pickImages(AttachmentSource.camera);

      expect(images, hasLength(1));
      expect(picker.lastSingleSource, ImageSource.camera);
      expect(picker.multiCalls, 0);
    });

    test('a cancelled pick yields an empty list', () async {
      final service = AttachmentPickerService(_FakePicker());
      expect(await service.pickImages(AttachmentSource.gallery), isEmpty);
      expect(await service.pickImages(AttachmentSource.camera), isEmpty);
    });

    test('a failing plugin is swallowed into an empty list', () async {
      final service = AttachmentPickerService(_FakePicker(throwOnPick: true));
      expect(await service.pickImages(AttachmentSource.gallery), isEmpty);
    });
  });
}
