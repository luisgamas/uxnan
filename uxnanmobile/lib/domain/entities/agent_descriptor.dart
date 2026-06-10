import 'package:equatable/equatable.dart';

/// Capabilities a bridge agent advertises (`agent/list`).
class AgentCapabilities extends Equatable {
  /// Creates an [AgentCapabilities].
  const AgentCapabilities({
    this.planMode = false,
    this.streaming = false,
    this.approvals = false,
    this.forking = false,
    this.images = false,
    this.reportsContextUsage = false,
  });

  /// All-permissive capabilities: a safe default for capability-gated UI when
  /// the bridge has not reported an agent's real capabilities yet, so the UI
  /// never hides a control spuriously (e.g. while offline).
  const AgentCapabilities.permissive()
      : planMode = true,
        streaming = true,
        approvals = true,
        forking = true,
        images = true,
        reportsContextUsage = true;

  /// Reconstructs capabilities from a JSON map (tolerant).
  factory AgentCapabilities.fromJson(Map<String, dynamic> json) =>
      AgentCapabilities(
        planMode: json['planMode'] == true,
        streaming: json['streaming'] == true,
        approvals: json['approvals'] == true,
        forking: json['forking'] == true,
        images: json['images'] == true,
        reportsContextUsage: json['reportsContextUsage'] == true,
      );

  /// Whether the agent supports a planning mode.
  final bool planMode;

  /// Whether the agent streams responses.
  final bool streaming;

  /// Whether the agent supports approval gating.
  final bool approvals;

  /// Whether the agent supports forking a thread.
  final bool forking;

  /// Whether the agent accepts image inputs.
  final bool images;

  /// Whether the agent reports per-turn token/context usage (drives the context
  /// meter, shown at 0 until the first turn).
  final bool reportsContextUsage;

  @override
  List<Object?> get props =>
      [planMode, streaming, approvals, forking, images, reportsContextUsage];
}

/// A coding agent exposed by the bridge (`agent/list`).
///
/// Mirrors the bridge contract `AgentDescriptor = { agentId, displayName,
/// available, capabilities, defaultModel? }`. The parser is tolerant so the app
/// degrades gracefully against newer bridges.
class AgentDescriptor extends Equatable {
  /// Creates an [AgentDescriptor].
  const AgentDescriptor({
    required this.agentId,
    required this.displayName,
    required this.available,
    this.capabilities = const AgentCapabilities(),
    this.defaultModel,
  });

  /// Reconstructs an [AgentDescriptor] from an `agent/list` entry.
  factory AgentDescriptor.fromJson(Map<String, dynamic> json) {
    final caps = json['capabilities'];
    return AgentDescriptor(
      agentId: json['agentId'] as String? ?? '',
      displayName: json['displayName'] as String? ??
          json['agentId'] as String? ??
          '',
      available: json['available'] == true,
      capabilities: caps is Map
          ? AgentCapabilities.fromJson(caps.cast<String, dynamic>())
          : const AgentCapabilities(),
      defaultModel: json['defaultModel'] as String?,
    );
  }

  /// The agent's wire identifier (see `AgentId.wireId`).
  final String agentId;

  /// Human readable display name.
  final String displayName;

  /// Whether the agent is currently usable (e.g. installed/authenticated).
  final bool available;

  /// The agent's advertised capabilities.
  final AgentCapabilities capabilities;

  /// The agent's default model, if any.
  final String? defaultModel;

  @override
  List<Object?> get props =>
      [agentId, displayName, available, capabilities, defaultModel];
}
