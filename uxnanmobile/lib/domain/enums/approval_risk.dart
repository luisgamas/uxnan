/// Risk level the agent assigns to an action awaiting approval (spec 02a §6.2,
/// `stream/approval/requested { approvalId, action, risk }`).
enum ApprovalRisk {
  /// Low-risk action (e.g. a read-only command).
  low,

  /// Medium-risk action.
  medium,

  /// High-risk action (e.g. deleting files, network access).
  high,

  /// Risk not reported / unrecognized value.
  unknown,
}
