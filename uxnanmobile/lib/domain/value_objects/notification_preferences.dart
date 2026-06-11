import 'package:equatable/equatable.dart';

/// What the phone wants to be pushed about (spec contract
/// `NotificationPreferences`). Mirrors the bridge type
/// `{ turnCompleted, turnError }` and is sent on `notifications/register` and
/// `notifications/update`. Defaults to fully opted-in.
class NotificationPreferences extends Equatable {
  /// Creates a [NotificationPreferences]; both channels default to on.
  const NotificationPreferences({
    this.turnCompleted = true,
    this.turnError = true,
  });

  /// Reconstructs preferences from a stored/wire map; missing fields default to
  /// on (tolerant, matching the bridge's `readPreferences`).
  factory NotificationPreferences.fromJson(Map<String, dynamic> json) =>
      NotificationPreferences(
        turnCompleted: _boolOr(json['turnCompleted'], fallback: true),
        turnError: _boolOr(json['turnError'], fallback: true),
      );

  /// Notify when an agent turn completes.
  final bool turnCompleted;

  /// Notify when an agent turn errors.
  final bool turnError;

  /// Returns a copy with the given fields overridden.
  NotificationPreferences copyWith({bool? turnCompleted, bool? turnError}) =>
      NotificationPreferences(
        turnCompleted: turnCompleted ?? this.turnCompleted,
        turnError: turnError ?? this.turnError,
      );

  /// Serializes to the wire/storage shape.
  Map<String, dynamic> toJson() => {
        'turnCompleted': turnCompleted,
        'turnError': turnError,
      };

  @override
  List<Object?> get props => [turnCompleted, turnError];
}

/// Returns [value] when it is a bool, else [fallback] — keeps the parser
/// tolerant of missing/malformed fields without throwing.
bool _boolOr(Object? value, {required bool fallback}) =>
    value is bool ? value : fallback;
