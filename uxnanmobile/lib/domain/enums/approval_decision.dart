/// The decision the user sends back for a pending approval request
/// (spec 02a §6.2). Returned to the bridge via `turn/send { approvalResponse }`.
///
/// FOR-DEV: the wire names below are the contract the bridge must accept; the
/// bridge does not yet implement the intake (see `FOR-DEV.md`).
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
}
