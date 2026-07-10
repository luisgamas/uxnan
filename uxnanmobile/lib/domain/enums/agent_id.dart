/// Identifier of a supported coding agent.
///
/// Each value maps to a stable wire identifier used by the bridge's agent
/// adapters (see `architecture/03-technical-reference.md` section 6.1). Use
/// [wireId] when serializing and [AgentIdParsing.fromWireId] when decoding.
enum AgentId {
  /// OpenAI Codex CLI.
  codex,

  /// OpenCode.
  opencode,

  /// Anthropic Claude Code.
  claudeCode,

  /// Google Gemini CLI.
  geminiCli,

  /// earendil-works/pi agent.
  piAgent,

  /// Zero — open-source Go coding agent (driven over the ACP).
  zero,

  /// A custom or future agent exposed through the extensible adapter interface.
  custom,
}

/// Serialization helpers for [AgentId].
extension AgentIdWire on AgentId {
  /// The stable wire identifier used in JSON-RPC payloads.
  String get wireId {
    switch (this) {
      case AgentId.codex:
        return 'codex';
      case AgentId.opencode:
        return 'opencode';
      case AgentId.claudeCode:
        return 'claude-code';
      case AgentId.geminiCli:
        return 'gemini-cli';
      case AgentId.piAgent:
        return 'pi-agent';
      case AgentId.zero:
        return 'zero';
      case AgentId.custom:
        return 'custom';
    }
  }
}

/// Decoding helpers for [AgentId].
extension AgentIdParsing on AgentId {
  /// Parses a [wireId] into an [AgentId], falling back to [AgentId.custom] for
  /// unknown identifiers so the app degrades gracefully against newer bridges.
  static AgentId fromWireId(String wireId) {
    switch (wireId) {
      case 'codex':
        return AgentId.codex;
      case 'opencode':
        return AgentId.opencode;
      case 'claude-code':
        return AgentId.claudeCode;
      case 'gemini-cli':
        return AgentId.geminiCli;
      case 'pi-agent':
        return AgentId.piAgent;
      case 'zero':
        return AgentId.zero;
      default:
        return AgentId.custom;
    }
  }
}
