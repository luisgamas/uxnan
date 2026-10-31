import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/l10n/app_localizations_en.dart';
import 'package:uxnan/l10n/app_localizations_es.dart';
import 'package:uxnan/presentation/screens/profile/usage_format.dart';

void main() {
  final AppLocalizations en = AppLocalizationsEn();
  final AppLocalizations es = AppLocalizationsEs();

  test('windowLabel localizes the shared ids and a model-scoped week', () {
    UsageWindow w(String id, String label, {String? model, int? minutes}) =>
        UsageWindow(
          id: id,
          label: label,
          usedPercent: 1,
          model: model,
          windowMinutes: minutes,
        );
    expect(windowLabel(es, w('session5h', 'Session (5h)')), 'Sesión (5 h)');
    expect(windowLabel(es, w('weekly_all', 'Weekly')), 'Semanal');
    expect(
      windowLabel(es, w('3p-weekly', 'Claude and GPT models')),
      'Modelos Claude y GPT',
    );
    expect(
      windowLabel(
        es,
        w('weekly_fable', 'Fable (weekly)', model: 'Fable', minutes: 10080),
      ),
      'Fable (semanal)',
    );
    expect(windowLabel(en, w('premium_interactions', 'x')), 'Premium requests');
    // An id the app does not know shows the bridge's English label.
    expect(windowLabel(es, w('limit7', 'Something new')), 'Something new');
  });

  test('balances word credits per language and plural, money as money', () {
    const credits = CreditBalance(
      used: 0,
      available: 1,
      currency: 'credits',
      period: 'AI credits',
    );
    const many = CreditBalance(
      used: 0,
      available: 120,
      currency: 'credits',
      period: 'AI credits',
    );
    expect(balanceFigure(es, credits), '1 crédito disponible');
    expect(balanceFigure(es, many), '120 créditos disponibles');
    expect(balanceFigure(en, many), '120 credits available');
    expect(fmtAmount(es, 2, 'credits'), '2 créditos');
    expect(balanceLabel(es, many), 'Créditos de IA');
    const budget = CreditBalance(
      used: 12.5,
      limit: 50,
      currency: 'USD',
      period: 'Budget',
      scope: 'Model One',
    );
    expect(balanceFigure(en, budget), r'$12.50 / $50.00');
    expect(balanceLabel(es, budget), 'Presupuesto · Model One');
    const unknown = CreditBalance(used: 0, currency: 'USD', period: 'Other');
    expect(balanceLabel(en, unknown), 'Other');
  });
}
