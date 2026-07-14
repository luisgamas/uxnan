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
      'credit': {'used': 12.5, 'currency': 'USD', 'period': 'Credits'},
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
    expect(u.credit?.used, 12.5);
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
}
