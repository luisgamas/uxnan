import 'package:flutter/material.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/widgets/agent_logos.dart';

/// Presentation metadata for a coding agent: its logo, display name and accent
/// color. Centralizes the mapping from [AgentId] so lists, headers and chips
/// render agents consistently.
class AgentVisuals {
  const AgentVisuals._();

  /// The SVG logo asset for [id], or null when no dedicated logo exists
  /// (callers should fall back to a generic icon).
  static String? logoFor(AgentId id) => switch (id) {
        AgentId.codex => AgentLogos.codex,
        AgentId.opencode => AgentLogos.opencode,
        AgentId.claudeCode => AgentLogos.claude,
        AgentId.geminiCli => AgentLogos.gemini,
        AgentId.piAgent => AgentLogos.pi,
        AgentId.custom => null,
      };

  /// The human-readable display name for [id].
  static String labelFor(AgentId id) => switch (id) {
        AgentId.codex => 'Codex',
        AgentId.opencode => 'OpenCode',
        AgentId.claudeCode => 'Claude Code',
        AgentId.geminiCli => 'Gemini CLI',
        AgentId.piAgent => 'pi',
        AgentId.custom => 'Agent',
      };

  /// The accent color for [id].
  static Color colorFor(AgentId id) => switch (id) {
        AgentId.codex => UxnanColors.codexAgent,
        AgentId.opencode => UxnanColors.openCodeAgent,
        AgentId.claudeCode => UxnanColors.claudeCodeAgent,
        AgentId.geminiCli => UxnanColors.geminiCliAgent,
        AgentId.piAgent => UxnanColors.piAgentColor,
        AgentId.custom => UxnanColors.onSurfaceMuted,
      };
}
