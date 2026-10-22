/// A short, stable fingerprint of a decoded JSON value: two values with the
/// same content always get the same one, whatever the order their maps'
/// keys arrived in — so a re-sync can tell a message it already stored from
/// a changed one without decoding or comparing either.
///
/// Not cryptographic: two 32-bit FNV-1a hashes over a canonical walk of the
/// value (map keys sorted, every node tagged with its kind and length),
/// printed as 16 hex digits. Written out here rather than taken from
/// `Object.hash` / `String.hashCode`, which Dart does not promise to keep
/// across versions — and a stored fingerprint must outlive the app version
/// that wrote it.
String jsonFingerprint(Object? value) {
  final hash = _Fnv();
  _walk(value, hash);
  return hash.hex;
}

void _walk(Object? value, _Fnv hash) {
  switch (value) {
    case null:
      hash.tag(0x6e);
    case final bool b:
      hash.tag(b ? 0x74 : 0x66);
    case final num n:
      hash
        ..tag(0x23)
        ..string(n.toString());
    case final String s:
      hash
        ..tag(0x22)
        ..integer(s.length)
        ..string(s);
    case final List<Object?> list:
      hash
        ..tag(0x5b)
        ..integer(list.length);
      for (final item in list) {
        _walk(item, hash);
      }
    case final Map<Object?, Object?> map:
      final keys = [for (final key in map.keys) key.toString()]..sort();
      hash
        ..tag(0x7b)
        ..integer(keys.length);
      for (final key in keys) {
        hash
          ..integer(key.length)
          ..string(key);
        _walk(map[key], hash);
      }
    default:
      hash
        ..tag(0x3f)
        ..string(value.toString());
  }
}

/// Two FNV-1a 32-bit hashes with different offset bases, fed the same bytes.
class _Fnv {
  int _a = 0x811c9dc5;
  int _b = 0x050c5d1f;

  static const int _prime = 0x01000193;

  void tag(int byte) {
    _a = ((_a ^ byte) * _prime) & 0xffffffff;
    _b = ((_b ^ (byte ^ 0x5a)) * _prime) & 0xffffffff;
  }

  void integer(int value) {
    for (var shift = 0; shift < 32; shift += 8) {
      tag((value >> shift) & 0xff);
    }
  }

  void string(String text) {
    // The hot loop: a page is mostly strings, so the state stays in locals.
    var a = _a;
    var b = _b;
    for (var i = 0; i < text.length; i++) {
      final unit = text.codeUnitAt(i);
      final low = unit & 0xff;
      final high = unit >> 8;
      a = ((a ^ low) * _prime) & 0xffffffff;
      b = ((b ^ (low ^ 0x5a)) * _prime) & 0xffffffff;
      a = ((a ^ high) * _prime) & 0xffffffff;
      b = ((b ^ (high ^ 0x5a)) * _prime) & 0xffffffff;
    }
    _a = a;
    _b = b;
  }

  String get hex =>
      _a.toRadixString(16).padLeft(8, '0') +
      _b.toRadixString(16).padLeft(8, '0');
}
