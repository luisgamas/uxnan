import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/app.dart';

/// Application entry point.
///
/// Kept intentionally minimal: it only ensures the Flutter binding is ready and
/// mounts the [ProviderScope] + [UxnanApp]. Service bootstrapping (Firebase,
/// the drift database override, secure storage) is added here as those modules
/// land — see the DI wiring sequence in spec 03 section 3.6.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  runApp(
    const ProviderScope(
      child: UxnanApp(),
    ),
  );
}
