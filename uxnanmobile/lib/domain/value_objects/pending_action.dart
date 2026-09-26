import 'package:equatable/equatable.dart';

/// What the user did that a PC's bridge has not heard yet.
enum PendingActionKind {
  /// A hand rename of a conversation (`thread/rename`).
  renameThread,

  /// `thread/archive`.
  archiveThread,

  /// `thread/unarchive`.
  unarchiveThread,

  /// `thread/delete`.
  deleteThread,

  /// A new name for the PC itself (`settings/set { name }`).
  renamePc;

  /// The bridge method that carries it.
  String get method => switch (this) {
        PendingActionKind.renameThread => 'thread/rename',
        PendingActionKind.archiveThread => 'thread/archive',
        PendingActionKind.unarchiveThread => 'thread/unarchive',
        PendingActionKind.deleteThread => 'thread/delete',
        PendingActionKind.renamePc => 'settings/set',
      };

  /// The kinds a newer action of this kind, on the same target, makes moot.
  List<PendingActionKind> get supersedes => switch (this) {
        PendingActionKind.renameThread => const [
            PendingActionKind.renameThread,
          ],
        PendingActionKind.archiveThread ||
        PendingActionKind.unarchiveThread =>
          const [
            PendingActionKind.archiveThread,
            PendingActionKind.unarchiveThread,
          ],
        PendingActionKind.deleteThread => const [
            PendingActionKind.renameThread,
            PendingActionKind.archiveThread,
            PendingActionKind.unarchiveThread,
            PendingActionKind.deleteThread,
          ],
        PendingActionKind.renamePc => const [PendingActionKind.renamePc],
      };

  /// Parses a stored name; `null` for one this build does not know.
  static PendingActionKind? fromName(String name) {
    for (final kind in values) {
      if (kind.name == name) return kind;
    }
    return null;
  }
}

/// Something the user did while the PC it belongs to was out of reach, kept
/// until it is reachable (architecture/02a §5.8.17). It is sent with how long
/// ago it was decided (`ageMs`), so the bridge applies it only if nothing
/// decided the same thing later elsewhere: the latest action wins.
class PendingAction extends Equatable {
  /// Creates a [PendingAction].
  const PendingAction({
    required this.deviceId,
    required this.kind,
    required this.targetId,
    required this.decidedAt,
    this.id,
    this.value,
  });

  /// Storage id, in the order the actions were taken; `null` before it is kept.
  final int? id;

  /// `macDeviceId` of the PC it belongs to.
  final String deviceId;

  /// What was done.
  final PendingActionKind kind;

  /// What it was done to: a conversation id, or the PC's own id.
  final String targetId;

  /// The new name, for a rename.
  final String? value;

  /// When the user did it, by this phone's clock.
  final DateTime decidedAt;

  /// The request's params. [ageMs] dates one sent late: how long ago it was
  /// decided; absent for one sent as it happens.
  Map<String, dynamic> params({int? ageMs}) => {
        ...switch (kind) {
          PendingActionKind.renamePc => {'name': value},
          PendingActionKind.renameThread => {
              'threadId': targetId,
              'title': value,
            },
          _ => {'threadId': targetId},
        },
        if (ageMs != null) 'ageMs': ageMs,
      };

  @override
  List<Object?> get props => [id, deviceId, kind, targetId, value, decidedAt];
}
