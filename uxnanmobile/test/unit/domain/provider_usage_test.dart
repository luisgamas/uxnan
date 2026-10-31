import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';

void main() {
  test('parses an ok provider with windows, credit and account', () {
    final u = ProviderUsage.fromJson({
      'provider': 'codex',
      'status': 'ok',
      'source': 'token',
      'account': {'email': 'a@b.com', 'plan': 'Chatgpt Pro'},
      'windows': [
        {
          'id': 'primary_window',
          'label': 'Session (5h)',
          'usedPercent': 40,
          'windowMinutes': 300,
          'resetsAt': 1700000600000,
        },
      ],
      'credits': [
        {'used': 12.5, 'currency': 'USD', 'period': 'Credits'},
      ],
      'updatedAt': 1700000000000,
    });
    expect(u, isNotNull);
    expect(u!.provider, UsageProvider.codex);
    expect(u.status, UsageStatus.ok);
    expect(u.account?.plan, 'Chatgpt Pro');
    expect(u.windows.single.usedPercent, 40);
    expect(u.windows.single.windowMinutes, 300);
    expect(
      u.windows.single.resetsAt,
      DateTime.fromMillisecondsSinceEpoch(1700000600000),
    );
    expect(u.credits.single.used, 12.5);
  });

  test('an unknown provider id yields null', () {
    final u = ProviderUsage.fromJson({
      'provider': 'nope',
      'status': 'ok',
      'windows': <dynamic>[],
      'updatedAt': 1,
    });
    expect(u, isNull);
  });

  test('authRequired keeps its message and has no windows', () {
    final u = ProviderUsage.fromJson({
      'provider': 'grok',
      'status': 'authRequired',
      'windows': <dynamic>[],
      'updatedAt': 1,
      'message': 'run grok login',
    });
    expect(u!.status, UsageStatus.authRequired);
    expect(u.windows, isEmpty);
    expect(u.message, 'run grok login');
  });

  test('the account type and Codex resets, soonest-expiring first', () {
    final u = ProviderUsage.fromJson({
      'provider': 'codex',
      'status': 'ok',
      'windows': <dynamic>[],
      'updatedAt': 1,
      'account': {'plan': 'Free', 'accountType': 'free'},
      'resetCredits': {
        'available': 2,
        'entries': [
          {'id': 'late', 'title': 'Full reset', 'expiresAt': 2000},
          {'id': 'soon', 'title': 'Full reset', 'expiresAt': 1000},
        ],
      },
    });
    expect(u!.account!.accountType, AccountType.free);
    expect(u.resetCredits!.available, 2);
    expect(u.resetCredits!.entries.first.id, 'soon');
  });

  test('a status no reader sends any more is an error, not a state', () {
    final u = ProviderUsage.fromJson({
      'provider': 'claude',
      'status': 'accessRequired',
      'windows': <dynamic>[],
      'updatedAt': 1,
    });
    expect(u!.status, UsageStatus.error);
  });

  // A prepaid balance says what is left, not what was spent (Grok's).
  test('a credit balance carries the amount still available', () {
    final credit = CreditBalance.fromJson(const {
      'used': 0,
      'available': 25,
      'currency': 'USD',
      'period': 'Prepaid',
    });
    expect(credit.available, 25);
    expect(credit.limit, isNull);
  });

  test('parses the providers the bridge asks of agy and OpenCode', () {
    final agy = ProviderUsage.fromJson({
      'provider': 'antigravity',
      'status': 'ok',
      'source': 'cli',
      'windows': [
        {
          'id': 'gemini-weekly',
          'label': 'Gemini Models',
          'usedPercent': 9,
          'windowMinutes': 10080,
          'model': 'Gemini',
        },
      ],
      'credits': [
        {
          'used': 0,
          'available': 120,
          'currency': 'credits',
          'period': 'AI credits',
        },
        {
          'used': 1,
          'limit': 5,
          'currency': 'USD',
          'period': 'Budget',
          'scope': 'Model One',
        },
      ],
      'updatedAt': 1,
    });
    expect(agy!.provider, UsageProvider.antigravity);
    expect(agy.windows.single.model, 'Gemini');
    expect(agy.credits.first.available, 120);
    expect(agy.credits.last.scope, 'Model One');
    final oc = ProviderUsage.fromJson({
      'provider': 'opencode',
      'status': 'authRequired',
      'windows': <Object>[],
      'updatedAt': 1,
    });
    expect(oc!.provider, UsageProvider.opencode);
    expect(oc.status, UsageStatus.authRequired);
  });

  test('reset credits carry the command the CLI spends them with', () {
    final resets = ResetCredits.fromJson(const {
      'available': 1,
      'entries': [
        {'id': 'g-1', 'title': 'Full reset', 'expiresAt': 1793430000000},
      ],
      'redeemCommand': '/limit-reset',
    });
    expect(resets.redeemCommand, '/limit-reset');
    expect(resets.entries.single.title, 'Full reset');
    expect(UsageProvider.claude.cliName, 'Claude Code');
    expect(ResetCredits.fromJson(const {'available': 2}).redeemCommand, isNull);
  });
}
