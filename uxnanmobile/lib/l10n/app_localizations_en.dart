// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Uxnan';

  @override
  String get homeEmptyTitle => 'No active sessions';

  @override
  String get homeEmptyBody =>
      'Pair your phone with a PC running the Uxnan bridge to get started.';

  @override
  String get actionPairDevice => 'Pair a device';

  @override
  String get connectionConnected => 'Connected';

  @override
  String get connectionConnecting => 'Connecting…';

  @override
  String get connectionDisconnected => 'Disconnected';

  @override
  String get connectionReconnecting => 'Reconnecting…';
}
