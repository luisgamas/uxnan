import 'dart:collection';

import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// A user message queued for delivery while disconnected.
class PendingOutboundMessage {
  /// Creates a [PendingOutboundMessage].
  const PendingOutboundMessage({
    required this.message,
    required this.enqueuedAt,
  });

  /// The queued message.
  final RpcMessage message;

  /// When it was enqueued.
  final DateTime enqueuedAt;
}

/// Buffers outbound messages the phone tried to send while disconnected.
///
/// On reconnect the buffer is drained in order, before any new traffic (spec
/// 02c §11.4). It is a sliding window: when full, the oldest entry is dropped.
class OutboundMessageBuffer {
  /// Creates an [OutboundMessageBuffer] holding at most [maxSize] messages.
  OutboundMessageBuffer({this.maxSize = 100});

  /// Maximum number of buffered messages.
  final int maxSize;

  final Queue<PendingOutboundMessage> _queue = Queue<PendingOutboundMessage>();

  /// Adds [message], evicting the oldest entry if the buffer is full.
  void enqueue(RpcMessage message) {
    if (_queue.length >= maxSize) {
      _queue.removeFirst();
    }
    _queue.add(
      PendingOutboundMessage(message: message, enqueuedAt: DateTime.now()),
    );
  }

  /// Removes and returns all buffered messages, in FIFO order.
  List<PendingOutboundMessage> drainAll() {
    final items = _queue.toList();
    _queue.clear();
    return items;
  }

  /// Whether the buffer is empty.
  bool get isEmpty => _queue.isEmpty;

  /// Number of buffered messages.
  int get length => _queue.length;
}
