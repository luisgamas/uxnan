/// How the agent's actions are approved (spec 02a — access modes).
enum ApprovalMode {
  /// Always ask before risky/external actions.
  requestApproval,

  /// Auto-approve except for potentially risky actions.
  approveForMe,

  /// Unrestricted access.
  fullAccess,
}

/// The approval mode every new thread starts in (spec 02a — access modes).
///
/// Full access by default so the agent acts without prompting for each tool —
/// the intended experience for this personal tool. It is the single source of
/// truth for the pre-seed UI default and the value persisted to the bridge when
/// a thread has no mode yet; the user can still change it per-thread from the
/// composer's turn-tools sheet.
const ApprovalMode kDefaultApprovalMode = ApprovalMode.fullAccess;
