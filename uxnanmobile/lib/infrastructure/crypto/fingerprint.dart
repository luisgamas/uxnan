import 'dart:convert';
import 'dart:typed_data';

import 'package:pointycastle/digests/sha256.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/value_objects/text_fingerprint.dart';

/// Computes [TextFingerprint]s (SHA-256) for message deduplication.
///
/// Uses `pointycastle` for a synchronous SHA-256 (spec 02b §5.1). Content is
/// normalized (trimmed) before hashing so trivially different whitespace does
/// not defeat dedup.
class MessageFingerprinter {
  const MessageFingerprinter._();

  /// Returns the fingerprint of [content].
  static TextFingerprint of(String content) {
    final normalized = content.trim();
    final input = Uint8List.fromList(utf8.encode(normalized));
    final digest = SHA256Digest().process(input);
    return TextFingerprint(digest.toHex());
  }
}
