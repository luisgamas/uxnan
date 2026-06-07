import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:uxnan/core/utils/logger.dart';

/// Top-level FCM background message handler.
///
/// Must be a top-level (or static) function annotated with
/// `@pragma('vm:entry-point')` so the engine can invoke it from a fresh
/// isolate when a data/notification message arrives while the app is
/// terminated or backgrounded. Everything here is guarded: if Firebase is not
/// configured (no `google-services.json` / `GoogleService-Info.plist`), the
/// handler simply returns instead of crashing the isolate.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    // The background isolate has no access to the main isolate's Firebase
    // instance, so initialize defensively. `initializeApp` is idempotent.
    await Firebase.initializeApp();
    AppLogger.debug(
      'Push background message received: ${message.messageId ?? '(no id)'}',
    );
  } on Object catch (error, stackTrace) {
    // Firebase not configured (or any native failure) — swallow so the
    // background isolate exits cleanly. Push is simply unavailable.
    AppLogger.warn('Push background handler skipped', error, stackTrace);
  }
}

/// Wraps Firebase Cloud Messaging + `flutter_local_notifications` behind a
/// single, fully guarded surface (infrastructure layer, spec 02a §7).
///
/// CRITICAL: the app must build and run with **no** Firebase native config.
/// Every Firebase / FCM call is wrapped in try/catch; when initialization
/// fails the service flips [isAvailable] to `false`, logs via [AppLogger] and
/// degrades to a no-op. Nothing here ever throws to its callers.
class PushNotificationService {
  /// Creates a [PushNotificationService].
  PushNotificationService({
    FirebaseMessaging? messaging,
    FlutterLocalNotificationsPlugin? localNotifications,
  })  : _messagingOverride = messaging,
        _localNotifications =
            localNotifications ?? FlutterLocalNotificationsPlugin();

  final FirebaseMessaging? _messagingOverride;
  final FlutterLocalNotificationsPlugin _localNotifications;

  FirebaseMessaging? _messaging;
  bool _available = false;
  bool _initialized = false;

  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'uxnan_turns',
    'Agent activity',
    description: 'Turn completions and errors from your coding agents.',
    importance: Importance.high,
  );

  /// Whether push is available (Firebase initialized and messaging reachable).
  ///
  /// `false` when Firebase native config is missing or initialization failed;
  /// callers should treat the whole feature as disabled in that case.
  bool get isAvailable => _available;

  /// Stream of foreground FCM messages. Empty (never emits) when unavailable.
  Stream<RemoteMessage> get onMessage =>
      _available ? FirebaseMessaging.onMessage : const Stream.empty();

  /// Stream of refreshed FCM registration tokens. Empty when unavailable.
  Stream<String> get onTokenRefresh => _available && _messaging != null
      ? _messaging!.onTokenRefresh
      : const Stream.empty();

  /// Initializes Firebase, local notifications and the foreground message
  /// listener. Safe to call multiple times; never throws.
  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
    try {
      await Firebase.initializeApp();
      _messaging = _messagingOverride ?? FirebaseMessaging.instance;
      await _initLocalNotifications();
      await requestPermission();
      _available = true;
      FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
      AppLogger.info('Push notifications initialized');
    } on Object catch (error, stackTrace) {
      _available = false;
      AppLogger.warn(
        'Firebase not configured — push disabled (app continues normally)',
        error,
        stackTrace,
      );
    }
  }

  /// Requests the OS notification permission via FCM. No-op when unavailable.
  Future<void> requestPermission() async {
    final messaging = _messaging;
    if (messaging == null) return;
    try {
      await messaging.requestPermission();
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Push permission request failed', error, stackTrace);
    }
  }

  /// Returns the current FCM registration token, or `null` when push is
  /// unavailable or the token cannot be fetched. Never throws.
  Future<String?> getToken() async {
    final messaging = _messaging;
    if (!_available || messaging == null) return null;
    try {
      return await messaging.getToken();
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Failed to fetch FCM token', error, stackTrace);
      return null;
    }
  }

  /// Displays a local notification for a turn-completed (or similar) event,
  /// e.g. driven by a bridge `stream/turn/completed` notification while the app
  /// is foregrounded. Never throws.
  Future<void> showLocalNotification({
    required String title,
    required String body,
    String? payload,
  }) async {
    try {
      await _localNotifications.show(
        DateTime.now().millisecondsSinceEpoch.remainder(1 << 31),
        title,
        body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'uxnan_turns',
            'Agent activity',
            channelDescription:
                'Turn completions and errors from your coding agents.',
            importance: Importance.high,
            priority: Priority.high,
          ),
          iOS: DarwinNotificationDetails(),
        ),
        payload: payload,
      );
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Failed to show local notification', error, stackTrace);
    }
  }

  Future<void> _initLocalNotifications() async {
    const initSettings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(),
    );
    await _localNotifications.initialize(initSettings);
    final androidImpl =
        _localNotifications.resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
    await androidImpl?.createNotificationChannel(_channel);
  }

  void _handleForegroundMessage(RemoteMessage message) {
    final notification = message.notification;
    final title = notification?.title ?? message.data['title'] as String?;
    final body = notification?.body ?? message.data['body'] as String?;
    if (title == null && body == null) return;
    unawaited(
      showLocalNotification(
        title: title ?? '',
        body: body ?? '',
        payload: message.data['threadId'] as String?,
      ),
    );
  }
}
