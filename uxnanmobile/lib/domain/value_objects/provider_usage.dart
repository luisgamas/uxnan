import 'package:equatable/equatable.dart';

/// A coding CLI whose usage the bridge reads from its own stored token.
/// Mirrors `shared` `UsageProvider`.
enum UsageProvider { codex, claude, copilot, gemini, grok }

/// Outcome of reading one provider's usage. Mirrors `shared` `UsageStatus`.
enum UsageStatus { ok, authRequired, notInstalled, error }

/// Parses a wire provider id, or null when unknown.
UsageProvider? usageProviderFromWire(String id) {
  for (final value in UsageProvider.values) {
    if (value.name == id) return value;
  }
  return null;
}

UsageStatus _statusFromWire(Object? id) {
  return switch (id) {
    'ok' => UsageStatus.ok,
    'authRequired' => UsageStatus.authRequired,
    'notInstalled' => UsageStatus.notInstalled,
    _ => UsageStatus.error,
  };
}

/// A single quota/rate window (a used-percentage with an optional reset).
class UsageWindow extends Equatable {
  /// Creates a [UsageWindow].
  const UsageWindow({
    required this.id,
    required this.label,
    required this.usedPercent,
    this.windowMinutes,
    this.resetsAt,
  });

  /// Reconstructs a [UsageWindow] from its wire map.
  factory UsageWindow.fromJson(Map<String, dynamic> json) => UsageWindow(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        usedPercent: (json['usedPercent'] as num?)?.toDouble() ?? 0,
        windowMinutes: (json['windowMinutes'] as num?)?.toInt(),
        resetsAt: _epoch(json['resetsAt']),
      );

  /// Stable id (e.g. `session5h`, `weekly`).
  final String id;

  /// Human label (English; the UI shows it verbatim).
  final String label;

  /// Consumed fraction of this window, clamped 0–100.
  final double usedPercent;

  /// Window length in minutes (300 = 5h, 10080 = 7d), when known.
  final int? windowMinutes;

  /// When the window resets, when the provider reports it.
  final DateTime? resetsAt;

  @override
  List<Object?> get props => [id, label, usedPercent, windowMinutes, resetsAt];
}

/// A monetary / credit balance, separate from the percentage windows.
class CreditBalance extends Equatable {
  /// Creates a [CreditBalance].
  const CreditBalance({
    required this.used,
    required this.currency,
    required this.period,
    this.limit,
    this.resetsAt,
  });

  /// Reconstructs a [CreditBalance] from its wire map.
  factory CreditBalance.fromJson(Map<String, dynamic> json) => CreditBalance(
        used: (json['used'] as num?)?.toDouble() ?? 0,
        currency: json['currency'] as String? ?? '',
        period: json['period'] as String? ?? '',
        limit: (json['limit'] as num?)?.toDouble(),
        resetsAt: _epoch(json['resetsAt']),
      );

  /// Amount consumed this period, in [currency].
  final double used;

  /// ISO-4217 code (`USD`, …) or `credits` for non-currency units.
  final String currency;

  /// Period label (English; e.g. `Monthly`, `Credits`).
  final String period;

  /// Spend/credit cap, when the provider exposes one.
  final double? limit;

  /// When the balance resets, when known.
  final DateTime? resetsAt;

  @override
  List<Object?> get props => [used, currency, period, limit, resetsAt];
}

/// The account identity a provider reports (never a secret).
class UsageAccount extends Equatable {
  /// Creates a [UsageAccount].
  const UsageAccount({this.email, this.organization, this.plan});

  /// Reconstructs a [UsageAccount] from its wire map.
  factory UsageAccount.fromJson(Map<String, dynamic> json) => UsageAccount(
        email: json['email'] as String?,
        organization: json['organization'] as String?,
        plan: json['plan'] as String?,
      );

  /// The signed-in email (or login), when reported.
  final String? email;

  /// The organization, when reported.
  final String? organization;

  /// The plan name, when reported.
  final String? plan;

  @override
  List<Object?> get props => [email, organization, plan];
}

/// One provider's usage snapshot. Mirrors `shared` `ProviderUsage`.
class ProviderUsage extends Equatable {
  /// Creates a [ProviderUsage].
  const ProviderUsage({
    required this.provider,
    required this.status,
    required this.windows,
    required this.updatedAt,
    this.account,
    this.credit,
    this.message,
  });

  /// Reconstructs a [ProviderUsage] from its wire map, or null when the
  /// provider id is unknown.
  static ProviderUsage? fromJson(Map<String, dynamic> json) {
    final provider = usageProviderFromWire(json['provider'] as String? ?? '');
    if (provider == null) return null;
    final windowsRaw = json['windows'];
    final accountRaw = json['account'];
    final creditRaw = json['credit'];
    return ProviderUsage(
      provider: provider,
      status: _statusFromWire(json['status']),
      windows: windowsRaw is List
          ? windowsRaw
              .whereType<Map<dynamic, dynamic>>()
              .map((w) => UsageWindow.fromJson(w.cast<String, dynamic>()))
              .toList()
          : const [],
      updatedAt: _epoch(json['updatedAt']) ?? DateTime.now(),
      account: accountRaw is Map
          ? UsageAccount.fromJson(accountRaw.cast<String, dynamic>())
          : null,
      credit: creditRaw is Map
          ? CreditBalance.fromJson(creditRaw.cast<String, dynamic>())
          : null,
      message: json['message'] as String?,
    );
  }

  /// Which provider this snapshot is for.
  final UsageProvider provider;

  /// The read outcome.
  final UsageStatus status;

  /// Quota/rate windows (percentage-based); empty when none apply.
  final List<UsageWindow> windows;

  /// When this snapshot was produced.
  final DateTime updatedAt;

  /// The account identity, when reported.
  final UsageAccount? account;

  /// The credit balance, when reported.
  final CreditBalance? credit;

  /// Error/hint message for `error` / `authRequired` / `notInstalled`.
  final String? message;

  @override
  List<Object?> get props => [
        provider,
        status,
        windows,
        updatedAt,
        account,
        credit,
        message,
      ];
}

DateTime? _epoch(Object? value) {
  if (value is num && value > 0) {
    return DateTime.fromMillisecondsSinceEpoch(value.toInt());
  }
  return null;
}
