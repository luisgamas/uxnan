/// The decision the user sends back for a pending approval request
/// (spec 02a §6.2). Returned to the bridge via `turn/send { approvalResponse }`,
/// which the bridge routes to the approval-capable agent.
enum ApprovalDecision {
  /// Allow this single action.
  approve,

  /// Deny this single action.
  reject,

  /// Allow this action and auto-approve similar ones for the rest of the
  /// session (maps to a session-scoped allow on the bridge).
  approveSession;

  /// The value sent in the `approvalResponse.decision` field.
  String get wireName => switch (this) {
        ApprovalDecision.approve => 'approve',
        ApprovalDecision.reject => 'reject',
        ApprovalDecision.approveSession => 'approveSession',
      };

  /// Parses a wire name, or null when it is not one this app knows.
  static ApprovalDecision? fromWire(String? name) {
    for (final value in ApprovalDecision.values) {
      if (value.wireName == name) return value;
    }
    return null;
  }
}
