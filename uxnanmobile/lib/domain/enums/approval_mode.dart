/// How much the agent may do before it asks (spec 02a — access modes). Each
/// mode means the same on every agent; an agent offers only the ones it can
/// honor (`AgentCapabilities.accessModes`).
enum ApprovalMode {
  /// Every action with a side effect (writing, running a command, the
  /// network, a path outside the project) waits for the person.
  requestApproval,

  /// Works without asking inside the project; what goes beyond it is decided
  /// by the CLI's own reviewer where it has one.
  approveForMe,

  /// No prompts and no sandbox: the CLI's own bypass.
  fullAccess,

  /// Reads and plans; writes and runs nothing.
  plan;

  /// The mode a wire name (`thread.accessMode`) stands for, or null.
  static ApprovalMode? fromName(Object? name) {
    for (final mode in values) {
      if (mode.name == name) return mode;
    }
    return null;
  }
}
