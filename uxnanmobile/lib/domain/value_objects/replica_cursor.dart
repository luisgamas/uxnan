import 'package:equatable/equatable.dart';

/// How far this phone's copy of one PC's bridge has caught up
/// (`sync/changes`, architecture/02a §5.8.17): the bridge's state directory
/// ([storeId]) and the last revision applied ([rev]). Also keeps the PC's
/// shared start folder ([home]) so it shows while offline.
class ReplicaCursor extends Equatable {
  /// Creates a [ReplicaCursor].
  const ReplicaCursor({required this.storeId, required this.rev, this.home});

  /// Identity of the bridge's state directory; another one means start over.
  final String storeId;

  /// The last sync revision applied.
  final int rev;

  /// The bridge's shared start folder, when known.
  final String? home;

  /// Returns a copy with selected fields replaced.
  ReplicaCursor copyWith({String? storeId, int? rev, String? home}) =>
      ReplicaCursor(
        storeId: storeId ?? this.storeId,
        rev: rev ?? this.rev,
        home: home ?? this.home,
      );

  @override
  List<Object?> get props => [storeId, rev, home];
}
