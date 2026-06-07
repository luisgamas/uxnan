import 'package:uxnan/domain/entities/message.dart';

/// Resolves a deduplication key for a message lacking a precomputed
/// [Message.fingerprint].
typedef MessageFingerprintResolver = String Function(Message message);

/// Suppresses duplicate messages during reconnects or bridge replays
/// (spec 02a §5.6.5).
///
/// Pure domain service: it dedups by [Message.fingerprint] when present, else
/// by the injected [MessageFingerprintResolver] (defaulting to the message id).
/// The production resolver hashes the message's plain text via the crypto
/// layer.
class MessageDeduplicator {
  /// Creates a [MessageDeduplicator] with an optional fallback key resolver.
  MessageDeduplicator({MessageFingerprintResolver? fingerprintOf})
      : _fingerprintOf = fingerprintOf ?? _idResolver;

  final MessageFingerprintResolver _fingerprintOf;
  final Set<String> _seen = <String>{};

  static String _idResolver(Message message) => message.id;

  /// Records [message] and returns whether it was already seen.
  bool isDuplicate(Message message) {
    final key = message.fingerprint ?? _fingerprintOf(message);
    return !_seen.add(key);
  }

  /// Clears the seen set.
  void reset() => _seen.clear();

  /// Number of distinct messages seen so far.
  int get seenCount => _seen.length;
}
