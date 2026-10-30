import 'package:equatable/equatable.dart';

/// How a conversation's context reaches the agent of the conversation that
/// continues it (`TransferStrategy`, `shared/src/models/thread.ts`;
/// architecture/02a §5.8.21). A continuation is always a NEW conversation —
/// no agent continues another CLI's native session.
enum TransferStrategy {
  /// A budgeted selection the bridge prepares (the default).
  selection,

  /// Only a pointer: the title, the opening request, the last exchange.
  reference,

  /// The whole history copied, and its agent given a selection.
  fork;

  /// Parses the wire value; `null` for anything this build does not know.
  static TransferStrategy? fromWire(Object? value) => switch (value) {
        'selection' => TransferStrategy.selection,
        'reference' => TransferStrategy.reference,
        'fork' => TransferStrategy.fork,
        _ => null,
      };

  /// The wire value.
  String get wire => name;
}

/// Where a continuation's carried-over context stands — proven against the
/// real turn, never assumed (`TransferStatus`).
enum TransferStatus {
  /// Prepared, waiting for the conversation's first message.
  pending,

  /// Went to the agent with a turn that has not ended yet.
  sent,

  /// That turn ended with the agent answering: it has the context.
  delivered,

  /// The bridge stopped while that turn ran; the next message carries it again.
  unverifiable;

  /// Parses the wire value; `null` for anything this build does not know.
  static TransferStatus? fromWire(Object? value) => switch (value) {
        'pending' => TransferStatus.pending,
        'sent' => TransferStatus.sent,
        'delivered' => TransferStatus.delivered,
        'unverifiable' => TransferStatus.unverifiable,
        _ => null,
      };
}

/// What a continuation carried over, measured as the bridge prepared it.
class TransferContextSummary extends Equatable {
  /// Creates a [TransferContextSummary].
  const TransferContextSummary({
    required this.turns,
    required this.omittedTurns,
    required this.bytes,
    required this.approxTokens,
  });

  /// Parses the wire `{ turns, omittedTurns, bytes, approxTokens }`.
  factory TransferContextSummary.fromJson(Object? json) {
    final map = json is Map ? json : const <String, Object?>{};
    int read(String key) => switch (map[key]) {
          final num value => value.toInt(),
          _ => 0,
        };
    return TransferContextSummary(
      turns: read('turns'),
      omittedTurns: read('omittedTurns'),
      bytes: read('bytes'),
      approxTokens: read('approxTokens'),
    );
  }

  /// Turns of the source the context includes.
  final int turns;

  /// Turns of the source it leaves out (the oldest).
  final int omittedTurns;

  /// Size of the context in bytes.
  final int bytes;

  /// Rough token count of the context.
  final int approxTokens;

  /// The wire shape.
  Map<String, Object?> toJson() => {
        'turns': turns,
        'omittedTurns': omittedTurns,
        'bytes': bytes,
        'approxTokens': approxTokens,
      };

  @override
  List<Object?> get props => [turns, omittedTurns, bytes, approxTokens];
}

/// The origin of a conversation that continues another one
/// (`Thread.transfer`).
class ConversationTransfer extends Equatable {
  /// Creates a [ConversationTransfer].
  const ConversationTransfer({
    required this.id,
    required this.strategy,
    required this.sourceThreadId,
    required this.sourceTitle,
    required this.status,
    required this.context,
    this.sourceAgentId,
    this.createdByAgent = false,
    this.turnId,
  });

  /// Parses the wire shape; `null` when it is absent or unreadable.
  static ConversationTransfer? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = json['id'];
    final source = json['sourceThreadId'];
    final strategy = TransferStrategy.fromWire(json['strategy']);
    if (id is! String || source is! String || strategy == null) return null;
    final title = json['sourceTitle'];
    final agent = json['sourceAgentId'];
    final turn = json['turnId'];
    return ConversationTransfer(
      id: id,
      strategy: strategy,
      sourceThreadId: source,
      sourceTitle: title is String ? title : '',
      sourceAgentId: agent is String ? agent : null,
      createdByAgent: json['createdBy'] == 'agent',
      // A status this build does not know is shown as still waiting: the
      // honest reading of "not proven delivered".
      status: TransferStatus.fromWire(json['status']) ?? TransferStatus.pending,
      turnId: turn is String ? turn : null,
      context: TransferContextSummary.fromJson(json['context']),
    );
  }

  /// Stable id of this continuation.
  final String id;

  /// How the context was carried.
  final TransferStrategy strategy;

  /// The conversation it continues (it may since have been deleted).
  final String sourceThreadId;

  /// The source's title when it was continued.
  final String sourceTitle;

  /// The source's agent (wire id), when it had one.
  final String? sourceAgentId;

  /// Whether an agent asked for it through the desktop's control surface.
  final bool createdByAgent;

  /// Where the carried context stands.
  final TransferStatus status;

  /// The turn that carried the context, once one did.
  final String? turnId;

  /// What was carried over.
  final TransferContextSummary context;

  /// The wire shape (what the local store keeps).
  Map<String, Object?> toJson() => {
        'id': id,
        'strategy': strategy.wire,
        'sourceThreadId': sourceThreadId,
        'sourceTitle': sourceTitle,
        if (sourceAgentId != null) 'sourceAgentId': sourceAgentId,
        'createdBy': createdByAgent ? 'agent' : 'user',
        'status': status.name,
        if (turnId != null) 'turnId': turnId,
        'context': context.toJson(),
      };

  @override
  List<Object?> get props => [
        id,
        strategy,
        sourceThreadId,
        sourceTitle,
        sourceAgentId,
        createdByAgent,
        status,
        turnId,
        context,
      ];
}

/// A conversation that continues this one (`Thread.continuations`).
class ThreadContinuation extends Equatable {
  /// Creates a [ThreadContinuation].
  const ThreadContinuation({
    required this.threadId,
    required this.transferId,
    required this.strategy,
    this.agentId,
  });

  /// Parses the wire shape; `null` when it is unreadable.
  static ThreadContinuation? fromJson(Object? json) {
    if (json is! Map) return null;
    final thread = json['threadId'];
    final transfer = json['transferId'];
    final strategy = TransferStrategy.fromWire(json['strategy']);
    if (thread is! String || transfer is! String || strategy == null) {
      return null;
    }
    final agent = json['agentId'];
    return ThreadContinuation(
      threadId: thread,
      transferId: transfer,
      strategy: strategy,
      agentId: agent is String ? agent : null,
    );
  }

  /// Parses a wire list, dropping what cannot be read.
  static List<ThreadContinuation> listFromJson(Object? json) => [
        if (json is List)
          for (final raw in json)
            if (ThreadContinuation.fromJson(raw) case final continuation?)
              continuation,
      ];

  /// The continuing conversation.
  final String threadId;

  /// Its [ConversationTransfer.id].
  final String transferId;

  /// The agent it continues with (wire id).
  final String? agentId;

  /// How the context was carried.
  final TransferStrategy strategy;

  /// The wire shape.
  Map<String, Object?> toJson() => {
        'threadId': threadId,
        'transferId': transferId,
        if (agentId != null) 'agentId': agentId,
        'strategy': strategy.wire,
      };

  @override
  List<Object?> get props => [threadId, transferId, agentId, strategy];
}
