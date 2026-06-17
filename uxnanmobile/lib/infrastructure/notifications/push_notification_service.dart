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

  /// Broadcasts the `threadId` carried by a tapped notification (while the app
  /// is alive or resumed from the background). Cold-start launches are surfaced
  /// separately via [initialThreadId].
  final StreamController<String> _tapController =
      StreamController<String>.broadcast();

  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'uxnan_turns',
    'Agent activity',
    description: 'Turn completions and errors from your coding agents.',
    importance: Importance.high,
  );

  /// Resolves the `threadId` of the conversation currently on screen (null when
  /// none), so a **foreground** FCM push for that conversation is suppressed —
  /// the user already sees the reply live. Wired by `pushRegistrarProvider`.
  String? Function()? foregroundThreadId;

  /// Reports whether a live bridge connection is active. While connected, the
  /// live WS + domain-event path already raises foreground notifications (with
  /// per-thread suppression), so a foreground FCM push would duplicate it and
  /// is suppressed; FCM only surfaces in the foreground when disconnected
  /// (e.g. the devices list). Wired by `pushRegistrarProvider`.
  bool Function()? isConnected;

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

  /// Stream of `threadId`s extracted from tapped notifications, for deep-links
  /// into the matching conversation. Emits for foreground/background-resume
  /// taps; for taps that cold-started the app use [initialThreadId].
  Stream<String> get onNotificationTap => _tapController.stream;

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
      // A push notification tapped while the app was backgrounded.
      FirebaseMessaging.onMessageOpenedApp.listen(_handleOpenedAppMessage);
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

  /// The `threadId` of the notification that cold-started the app (tapped while
  /// the app was terminated), or `null` when the app launched normally. Checks
  /// both a local-notification launch and an FCM initial message. Never throws.
  Future<String?> initialThreadId() async {
    try {
      final launch =
          await _localNotifications.getNotificationAppLaunchDetails();
      if (launch?.didNotificationLaunchApp ?? false) {
        final payload = launch?.notificationResponse?.payload;
        if (payload != null && payload.isNotEmpty) return payload;
      }
    } on Object catch (error, stackTrace) {
      AppLogger.warn(
        'Failed to read notification launch details',
        error,
        stackTrace,
      );
    }
    final messaging = _messaging;
    if (messaging != null) {
      try {
        final initial = await messaging.getInitialMessage();
        final threadId = initial?.data['threadId'] as String?;
        if (threadId != null && threadId.isNotEmpty) return threadId;
      } on Object catch (error, stackTrace) {
        AppLogger.warn(
          'Failed to read the initial push message',
          error,
          stackTrace,
        );
      }
    }
    return null;
  }

  /// Closes the tap stream. The service lives for the whole app, so this is
  /// called from the owning provider's `onDispose`.
  Future<void> dispose() async {
    await _tapController.close();
  }

  Future<void> _initLocalNotifications() async {
    const initSettings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(),
    );
    await _localNotifications.initialize(
      initSettings,
      onDidReceiveNotificationResponse: _handleNotificationResponse,
    );
    final androidImpl =
        _localNotifications.resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
    await androidImpl?.createNotificationChannel(_channel);
  }

  void _handleNotificationResponse(NotificationResponse response) {
    _emitTap(response.payload);
  }

  void _handleOpenedAppMessage(RemoteMessage message) {
    _emitTap(message.data['threadId'] as String?);
  }

  void _emitTap(String? threadId) {
    if (threadId == null || threadId.isEmpty) return;
    if (_tapController.isClosed) return;
    _tapController.add(threadId);
  }

  void _handleForegroundMessage(RemoteMessage message) {
    final threadId = message.data['threadId'] as String?;
    if (shouldSuppressForegroundPush(
      threadId: threadId,
      foregroundThreadId: foregroundThreadId?.call(),
      connected: isConnected?.call() ?? false,
    )) {
      return;
    }
    final notification = message.notification;
    final title = notification?.title ?? message.data['title'] as String?;
    final body = notification?.body ?? message.data['body'] as String?;
    if (title == null && body == null) return;
    unawaited(
      showLocalNotification(
        title: title ?? '',
        body: body ?? '',
        payload: threadId,
      ),
    );
  }
}

/// Whether a **foreground** FCM push for [threadId] should be suppressed:
///  - the conversation is the one on screen ([foregroundThreadId]) — the user
///    already sees the reply live; or
///  - a live bridge connection is active ([connected]) — the WS + domain-event
///    path already raises the notification (with per-thread suppression), so a
///    foreground push would duplicate it.
/// A disconnected foreground (e.g. the devices list) still surfaces the push.
bool shouldSuppressForegroundPush({
  required String? threadId,
  required String? foregroundThreadId,
  required bool connected,
}) {
  if (threadId != null && foregroundThreadId == threadId) return true;
  if (connected) return true;
  return false;
}
