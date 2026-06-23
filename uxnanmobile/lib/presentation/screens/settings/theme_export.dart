import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:uxnan/core/utils/logger.dart';

/// Persists [json] to a temp file and opens the native share sheet so the
/// user can save the theme (or library) JSON to a file location of their
/// choice (Files / Drive / email / etc.). Returns true when the share sheet
/// was shown. Logs + returns false on any I/O or platform failure so the
/// caller can show a fallback snackbar.
Future<bool> shareThemeJsonFile({
  required String fileName,
  required String json,
  String? subject,
}) async {
  try {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$fileName');
    await file.writeAsString(json);
    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'application/json')],
      subject: subject ?? fileName,
    );
    return true;
  } on Object catch (error, stackTrace) {
    AppLogger.warn('theme export to file failed', error, stackTrace);
    return false;
  }
}
