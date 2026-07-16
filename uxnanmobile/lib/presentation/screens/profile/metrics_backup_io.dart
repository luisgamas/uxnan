import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:uxnan/core/utils/logger.dart';

/// Writes the sealed metrics [blob] to a temp file named [filename] and opens
/// the native share sheet so the user can save it (Files / Drive / email / …).
/// Returns true when the sheet was shown; logs + returns false on any I/O or
/// platform failure so the caller can show a fallback.
Future<bool> shareMetricsBackupFile({
  required String filename,
  required String blob,
  String? subject,
}) async {
  try {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$filename');
    await file.writeAsString(blob);
    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'application/octet-stream')],
      subject: subject ?? filename,
    );
    return true;
  } on Object catch (error, stackTrace) {
    AppLogger.warn('metrics backup export failed', error, stackTrace);
    return false;
  }
}

/// Prompts the user to pick a metrics backup file and returns its UTF-8 text,
/// or null when they cancelled or the file couldn't be read. The bridge does
/// the validation, so any file is accepted here.
Future<String?> pickMetricsBackupFile() async {
  try {
    final result = await FilePicker.platform.pickFiles(withData: true);
    if (result == null || result.files.isEmpty) return null;
    final bytes = result.files.first.bytes;
    if (bytes == null) return null;
    return utf8.decode(bytes);
  } on Object catch (error, stackTrace) {
    AppLogger.warn('metrics backup pick failed', error, stackTrace);
    return null;
  }
}
