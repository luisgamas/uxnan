import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/client_kind.dart';

/// Where a conversation was started (`Thread.origin`, architecture/02a
/// §5.8.17): on a phone or in Uxnan Desktop, and that device's name.
class ThreadOrigin extends Equatable {
  /// Creates a [ThreadOrigin].
  const ThreadOrigin({required this.kind, required this.name});

  /// Parses the wire `{ kind, name }`; `null` when it is absent or unknown.
  static ThreadOrigin? fromJson(Object? json) {
    if (json is! Map) return null;
    final kind = ClientKind.fromWire(json['kind']);
    final name = json['name'];
    if (kind == null || name is! String) return null;
    return ThreadOrigin(kind: kind, name: name);
  }

  /// The kind of client that started it.
  final ClientKind kind;

  /// The device's (or machine's) name.
  final String name;

  @override
  List<Object?> get props => [kind, name];
}
