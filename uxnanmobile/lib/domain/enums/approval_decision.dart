/// The decision the user sends back for a pending approval request
/// (spec 02a §6.2). Returned to the bridge via `turn/send { approvalResponse }`,
/// which the bridge routes to the agent (Claude/Codex/Gemini/OpenCode).
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
