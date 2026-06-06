import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// A message in a conversation timeline (spec 02a §5.1.1).
class Message extends Equatable {
  /// Creates a [Message].
  const Message({
    required this.id,
    required this.threadId,
    required this.turnId,
    required this.role,
    required this.contents,
    required this.deliveryState,
    required this.orderIndex,
    required this.createdAt,
    this.fingerprint,
  });

  /// Unique message id.
  final String id;

  /// Owning thread id.
  final String threadId;

  /// Owning turn id.
  final String turnId;

  /// Author role.
  final MessageRole role;

  /// Ordered content blocks.
  final List<MessageContent> contents;

  /// Delivery state.
  final MessageDeliveryState deliveryState;

  /// Monotonic ordering index within the thread.
  final int orderIndex;

  /// Content fingerprint used for deduplication, if computed.
  final String? fingerprint;

  /// Creation timestamp.
  final DateTime createdAt;

  /// Concatenated plain-text projection of all content blocks.
  String get plainText => contents.map((c) => c.asPlainText).join('\n');

  /// Whether any content block is still streaming.
  bool get isStreaming =>
      contents.any((c) => c is TextContent && c.isStreaming);

  /// Returns a copy with the given fields replaced.
  Message copyWith({
    List<MessageContent>? contents,
    MessageDeliveryState? deliveryState,
    int? orderIndex,
    String? fingerprint,
  }) {
    return Message(
      id: id,
      threadId: threadId,
      turnId: turnId,
      role: role,
      contents: contents ?? this.contents,
      deliveryState: deliveryState ?? this.deliveryState,
      orderIndex: orderIndex ?? this.orderIndex,
      createdAt: createdAt,
      fingerprint: fingerprint ?? this.fingerprint,
    );
  }

  @override
  List<Object?> get props => [
        id,
        threadId,
        turnId,
        role,
        contents,
        deliveryState,
        orderIndex,
        fingerprint,
        createdAt,
      ];
}
