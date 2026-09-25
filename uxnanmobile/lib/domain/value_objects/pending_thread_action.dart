import 'package:equatable/equatable.dart';

/// What the user did to a conversation that the bridge has not heard yet.
enum PendingThreadActionKind {
  /// A hand rename (`thread/rename`).
  rename,

  /// `thread/archive`.
  archive,

  /// `thread/unarchive`.
  unarchive,

  /// `thread/delete`.
  delete;

  /// The bridge method that carries it.
  String get method => switch (this) {
        PendingThreadActionKind.rename => 'thread/rename',
        PendingThreadActionKind.archive => 'thread/archive',
        PendingThreadActionKind.unarchive => 'thread/unarchive',
        PendingThreadActionKind.delete => 'thread/delete',
      };

  /// Parses a stored name; `null` for one this build does not know.
  static PendingThreadActionKind? fromName(String name) {
    for (final kind in values) {
      if (kind.name == name) return kind;
    }
    return null;
  }
}

/// An action on a conversation taken while this phone could not reach the
/// conversation's PC, kept until it can (architecture/02a §5.8.17). It is sent
/// with how long ago it was decided (`ageMs`), so the bridge applies it only if
/// nothing decided the same thing later elsewhere: the latest action wins.
class PendingThreadAction extends Equatable {
  /// Creates a [PendingThreadAction].
  const PendingThreadAction({
    required this.deviceId,
    required this.threadId,
    required this.kind,
    required this.decidedAt,
    this.id,
    this.title,
  });

  /// Storage id, in the order the actions were taken; `null` before it is kept.
  final int? id;

  /// `macDeviceId` of the PC the conversation belongs to.
  final String deviceId;

  /// The conversation.
  final String threadId;

  /// What was done.
  final PendingThreadActionKind kind;

  /// The new title, for a [PendingThreadActionKind.rename].
  final String? title;

  /// When the user did it, by this phone's clock.
  final DateTime decidedAt;

  /// The request's params. [ageMs] dates one sent late: how long ago it was
  /// decided; absent for one sent as it happens.
  Map<String, dynamic> params({int? ageMs}) => {
        'threadId': threadId,
        if (kind == PendingThreadActionKind.rename) 'title': title,
        if (ageMs != null) 'ageMs': ageMs,
      };

  @override
  List<Object?> get props => [id, deviceId, threadId, kind, title, decidedAt];
}
