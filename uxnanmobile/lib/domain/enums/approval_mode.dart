/// How the agent's actions are approved (spec 02a — access modes).
enum ApprovalMode {
  /// Always ask before risky/external actions.
  requestApproval,

  /// Auto-approve except for potentially risky actions.
  approveForMe,

  /// Unrestricted access.
  fullAccess,
}
