// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appTitle => 'Uxnan';

  @override
  String get homeEmptyTitle => 'Sin sesiones activas';

  @override
  String get homeEmptyBody =>
      'Vincula tu teléfono con una PC que ejecute el bridge de Uxnan para comenzar.';

  @override
  String get actionPairDevice => 'Vincular un dispositivo';

  @override
  String get connectionConnected => 'Conectado';

  @override
  String get connectionConnecting => 'Conectando…';

  @override
  String get connectionDisconnected => 'Desconectado';

  @override
  String get connectionReconnecting => 'Reconectando…';
}
