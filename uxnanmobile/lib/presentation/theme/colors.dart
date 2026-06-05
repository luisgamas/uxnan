import 'package:flutter/material.dart';

/// Centralized color tokens for the Uxnan design system.
///
/// The palette is dark-first and tuned for a terminal/code context, per
/// `architecture/02c-implementation-guide.md` (section 3.1). These are the only
/// place raw color literals are allowed; all widgets reference these tokens or
/// the derived [ColorScheme].
class UxnanColors {
  const UxnanColors._();

  // Primary — deep blue (product identity).
  /// Primary brand color.
  static const Color primary = Color(0xFF1B6EF3);

  /// Container variant of [primary].
  static const Color primaryContainer = Color(0xFF0D3A7A);

  /// Foreground color used on top of [primary].
  static const Color onPrimary = Color(0xFFFFFFFF);

  // Secondary — terminal green (code, success, Git).
  /// Secondary accent color.
  static const Color secondary = Color(0xFF00C896);

  /// Container variant of [secondary].
  static const Color secondaryContainer = Color(0xFF003D2C);

  /// Foreground color used on top of [secondary].
  static const Color onSecondary = Color(0xFF000000);

  // Error and warning.
  /// Error color.
  static const Color error = Color(0xFFFF4D4D);

  /// Warning color.
  static const Color warning = Color(0xFFFFA500);

  /// Success color.
  static const Color success = Color(0xFF00C896);

  // Surfaces — dark-first.
  /// Primary background surface.
  static const Color surface = Color(0xFF0F1117);

  /// Surface used for cards and panels.
  static const Color surfaceVariant = Color(0xFF1A1D27);

  /// Surface used for modals and bottom sheets.
  static const Color surfaceElevated = Color(0xFF22263A);

  /// Subtle border/outline color.
  static const Color outline = Color(0xFF2E3347);

  // Text.
  /// Primary on-surface text color.
  static const Color onSurface = Color(0xFFEAEBF0);

  /// Muted on-surface text color.
  static const Color onSurfaceMuted = Color(0xFF8892A4);

  /// Disabled on-surface text color.
  static const Color onSurfaceDisabled = Color(0xFF444A5A);

  // Git-specific.
  /// Color for added lines/files in diffs.
  static const Color gitAdded = Color(0xFF3FB950);

  /// Color for deleted lines/files in diffs.
  static const Color gitDeleted = Color(0xFFF85149);

  /// Color for modified lines/files in diffs.
  static const Color gitModified = Color(0xFFE3B341);

  /// Color for untracked files.
  static const Color gitUntracked = Color(0xFF58A6FF);

  // Connection state.
  /// Indicator color when connected.
  static const Color connected = Color(0xFF3FB950);

  /// Indicator color while connecting.
  static const Color connecting = Color(0xFFFFA657);

  /// Indicator color when disconnected.
  static const Color disconnected = Color(0xFFFF4D4D);

  /// Indicator color while syncing.
  static const Color syncing = Color(0xFF58A6FF);

  // Agents (per-provider colors).
  /// Brand color for the Codex agent.
  static const Color codexAgent = Color(0xFF00A67E);

  /// Brand color for the OpenCode agent.
  static const Color openCodeAgent = Color(0xFF7C3AED);

  /// Brand color for the Claude Code agent.
  static const Color claudeCodeAgent = Color(0xFFD97706);

  /// Brand color for the Gemini CLI agent.
  static const Color geminiCliAgent = Color(0xFF4285F4);

  /// Brand color for the pi-agent.
  static const Color piAgentColor = Color(0xFF2563EB);
}
