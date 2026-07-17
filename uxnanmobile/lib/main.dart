import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/app.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/infrastructure/notifications/push_notification_service.dart';

/// Application entry point.
///
/// Kept intentionally minimal: it ensures the Flutter binding is ready,
/// performs a fully **guarded** Firebase init (so the app still builds and runs
/// with no `google-services.json` / `GoogleService-Info.plist`), registers the
/// FCM background handler, then mounts the [ProviderScope] + [UxnanApp]. None
/// of the push setup is allowed to be fatal — failures are logged and push is
/// simply disabled. See the DI wiring sequence in spec 03 section 3.6.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // The E2EE envelope layer needs no explicit crypto activation here.
  // `cryptography_flutter` auto-registers its accelerated
  // `FlutterCryptography` as `Cryptography.instance` through its
  // `dartPluginClass` during `ensureInitialized()` above, so AES-GCM and
  // HKDF run on the OS-native backend on device (and on the
  // byte-identical pure-Dart fallback elsewhere, e.g. in tests).
  // `FlutterCryptography.enable()` has been redundant since
  // cryptography_flutter 2.2.0 and is deprecated — do not add it.

  await _initFirebase();

  runApp(
    const ProviderScope(
      child: UxnanApp(),
    ),
  );
}

/// Guarded Firebase bootstrap. Safe when Firebase native config is absent:
/// any failure is logged and push stays disabled (the app continues normally).
Future<void> _initFirebase() async {
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } on Object catch (error, stackTrace) {
    AppLogger.warn(
      'Firebase not configured at startup — push disabled',
      error,
      stackTrace,
    );
  }
}
