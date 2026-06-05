import 'dart:convert';
import 'dart:typed_data';

/// Encoding helpers on [Uint8List] for cryptographic and protocol code.
extension Uint8ListExt on Uint8List {
  /// This byte buffer encoded as a lowercase hexadecimal string.
  String toHex() {
    final buffer = StringBuffer();
    for (final byte in this) {
      buffer.write(byte.toRadixString(16).padLeft(2, '0'));
    }
    return buffer.toString();
  }

  /// This byte buffer encoded as a standard (padded) base64 string.
  String toBase64() => base64.encode(this);

  /// This byte buffer encoded as a URL-safe base64 string without padding.
  String toBase64Url() => base64Url.encode(this).replaceAll('=', '');
}

/// Helpers to construct a [Uint8List] from encoded text.
extension Uint8ListDecode on String {
  /// Decodes this lowercase/uppercase hexadecimal string into bytes.
  Uint8List fromHex() {
    final normalized = length.isOdd ? '0$this' : this;
    final result = Uint8List(normalized.length ~/ 2);
    for (var i = 0; i < result.length; i++) {
      result[i] = int.parse(normalized.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return result;
  }

  /// Decodes this base64 (standard or URL-safe) string into bytes.
  Uint8List fromBase64() => base64.decode(base64.normalize(this));
}
