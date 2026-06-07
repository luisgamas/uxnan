import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/push_registrar.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';

/// Root widget of the Uxnan app.
///
/// Wires Material 3, the adaptive light/dark theme, the GoRouter instance and
/// localization. Theme and routing live in dedicated modules — never in
/// `main.dart` — per the project conventions. See spec 03 section 3.2.
class UxnanApp extends ConsumerWidget {
  /// Creates the root app widget.
  const UxnanApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: 'Uxnan',
      debugShowCheckedModeBanner: false,
      theme: buildUxnanTheme(brightness: Brightness.light),
      darkTheme: buildUxnanTheme(),
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => _PushHost(child: child ?? const SizedBox()),
    );
  }
}

/// Keeps the [PushRegistrar] alive for the whole app lifetime and feeds it
/// localized notification copy.
///
/// Mounted under `MaterialApp` (via its `builder`) so a localized
/// [AppLocalizations] context is available. Push init is best-effort and
/// non-blocking; this widget only renders [child].
class _PushHost extends ConsumerWidget {
  const _PushHost({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Instantiate and keep the registrar alive for the app's lifetime.
    final registrar = ref.watch(pushRegistrarProvider);
    final l10n = AppLocalizations.of(context);
    registrar.strings = PushNotificationStrings(
      turnCompletedTitle: l10n.pushTurnCompletedTitle,
      turnCompletedBody: l10n.pushTurnCompletedBody,
      turnErrorTitle: l10n.pushTurnErrorTitle,
      turnErrorBody: l10n.pushTurnErrorBody,
    );
    return child;
  }
}
