import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';

/// A stored message without its contents: what a re-sync needs to decide
/// whether a message must be rewritten at all, read without decoding it.
class MessageHead extends Equatable {
  /// Creates a [MessageHead].
  const MessageHead({
    required this.id,
    required this.turnId,
    required this.role,
    required this.deliveryState,
    required this.orderIndex,
    required this.createdAt,
    this.fingerprint,
    this.continuedIn,
    this.turnDuration,
  });

  /// Message id.
  final String id;

  /// Owning turn id (empty for a local echo not yet stamped).
  final String turnId;

  /// Author role.
  final MessageRole role;

  /// Delivery state.
  final MessageDeliveryState deliveryState;

  /// Position in the thread.
  final int orderIndex;

  /// When it was created.
  final DateTime createdAt;

  /// `Message.fingerprint`.
  final String? fingerprint;

  /// `Message.continuedIn`.
  final String? continuedIn;

  /// `Message.turnDuration`.
  final Duration? turnDuration;

  @override
  List<Object?> get props => [
        id,
        turnId,
        role,
        deliveryState,
        orderIndex,
        createdAt,
        fingerprint,
        continuedIn,
        turnDuration,
      ];
}
