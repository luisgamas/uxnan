import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/client_kind.dart';

/// One client connected to a bridge right now (`ClientPresence`,
/// architecture/02a §5.8.17) — how the phone knows Uxnan Desktop is linked.
class ClientPresence extends Equatable {
  /// Creates a [ClientPresence].
  const ClientPresence({
    required this.id,
    required this.kind,
    required this.name,
    required this.since,
  });

  /// Parses one wire entry; `null` when it is malformed.
  static ClientPresence? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = json['id'];
    final kind = ClientKind.fromWire(json['kind']);
    final name = json['name'];
    final since = json['since'];
    if (id is! String || kind == null || name is! String) return null;
    return ClientPresence(
      id: id,
      kind: kind,
      name: name,
      since: DateTime.fromMillisecondsSinceEpoch(since is int ? since : 0),
    );
  }

  /// Parses a wire list, dropping malformed entries.
  static List<ClientPresence> listFromJson(Object? json) => [
        if (json is List)
          for (final raw in json)
            if (fromJson(raw) case final ClientPresence presence) presence,
      ];

  /// Stable id (a phone's device id, `local:desktop` for the desktop).
  final String id;

  /// What kind of client it is.
  final ClientKind kind;

  /// Its human name.
  final String name;

  /// When this connection opened.
  final DateTime since;

  @override
  List<Object?> get props => [id, kind, name, since];
}
