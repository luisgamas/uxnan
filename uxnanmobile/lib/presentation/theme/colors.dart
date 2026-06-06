import 'package:flutter/material.dart';

/// Centralized color tokens for the Uxnan design system.
///
/// The palette is split into light and dark variants so the app can follow the
/// system theme without losing the brand colors. These are the only place raw
/// color literals are allowed; all widgets reference these tokens or the
/// derived [ColorScheme].
class UxnanColors {
  const UxnanColors._();

  // Brand.
  /// Primary brand color in light mode.
  static const Color lightPrimary = Color(0xFF1B6EF3);

  /// Primary brand color in dark mode.
  static const Color primary = Color(0xFF1B6EF3);

  /// Primary container color in light mode.
  static const Color lightPrimaryContainer = Color(0xFFD8E6FF);

  /// Container variant of [primary] in dark mode.
  static const Color primaryContainer = Color(0xFF0D3A7A);

  /// Foreground color used on top of [lightPrimary].
  static const Color lightOnPrimary = Color(0xFFFFFFFF);

  /// Foreground color used on top of [primary].
  static const Color onPrimary = Color(0xFFFFFFFF);

  /// Secondary accent color in light mode.
  static const Color lightSecondary = Color(0xFF008B67);

  /// Secondary accent color in dark mode.
  static const Color secondary = Color(0xFF00C896);

  /// Container variant of [secondary] in light mode.
  static const Color lightSecondaryContainer = Color(0xFFCFF5E9);

  /// Container variant of [secondary] in dark mode.
  static const Color secondaryContainer = Color(0xFF003D2C);

  /// Foreground color used on top of [lightSecondary].
  static const Color lightOnSecondary = Color(0xFFFFFFFF);

  /// Foreground color used on top of [secondary].
  static const Color onSecondary = Color(0xFF000000);

  // Error and warning.
  /// Error color in light mode.
  static const Color lightError = Color(0xFFB3261E);

  /// Error color in dark mode.
  static const Color error = Color(0xFFFF4D4D);

  /// Warning color.
  static const Color warning = Color(0xFFFFA500);

  /// Success color.
  static const Color success = Color(0xFF00C896);

  /// Primary background surface in light mode.
  static const Color lightSurface = Color(0xFFF8FAFD);

  /// Primary background surface in dark mode.
  static const Color surface = Color(0xFF0F1117);

  /// Surface used for cards and panels in light mode.
  static const Color lightSurfaceVariant = Color(0xFFE7EBF4);

  /// Surface used for cards and panels in dark mode.
  static const Color surfaceVariant = Color(0xFF1A1D27);

  /// Surface used for modals and bottom sheets in light mode.
  static const Color lightSurfaceElevated = Color(0xFFFFFFFF);

  /// Surface used for modals and bottom sheets in dark mode.
  static const Color surfaceElevated = Color(0xFF22263A);

  /// Subtle border/outline color in light mode.
  static const Color lightOutline = Color(0xFFB5BECC);

  /// Subtle border/outline color in dark mode.
  static const Color outline = Color(0xFF2E3347);

  // Text.
  /// Primary on-surface text color in light mode.
  static const Color lightOnSurface = Color(0xFF111827);

  /// Primary on-surface text color in dark mode.
  static const Color onSurface = Color(0xFFEAEBF0);

  /// Muted on-surface text color in light mode.
  static const Color lightOnSurfaceMuted = Color(0xFF5B6474);

  /// Muted on-surface text color in dark mode.
  static const Color onSurfaceMuted = Color(0xFF8892A4);

  /// Disabled on-surface text color in light mode.
  static const Color lightOnSurfaceDisabled = Color(0xFF98A1B3);

  /// Disabled on-surface text color in dark mode.
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

  /// Returns the surface text color for [brightness].
  static Color onSurfaceFor(Brightness brightness) {
    return brightness == Brightness.dark ? onSurface : lightOnSurface;
  }

  /// Returns the muted surface text color for [brightness].
  static Color onSurfaceMutedFor(Brightness brightness) {
    return brightness == Brightness.dark ? onSurfaceMuted : lightOnSurfaceMuted;
  }

  /// Returns the primary brand color for [brightness].
  static Color primaryFor(Brightness brightness) {
    return brightness == Brightness.dark ? primary : lightPrimary;
  }

  /// Returns the primary container color for [brightness].
  static Color primaryContainerFor(Brightness brightness) {
    return brightness == Brightness.dark
        ? primaryContainer
        : lightPrimaryContainer;
  }

  /// Returns the secondary brand color for [brightness].
  static Color secondaryFor(Brightness brightness) {
    return brightness == Brightness.dark ? secondary : lightSecondary;
  }

  /// Returns the secondary container color for [brightness].
  static Color secondaryContainerFor(Brightness brightness) {
    return brightness == Brightness.dark
        ? secondaryContainer
        : lightSecondaryContainer;
  }

  /// Returns the surface color for [brightness].
  static Color surfaceFor(Brightness brightness) {
    return brightness == Brightness.dark ? surface : lightSurface;
  }

  /// Returns the elevated surface color for [brightness].
  static Color surfaceElevatedFor(Brightness brightness) {
    return brightness == Brightness.dark
        ? surfaceElevated
        : lightSurfaceElevated;
  }

  /// Returns the surface variant color for [brightness].
  static Color surfaceVariantFor(Brightness brightness) {
    return brightness == Brightness.dark ? surfaceVariant : lightSurfaceVariant;
  }

  /// Returns the outline color for [brightness].
  static Color outlineFor(Brightness brightness) {
    return brightness == Brightness.dark ? outline : lightOutline;
  }

  /// Returns the error color for [brightness].
  static Color errorFor(Brightness brightness) {
    return brightness == Brightness.dark ? error : lightError;
  }
}
