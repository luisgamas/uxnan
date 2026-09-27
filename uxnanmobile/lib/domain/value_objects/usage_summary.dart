import 'package:equatable/equatable.dart';

/// What some model responses spent. Mirrors `shared` `UsageSpend`.
class UsageSpend extends Equatable {
  /// Creates a [UsageSpend].
  const UsageSpend({
    this.inputTokens = 0,
    this.cachedInputTokens = 0,
    this.cacheWriteTokens = 0,
    this.outputTokens = 0,
    this.reasoningTokens = 0,
    this.costUsd = 0,
    this.estimatedCostUsd = 0,
    this.unpricedTokens = 0,
    this.responses = 0,
  });

  /// Reconstructs a [UsageSpend] from its wire map.
  factory UsageSpend.fromJson(Map<String, dynamic> json) => UsageSpend(
        inputTokens: _int(json['inputTokens']),
        cachedInputTokens: _int(json['cachedInputTokens']),
        cacheWriteTokens: _int(json['cacheWriteTokens']),
        outputTokens: _int(json['outputTokens']),
        reasoningTokens: _int(json['reasoningTokens']),
        costUsd: _double(json['costUsd']),
        estimatedCostUsd: _double(json['estimatedCostUsd']),
        unpricedTokens: _int(json['unpricedTokens']),
        responses: _int(json['responses']),
      );

  /// Input tokens not read from the cache.
  final int inputTokens;

  /// Input tokens read from the cache.
  final int cachedInputTokens;

  /// Input tokens written to the cache.
  final int cacheWriteTokens;

  /// Output tokens, reasoning included.
  final int outputTokens;

  /// The reasoning part of [outputTokens].
  final int reasoningTokens;

  /// Billed where the CLI records it, plus [estimatedCostUsd].
  final double costUsd;

  /// The part of [costUsd] estimated at API prices.
  final double estimatedCostUsd;

  /// Tokens of models with no known price (not in [costUsd]).
  final int unpricedTokens;

  /// Model responses counted.
  final int responses;

  /// Every token read or written.
  int get tokens =>
      inputTokens + cachedInputTokens + cacheWriteTokens + outputTokens;

  /// Spend whose cost is unknown: nothing billed, nothing priced — never
  /// shown as $0.
  bool get unpriced => costUsd == 0 && unpricedTokens > 0;

  /// This plus [other].
  UsageSpend operator +(UsageSpend other) => UsageSpend(
        inputTokens: inputTokens + other.inputTokens,
        cachedInputTokens: cachedInputTokens + other.cachedInputTokens,
        cacheWriteTokens: cacheWriteTokens + other.cacheWriteTokens,
        outputTokens: outputTokens + other.outputTokens,
        reasoningTokens: reasoningTokens + other.reasoningTokens,
        costUsd: costUsd + other.costUsd,
        estimatedCostUsd: estimatedCostUsd + other.estimatedCostUsd,
        unpricedTokens: unpricedTokens + other.unpricedTokens,
        responses: responses + other.responses,
      );

  /// The wire map.
  Map<String, dynamic> toJson() => {
        'inputTokens': inputTokens,
        'cachedInputTokens': cachedInputTokens,
        'cacheWriteTokens': cacheWriteTokens,
        'outputTokens': outputTokens,
        'reasoningTokens': reasoningTokens,
        'costUsd': costUsd,
        'estimatedCostUsd': estimatedCostUsd,
        'unpricedTokens': unpricedTokens,
        'responses': responses,
      };

  @override
  List<Object?> get props => [
        inputTokens,
        cachedInputTokens,
        cacheWriteTokens,
        outputTokens,
        reasoningTokens,
        costUsd,
        estimatedCostUsd,
        unpricedTokens,
        responses,
      ];
}

/// One agent and model's spend on one day. Mirrors `shared` `UsageBucket`.
class UsageBucket extends Equatable {
  /// Creates a [UsageBucket].
  const UsageBucket({
    required this.agentId,
    required this.model,
    required this.spend,
  });

