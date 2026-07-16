import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';

/// Per-agent usage tally (conversations started with a given agent), for the
/// profile / per-PC "by agent" breakdown.
class AgentUsage extends Equatable {
  /// Creates an [AgentUsage].
  const AgentUsage({required this.agentId, required this.conversations});

  /// The agent's wire id (e.g. `claude-code`, `codex`).
  final String agentId;

  /// How many conversations were started with this agent (in scope).
  final int conversations;

  @override
  List<Object?> get props => [agentId, conversations];
}

/// Aggregated metrics for the profile screen (all PCs) or one PC's details
/// screen (when scoped to a `deviceId`). Everything here is derived
/// locally from already-persisted data (threads, messages, git actions) plus
/// the phone-local connection-session log — no wire call.
class ProfileMetrics extends Equatable {
  /// Creates a [ProfileMetrics].
  const ProfileMetrics({
    required this.conversations,
    required this.agentsUsed,
    required this.modelsUsed,
    required this.messages,
    required this.gitActions,
    required this.sessions,
    required this.totalConnected,
    required this.longestSession,
    required this.relaySessions,
    required this.directSessions,
    required this.byAgent,
    this.totalTokens = 0,
    this.memberSince,
    this.mostUsedTransport,
  });

  /// An empty result (no data yet), so the UI can render zeros without a null.
  const ProfileMetrics.empty()
      : conversations = 0,
        agentsUsed = 0,
        modelsUsed = 0,
        messages = 0,
        gitActions = 0,
        sessions = 0,
        totalConnected = Duration.zero,
        longestSession = Duration.zero,
        relaySessions = 0,
        directSessions = 0,
        byAgent = const [],
        totalTokens = 0,
        memberSince = null,
        mostUsedTransport = null;

  /// Total conversations (threads) started.
  final int conversations;

  /// Distinct agents used.
  final int agentsUsed;

  /// Distinct models used.
  final int modelsUsed;

  /// Total messages exchanged.
  final int messages;

  /// Total Git actions performed.
  final int gitActions;

  /// Number of connection sessions recorded.
  final int sessions;

  /// Cumulative time connected across all sessions.
  final Duration totalConnected;

  /// The single longest connection session.
  final Duration longestSession;

  /// How many sessions ran over the relay.
  final int relaySessions;

  /// How many sessions ran over a direct LAN/Tailscale host.
  final int directSessions;

  /// Per-agent conversation tallies, most-used first.
  final List<AgentUsage> byAgent;

  /// Total tokens processed across all agents/days (throughput, not billed
  /// cost). 0 when unknown — e.g. the drift fallback, which has no tokens.
  final int totalTokens;

  /// The earliest conversation's creation time ("member since"), or null when
  /// there are no conversations yet.
  final DateTime? memberSince;

  /// The transport used by the most sessions, or null when there are none.
  final ConnectionTransport? mostUsedTransport;

  @override
  List<Object?> get props => [
        conversations,
        agentsUsed,
        modelsUsed,
        messages,
        gitActions,
        sessions,
        totalConnected,
        longestSession,
        relaySessions,
        directSessions,
        byAgent,
        totalTokens,
        memberSince,
        mostUsedTransport,
      ];
}
