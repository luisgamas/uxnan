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
}
