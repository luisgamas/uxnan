/// Delivery state of a message in the timeline.
enum MessageDeliveryState {
  /// Locally created, not yet acknowledged by the bridge.
  sending,

  /// Acknowledged as sent by the bridge.
  sent,

  /// Confirmed delivered/persisted (e.g. an inbound assistant message).
  delivered,

  /// Delivery failed.
  failed,

  /// Accepted by the bridge but **waiting** for the in-flight turn to end — the
  /// agent has not seen it yet. Rendered as a "ghost" bubble the user can still
  /// take back.
  queued,

  /// Was queued and taken off the queue before the agent ever saw it. The
  /// message stays in the timeline, marked, rather than disappearing — the user
  /// should be able to see what they decided not to send.
  cancelled,
}
