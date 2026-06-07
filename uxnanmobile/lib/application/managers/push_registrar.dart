import 'dart:async';
import 'dart:io' show Platform;

import 'package:uxnan/application/managers/thread_manager.dart' show RpcSend;
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/infrastructure/notifications/push_notification_service.dart';

/// Localized copy for the local notifications the [PushRegistrar] raises.
///
/// Lives in the application layer (a plain data holder, no Flutter/l10n
/// dependency) so the presentation layer can resolve the strings from
/// `AppLocalizations` and inject them, keeping the manager layer-clean.
class PushNotificationStrings {
  /// Creates a [PushNotificationStrings].
  const PushNotificationStrings({
    required this.turnCompletedTitle,
    required this.turnCompletedBody,
    required this.turnErrorTitle,
    required this.turnErrorBody,
  });

  /// Default English copy (used until the UI provides localized strings).
  const PushNotificationStrings.fallback()
      : turnCompletedTitle = 'Turn completed',
        turnCompletedBody = 'Your agent finished a turn.',
        turnErrorTitle = 'Turn failed',
        turnErrorBody = 'Your agent reported an error.';

  /// Title for the turn-completed notification.
  final String turnCompletedTitle;

  /// Body for the turn-completed notification.
  final String turnCompletedBody;

  /// Title for the turn-error notification.
  final String turnErrorTitle;

  /// Fallback body for the turn-error notification.
  final String turnErrorBody;
}

/// Registers the phone's FCM token with the bridge and surfaces local
/// notifications for turn-completed events (application layer, spec 02a §5.2).
///
/// Listens to the connection phase: when the session reaches
/// [ConnectionPhase.connected] and a token is available it calls
/// `notifications/register` over the injected [RpcSend]. Re-registers on token
/// refresh. None of this blocks startup — all work is best-effort and guarded,
/// so a missing Firebase config (or an offline bridge) is a silent no-op.
class PushRegistrar {
  /// Creates a [PushRegistrar] and starts listening.
  PushRegistrar({
    required PushNotificationService pushService,
    required RpcSend sendRequest,
    required Stream<ConnectionPhase> connectionPhases,
    required Stream<DomainEvent> domainEvents,
    this.strings = const PushNotificationStrings.fallback(),
    bool? isAndroid,
  })  : _push = pushService,
        _sendRequest = sendRequest,
        _isAndroid = isAndroid ?? !Platform.isIOS {
    _phaseSub = connectionPhases.listen(_onPhase);
    _eventsSub = domainEvents.listen(_onDomainEvent);
    _tokenRefreshSub = _push.onTokenRefresh.listen(_onTokenRefresh);
  }

  final PushNotificationService _push;
  final RpcSend _sendRequest;
  final bool _isAndroid;

  /// The localized notification copy currently in use. The UI assigns this once
  /// a localized context exists; defaults to English.
  PushNotificationStrings strings;

  StreamSubscription<ConnectionPhase>? _phaseSub;
  StreamSubscription<DomainEvent>? _eventsSub;
  StreamSubscription<String>? _tokenRefreshSub;

  bool _connected = false;
  String? _registeredToken;

  /// The platform string sent to the bridge (`"android"` or `"ios"`).
  String get _platform => _isAndroid ? 'android' : 'ios';

  void _onPhase(ConnectionPhase phase) {
    final wasConnected = _connected;
    _connected = phase == ConnectionPhase.connected;
    if (_connected && !wasConnected) {
      unawaited(_registerCurrentToken());
    }
  }

  void _onTokenRefresh(String token) {
    _registeredToken = null;
    unawaited(_register(token));
  }

  Future<void> _registerCurrentToken() async {
    final token = await _push.getToken();
    if (token == null) return;
    await _register(token);
  }

  Future<void> _register(String token) async {
    if (!_connected) return;
    if (_registeredToken == token) return;
    try {
      await _sendRequest('notifications/register', {
        'pushToken': token,
        'platform': _platform,
        'preferences': {
          'turnCompleted': true,
          'turnError': true,
        },
      });
      _registeredToken = token;
      AppLogger.info('Registered push token with the bridge');
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Push token registration failed', error, stackTrace);
    }
  }

  void _onDomainEvent(DomainEvent event) {
    switch (event) {
      case TurnCompletedEvent():
        unawaited(
          _push.showLocalNotification(
            title: strings.turnCompletedTitle,
            body: strings.turnCompletedBody,
            payload: event.threadId,
          ),
        );
      case TurnErrorEvent(:final message):
        unawaited(
          _push.showLocalNotification(
            title: strings.turnErrorTitle,
            body: message ?? strings.turnErrorBody,
            payload: event.threadId,
          ),
        );
      case TurnStartedEvent() ||
            MessageDeltaEvent() ||
            TurnAbortedEvent() ||
            GitProgressEvent() ||
            UnknownDomainEvent():
        break;
    }
  }

  /// Releases resources.
  Future<void> dispose() async {
    await _phaseSub?.cancel();
    await _eventsSub?.cancel();
    await _tokenRefreshSub?.cancel();
  }
}