  /// Reconstructs a [UsageBucket] from its wire map (the spend fields sit
  /// beside `agentId` and `model`).
  factory UsageBucket.fromJson(Map<String, dynamic> json) => UsageBucket(
        agentId: json['agentId'] as String? ?? '',
        model: json['model'] as String? ?? '',
        spend: UsageSpend.fromJson(json),
      );

  /// Wire agent id (`claude-code`, `codex`, …).
  final String agentId;

  /// The model, as the CLI names it.
  final String model;

  /// What it spent.
  final UsageSpend spend;

  /// The wire map.
  Map<String, dynamic> toJson() =>
      {'agentId': agentId, 'model': model, ...spend.toJson()};

  @override
  List<Object?> get props => [agentId, model, spend];
}

/// One local day of the PC. Mirrors `shared` `UsageDay`.
class UsageDay extends Equatable {
  /// Creates a [UsageDay].
  const UsageDay({required this.day, required this.buckets});

  /// Reconstructs a [UsageDay] from its wire map.
  factory UsageDay.fromJson(Map<String, dynamic> json) => UsageDay(
        day: json['day'] as String? ?? '',
        buckets: _list(json['buckets'], UsageBucket.fromJson),
      );

  /// `YYYY-MM-DD` in the PC's time zone.
  final String day;

  /// Its spend per agent and model.
  final List<UsageBucket> buckets;

  /// The wire map.
  Map<String, dynamic> toJson() => {
        'day': day,
        'buckets': [for (final b in buckets) b.toJson()],
      };

  @override
  List<Object?> get props => [day, buckets];
}

/// How many sessions an agent's history holds on a PC. Mirrors `shared`
/// `UsageAgentSource`.
class UsageAgentSource extends Equatable {
  /// Creates a [UsageAgentSource].
  const UsageAgentSource({
    required this.agentId,
    required this.sessions,
    this.readable = true,
  });

  /// Reconstructs a [UsageAgentSource] from its wire map.
  factory UsageAgentSource.fromJson(Map<String, dynamic> json) =>
      UsageAgentSource(
        agentId: json['agentId'] as String? ?? '',
        sessions: _int(json['sessions']),
        readable: json['status'] != 'unreadable',
      );

  /// Wire agent id.
  final String agentId;

  /// Sessions with spend in the period asked for.
  final int sessions;

  /// False when the agent's history could not be read.
  final bool readable;

  /// The wire map.
  Map<String, dynamic> toJson() => {
        'agentId': agentId,
        'sessions': sessions,
        'status': readable ? 'ok' : 'unreadable',
      };

  @override
  List<Object?> get props => [agentId, sessions, readable];
}

/// What the agents on one PC spent, per day (`usage/summary`). Mirrors
/// `shared` `UsageSummary`.
class UsageSummary extends Equatable {
  /// Creates a [UsageSummary].
  const UsageSummary({required this.days, required this.agents});

  /// Reconstructs a [UsageSummary] from its wire map.
  factory UsageSummary.fromJson(Map<String, dynamic> json) => UsageSummary(
        days: _list(json['days'], UsageDay.fromJson),
        agents: _list(json['agents'], UsageAgentSource.fromJson),
      );

  /// The days with spend, oldest first.
  final List<UsageDay> days;

  /// Each agent with history on the PC.
  final List<UsageAgentSource> agents;

  /// The wire map.
  Map<String, dynamic> toJson() => {
        'days': [for (final d in days) d.toJson()],
        'agents': [for (final a in agents) a.toJson()],
      };

  @override
  List<Object?> get props => [days, agents];
}

int _int(Object? value) => value is num ? value.toInt() : 0;

double _double(Object? value) => value is num ? value.toDouble() : 0;

List<T> _list<T>(
  Object? raw,
  T Function(Map<String, dynamic>) parse,
) =>
    raw is List
        ? raw
            .whereType<Map<dynamic, dynamic>>()
            .map((m) => parse(m.cast<String, dynamic>()))
            .toList()
        : <T>[];
