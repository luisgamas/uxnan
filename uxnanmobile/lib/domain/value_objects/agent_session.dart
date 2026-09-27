import 'package:equatable/equatable.dart';

/// A session one of the PC's desktop terminals has open right now
/// (`AgentSessionHold`, architecture/02a §5.8.19). While it is held the bridge
/// runs no turn in it — a CLI's session has one writer, and the terminal is it.
class AgentSessionHold extends Equatable {
  /// Creates an [AgentSessionHold].
  const AgentSessionHold({
    required this.agentId,
    required this.sessionId,
    required this.holderName,
    required this.busy,
    this.threadId,
  });

  /// Parses the wire shape; `null` when malformed.
  static AgentSessionHold? fromJson(Object? json) {
    if (json is! Map) return null;
    final agentId = json['agentId'];
    final sessionId = json['sessionId'];
    final holder = json['holder'];
    if (agentId is! String || sessionId is! String || holder is! Map) {
      return null;
    }
    final name = holder['name'];
    final threadId = json['threadId'];
    return AgentSessionHold(
      agentId: agentId,
      sessionId: sessionId,
      holderName: name is String ? name : '',
      busy: json['busy'] == true,
      threadId: threadId is String ? threadId : null,
    );
  }

  /// The agent (bridge `AgentId`).
  final String agentId;

  /// The agent's own session id.
  final String sessionId;

  /// The PC whose terminal holds it.
  final String holderName;

  /// Whether the agent is working now: a hand-off waits until it is not.
  final bool busy;

  /// The conversation that continues the session, when one does.
  final String? threadId;

  /// How the session is known across agents: `agentId:sessionId`.
  String get key => agentSessionKey(agentId, sessionId);

  @override
  List<Object?> get props => [agentId, sessionId, holderName, busy, threadId];
}

/// One of an agent's own sessions in a folder (`AgentSessionSummary`) — one a
/// person had in a terminal or the agent's app, that a conversation can
/// continue.
class AgentSessionSummary extends Equatable {
  /// Creates an [AgentSessionSummary].
  const AgentSessionSummary({
    required this.agentId,
    required this.sessionId,
    required this.cwd,
    required this.updatedAgo,
    this.title,
    this.threadId,
    this.hold,
  });

  /// Parses the wire shape; `null` when malformed.
  static AgentSessionSummary? fromJson(Object? json) {
    if (json is! Map) return null;
    final agentId = json['agentId'];
    final sessionId = json['sessionId'];
    final cwd = json['cwd'];
    final ago = json['updatedAgoMs'];
    if (agentId is! String || sessionId is! String || cwd is! String) {
      return null;
    }
    final title = json['title'];
    final threadId = json['threadId'];
    return AgentSessionSummary(
      agentId: agentId,
      sessionId: sessionId,
      cwd: cwd,
      updatedAgo: Duration(milliseconds: ago is num ? ago.toInt() : 0),
      title: title is String && title.isNotEmpty ? title : null,
      threadId: threadId is String ? threadId : null,
      hold: AgentSessionHold.fromJson(json['hold']),
    );
  }

  /// The agent (bridge `AgentId`).
  final String agentId;

  /// The agent's own session id.
  final String sessionId;

  /// The folder it runs in.
  final String cwd;

  /// How long ago it last changed (an age: two clocks never agree).
  final Duration updatedAgo;

  /// Its name — the CLI's title, else the first thing asked.
  final String? title;

  /// The conversation that continues it, when one does.
  final String? threadId;

  /// The terminal holding it, when one does.
  final AgentSessionHold? hold;

  /// How the session is known across agents: `agentId:sessionId`.
  String get key => agentSessionKey(agentId, sessionId);

  @override
  List<Object?> get props =>
      [agentId, sessionId, cwd, updatedAgo, title, threadId, hold];
}

/// A folder's sessions, as `agentSession/list` answers.
class AgentSessionList extends Equatable {
  /// Creates an [AgentSessionList].
  const AgentSessionList({required this.sessions, required this.unlisted});

  /// Parses the wire result, dropping malformed entries.
  factory AgentSessionList.fromJson(Object? json) {
    final map = json is Map ? json : const <Object?, Object?>{};
    final sessions = map['sessions'];
    final unlisted = map['unlisted'];
    return AgentSessionList(
      sessions: [
        if (sessions is List)
          for (final raw in sessions)
            if (AgentSessionSummary.fromJson(raw)
                case final AgentSessionSummary s)
              s,
      ],
      unlisted: [
        if (unlisted is List)
          for (final id in unlisted)
            if (id is String) id,
      ],
    );
  }

  /// Newest change first.
  final List<AgentSessionSummary> sessions;

  /// Agents whose CLI cannot list its sessions (Antigravity).
  final List<String> unlisted;

  @override
  List<Object?> get props => [sessions, unlisted];
}

/// How asking a terminal to let a session go ended
/// (`agentSession/requestHandoff`).
enum AgentSessionHandoffOutcome {
  /// The agent was closed in its terminal; the session is free.
  released,

  /// The agent is working; ask again when it is done.
  busy,

  /// The person at the PC kept it.
  declined,

  /// The desktop did not answer in time.
  unreachable,

  /// No terminal holds it.
  notHeld;

  /// Parses the wire value; an unknown one reads as [unreachable].
  static AgentSessionHandoffOutcome fromWire(Object? value) =>
      AgentSessionHandoffOutcome.values
          .where((o) => o.name == value)
          .firstOrNull ??
      AgentSessionHandoffOutcome.unreachable;

  /// Whether the session can be continued here now.
  bool get isFree => this == released || this == notHeld;
}

/// How a session is known across agents: `agentId:sessionId`.
String agentSessionKey(String agentId, String sessionId) =>
    '$agentId:$sessionId';
