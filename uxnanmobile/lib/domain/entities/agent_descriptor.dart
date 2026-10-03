import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';

/// Capabilities a bridge agent advertises (`agent/list`).
class AgentCapabilities extends Equatable {
  /// Creates an [AgentCapabilities].
  const AgentCapabilities({
    this.accessModes = const [],
    this.defaultAccessMode,
    this.streaming = false,
    this.approvals = false,
    this.forking = false,
    this.images = false,
    this.reportsContextUsage = false,
    this.reportsCompaction = false,
    this.autonomous = false,
    this.commands = false,
    this.steering = false,
  });

  /// All-permissive capabilities: a safe default for capability-gated UI when
  /// the bridge has not reported an agent's real capabilities yet, so the UI
  /// never hides a control spuriously (e.g. while offline).
  const AgentCapabilities.permissive()
      : accessModes = ApprovalMode.values,
        defaultAccessMode = ApprovalMode.fullAccess,
        streaming = true,
        approvals = true,
        forking = true,
        images = true,
        reportsContextUsage = true,
        reportsCompaction = true,
        autonomous = true,
        commands = true,
        steering = true;

  /// Reconstructs capabilities from a JSON map (tolerant).
  factory AgentCapabilities.fromJson(Map<String, dynamic> json) =>
      AgentCapabilities(
        accessModes: [
          if (json['accessModes'] is List)
            for (final name in json['accessModes'] as List)
              if (ApprovalMode.fromName(name) case final ApprovalMode mode)
                mode,
        ],
        defaultAccessMode: ApprovalMode.fromName(json['defaultAccessMode']),
        streaming: json['streaming'] == true,
        approvals: json['approvals'] == true,
        forking: json['forking'] == true,
        images: json['images'] == true,
        reportsContextUsage: json['reportsContextUsage'] == true,
        reportsCompaction: json['reportsCompaction'] == true,
        autonomous: json['autonomous'] == true,
        commands: json['commands'] == true,
        steering: json['steering'] == true,
      );

  /// The access modes the agent can honor, in the order they are listed;
  /// empty when it offers none (no selector — it runs as configured).
  final List<ApprovalMode> accessModes;

  /// The mode a conversation runs in when it has none, or has one the agent
  /// does not offer.
  final ApprovalMode? defaultAccessMode;

  /// The mode a conversation stored as [stored] actually runs in: [stored]
  /// when the agent offers it, else its default; null when it offers none.
  /// The same rule the bridge applies before a turn (`effectiveAccessMode`).
  ApprovalMode? effectiveAccessMode(ApprovalMode? stored) {
    if (accessModes.isEmpty) return null;
    if (stored != null && accessModes.contains(stored)) return stored;
    final fallback = defaultAccessMode;
    return fallback != null && accessModes.contains(fallback)
        ? fallback
        : accessModes.first;
  }

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

  /// Whether the adapter emits real context-compaction timeline markers.
  final bool reportsCompaction;

  /// Whether the agent runs in autonomous ("YOLO") mode by default — it acts
  /// and edits without per-action approval prompts (its headless CLI exposes
  /// no pre-tool approval channel). Surfaces in the UI so the user knows the
  /// agent won't ask before running tools.
  final bool autonomous;

  /// Whether the agent exposes special ("slash") commands the app can discover
  /// via `agent/commands` and offer in the composer's `/` palette.
  final bool commands;

  /// Whether the agent takes a message while it works
  /// (`capabilities.steering`): a follow-up still waits in the bridge's queue,
  /// but the first one reaches the agent at its next pause — when the step it
  /// is in ends — instead of when the whole turn does.
  final bool steering;

  @override
  List<Object?> get props => [
        steering,
        accessModes,
        defaultAccessMode,
        streaming,
        approvals,
        forking,
        images,
        reportsContextUsage,
        reportsCompaction,
        autonomous,
        commands,
      ];
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
    this.deprecated = false,
  });

  /// Reconstructs an [AgentDescriptor] from an `agent/list` entry.
  factory AgentDescriptor.fromJson(Map<String, dynamic> json) {
    final caps = json['capabilities'];
    return AgentDescriptor(
      agentId: json['agentId'] as String? ?? '',
      displayName:
          json['displayName'] as String? ?? json['agentId'] as String? ?? '',
      available: json['available'] == true,
      capabilities: caps is Map
          ? AgentCapabilities.fromJson(caps.cast<String, dynamic>())
          : const AgentCapabilities(),
      defaultModel: json['defaultModel'] as String?,
      deprecated: json['deprecated'] == true,
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

  /// Whether the bridge retained this adapter only for legacy installations.
  final bool deprecated;

  @override
  List<Object?> get props => [
        agentId,
        displayName,
        available,
        capabilities,
        defaultModel,
        deprecated,
      ];
}
