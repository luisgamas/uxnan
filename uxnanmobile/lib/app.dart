import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';

/// Root widget of the Uxnan app.
///
/// Wires Material 3, the dark-first theme, the GoRouter instance and
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
      themeMode: ThemeMode.dark,
      theme: buildUxnanTheme(brightness: Brightness.light),
      darkTheme: buildUxnanTheme(),
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    );
  }
}
