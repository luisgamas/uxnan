import 'package:equatable/equatable.dart';

/// A provider whose plan limits the bridge reads — every one asked of its own
/// CLI (Copilot through GitHub's `gh`), so no credential is read. Mirrors
/// `shared` `UsageProvider`.
enum UsageProvider { codex, claude, copilot, grok, antigravity, opencode }

/// The name a provider's plan goes by, wherever the app says it.
extension UsageProviderName on UsageProvider {
  /// The CLI the bridge asks for this provider, as a person runs it.
  String get cliName => switch (this) {
        UsageProvider.claude => 'Claude Code',
        UsageProvider.copilot => 'GitHub CLI (gh)',
        UsageProvider.antigravity => 'Antigravity (agy)',
        _ => displayName,
      };

  /// The display name ("Claude", "GitHub Copilot", …).
  String get displayName => switch (this) {
        UsageProvider.claude => 'Claude',
        UsageProvider.codex => 'Codex',
        UsageProvider.grok => 'Grok',
        UsageProvider.copilot => 'GitHub Copilot',
        UsageProvider.antigravity => 'Antigravity',
        UsageProvider.opencode => 'OpenCode',
      };
}

/// Outcome of reading one provider's usage. Mirrors `shared` `UsageStatus`.
enum UsageStatus { ok, authRequired, notInstalled, error }

/// How the account is billed. Mirrors `shared` `AccountType`.
enum AccountType { subscription, payAsYouGo, free, team, enterprise }

AccountType? _accountTypeFromWire(Object? id) {
  for (final value in AccountType.values) {
    if (value.name == id) return value;
  }
  return null;
}

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
    this.model,
  });

  /// Reconstructs a [UsageWindow] from its wire map.
  factory UsageWindow.fromJson(Map<String, dynamic> json) => UsageWindow(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        usedPercent: (json['usedPercent'] as num?)?.toDouble() ?? 0,
        windowMinutes: (json['windowMinutes'] as num?)?.toInt(),
        resetsAt: _epoch(json['resetsAt']),
        model: json['model'] as String?,
      );

  /// Window id (e.g. `session5h`, `weekly`, `monthly`): what the provider
  /// reports, so it can change with the plan or the reader (see the shared
  /// `UsageWindow`). The UI names the ids it knows (`windowLabel`).
  final String id;

  /// English fallback label, shown as is for an id the UI does not know.
  final String label;

  /// The model this window is scoped to (Claude's model-scoped weekly limit).
  final String? model;

  /// Consumed fraction of this window, clamped 0–100.
  final double usedPercent;

  /// Window length in minutes (300 = 5h, 10080 = 7d), when known.
  final int? windowMinutes;

  /// When the window resets, when the provider reports it.
  final DateTime? resetsAt;

  @override
  List<Object?> get props =>
      [id, label, usedPercent, windowMinutes, resetsAt, model];
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
    this.available,
    this.scope,
  });

  /// Reconstructs a [CreditBalance] from its wire map.
  factory CreditBalance.fromJson(Map<String, dynamic> json) => CreditBalance(
        used: (json['used'] as num?)?.toDouble() ?? 0,
        currency: json['currency'] as String? ?? '',
        period: json['period'] as String? ?? '',
        limit: (json['limit'] as num?)?.toDouble(),
        resetsAt: _epoch(json['resetsAt']),
        available: (json['available'] as num?)?.toDouble(),
        scope: json['scope'] as String?,
      );

  /// Amount consumed this period, in [currency].
  final double used;

  /// ISO-4217 code (`USD`, …) or `credits` for non-currency units.
  final String currency;

  /// What the balance is — the bridge's fixed English vocabulary
  /// (`Monthly credits`, `Credits`, `On-demand`, `Prepaid`, `AI credits`,
  /// `Budget`), which the UI localizes (`balanceLabel`).
  final String period;

  /// What the balance covers when narrower than the account (the models of
  /// an OpenCode budget), as the provider names it.
  final String? scope;

  /// Spend/credit cap, when the provider exposes one.
  final double? limit;

  /// When the balance resets, when known.
  final DateTime? resetsAt;

  /// Amount still available this period, in [currency], when the provider
  /// reports a remaining balance directly (a Grok prepaid balance, say).
  final double? available;

  @override
  List<Object?> get props =>
      [used, currency, period, limit, resetsAt, available, scope];
}

/// The account identity a provider reports (never a secret).
class UsageAccount extends Equatable {
  /// Creates a [UsageAccount].
  const UsageAccount({
    this.email,
    this.organization,
    this.plan,
    this.accountType,
  });

