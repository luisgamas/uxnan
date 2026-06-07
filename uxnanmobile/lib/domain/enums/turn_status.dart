/// Lifecycle state of a single turn (a user message and the agent's response).
enum TurnStatus {
  /// The turn has been created but the agent has not started responding.
  pending,

  /// The agent is actively generating a response.
  running,

  /// The agent finished the turn successfully.
  completed,

  /// The turn ended in an error.
  error,

  /// The turn was aborted by the user before completion.
  aborted,
}
