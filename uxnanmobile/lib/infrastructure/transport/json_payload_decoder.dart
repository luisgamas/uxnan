import 'dart:convert';
import 'dart:isolate';
import 'dart:typed_data';

/// Runs [work] somewhere other than the calling isolate and returns its result.
typedef BackgroundRun = Future<Object?> Function(Object? Function() work);

/// Decodes a decrypted JSON-RPC payload — once, and off the UI isolate when
/// it is large.
///
/// A page of history is up to a mebibyte of JSON; decoding it builds every map
/// and string of it, which on the UI isolate is a dropped frame or several.
/// Payloads of [isolateThreshold] bytes or more are decoded on a short-lived
/// background isolate ([Isolate.run]); the decoded graph comes back without
/// being copied (the isolate exits with it). Small ones — deltas, the vast
/// majority — are decoded in place, where an isolate would cost more than it
/// saves.
///
/// This decides only WHERE a payload decodes. Its caller keeps the order:
/// the session coordinator awaits each frame before it starts the next, so a
/// large page decoding in the background is never overtaken by a delta that
/// arrived after it.
class JsonPayloadDecoder {
  /// Creates a [JsonPayloadDecoder].
  const JsonPayloadDecoder({
    this.isolateThreshold = defaultIsolateThreshold,
    BackgroundRun? runInBackground,
  }) : _runInBackground = runInBackground;

  /// The payload size from which decoding moves off the calling isolate.
  static const int defaultIsolateThreshold = 64 * 1024;

  /// The payload size from which decoding moves off the calling isolate.
  final int isolateThreshold;

  final BackgroundRun? _runInBackground;

  /// [bytes] (UTF-8 JSON) decoded into a JSON object; throws a
  /// [FormatException] when it is not one.
  Future<Map<String, dynamic>> decodeObject(Uint8List bytes) async {
    final Object? decoded;
    if (bytes.length < isolateThreshold) {
      decoded = _decodeUtf8Json(bytes);
    } else {
      final run = _runInBackground ?? Isolate.run<Object?>;
      decoded = await run(() => _decodeUtf8Json(bytes));
    }
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('The payload is not a JSON object');
    }
    return decoded;
  }
}

/// Top-level so the closure sent to the background isolate captures nothing
/// but the bytes.
Object? _decodeUtf8Json(Uint8List bytes) => jsonDecode(utf8.decode(bytes));