  /// Reconstructs a [UsageAccount] from its wire map.
  factory UsageAccount.fromJson(Map<String, dynamic> json) => UsageAccount(
        email: json['email'] as String?,
        organization: json['organization'] as String?,
        plan: json['plan'] as String?,
        accountType: _accountTypeFromWire(json['accountType']),
      );

  /// The signed-in email (or login), when reported.
  final String? email;

  /// The organization, when reported.
  final String? organization;

  /// The plan name, when reported.
  final String? plan;

  /// How the account is billed, when reported.
  final AccountType? accountType;

  @override
  List<Object?> get props => [email, organization, plan, accountType];
}

/// One redeemable rate-limit reset (Codex).
class ResetCreditEntry extends Equatable {
  /// Creates a [ResetCreditEntry].
  const ResetCreditEntry({this.id, this.title, this.expiresAt});

  /// Reconstructs a [ResetCreditEntry] from its wire map.
  factory ResetCreditEntry.fromJson(Map<String, dynamic> json) =>
      ResetCreditEntry(
        id: json['id'] as String?,
        title: json['title'] as String?,
        expiresAt: _epoch(json['expiresAt']),
      );

  /// The credit's id, to redeem this one.
  final String? id;

  /// Its title ("Full reset"), when reported.
  final String? title;

  /// When it expires unused.
  final DateTime? expiresAt;

  @override
  List<Object?> get props => [id, title, expiresAt];
}

/// The rate-limit resets an account holds (Codex's, Claude Code's): each one
/// rolls a limit back early when used.
class ResetCredits extends Equatable {
  /// Creates a [ResetCredits].
  const ResetCredits({
    required this.available,
    this.entries = const [],
    this.redeemCommand,
  });

  /// Reconstructs [ResetCredits] from its wire map.
  factory ResetCredits.fromJson(Map<String, dynamic> json) {
    final raw = json['entries'];
    final entries = <ResetCreditEntry>[
      if (raw is List)
        for (final e in raw.whereType<Map<dynamic, dynamic>>())
          ResetCreditEntry.fromJson(e.cast<String, dynamic>()),
    ]
      // Soonest-expiring first: the one a redeem spends.
      ..sort((a, b) {
        final x = a.expiresAt;
        final y = b.expiresAt;
        if (x == null) return y == null ? 0 : 1;
        if (y == null) return -1;
        return x.compareTo(y);
      });
    final available = json['available'];
    return ResetCredits(
      available: available is num ? available.toInt() : entries.length,
      entries: entries,
      redeemCommand: json['redeemCommand'] as String?,
    );
  }

  /// How many can be redeemed now.
  final int available;

  /// Each one, soonest-expiring first.
  final List<ResetCreditEntry> entries;

  /// Set when the CLI spends these only itself, by this command (Claude
  /// Code's `/limit-reset`): the app says so and offers no redeem.
  final String? redeemCommand;

  @override
  List<Object?> get props => [available, entries, redeemCommand];
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
    this.credits = const [],
    this.resetCredits,
    this.message,
  });

  /// Reconstructs a [ProviderUsage] from its wire map, or null when the
  /// provider id is unknown.
  static ProviderUsage? fromJson(Map<String, dynamic> json) {
    final provider = usageProviderFromWire(json['provider'] as String? ?? '');
    if (provider == null) return null;
    final windowsRaw = json['windows'];
    final accountRaw = json['account'];
    final creditsRaw = json['credits'];
    final resetsRaw = json['resetCredits'];
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
      credits: creditsRaw is List
          ? creditsRaw
              .whereType<Map<dynamic, dynamic>>()
              .map((c) => CreditBalance.fromJson(c.cast<String, dynamic>()))
              .toList()
          : const [],
      resetCredits: resetsRaw is Map
          ? ResetCredits.fromJson(resetsRaw.cast<String, dynamic>())
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

  /// Money and credit balances, the one that matters most first; empty when
  /// the account has none.
  final List<CreditBalance> credits;

  /// Redeemable rate-limit resets (Codex), when reported.
  final ResetCredits? resetCredits;

  /// Error/hint message for `error` / `authRequired` / `notInstalled`.
  final String? message;

  @override
  List<Object?> get props => [
        provider,
        status,
        windows,
        updatedAt,
        account,
        credits,
        resetCredits,
        message,
      ];
}

DateTime? _epoch(Object? value) {
  if (value is num && value > 0) {
    return DateTime.fromMillisecondsSinceEpoch(value.toInt());
  }
  return null;
}
