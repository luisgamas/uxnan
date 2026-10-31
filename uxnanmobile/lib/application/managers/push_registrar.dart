import 'dart:async';
import 'dart:io' show Platform;

import 'package:uxnan/application/managers/thread_manager.dart' show RpcSend;
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';
import 'package:uxnan/infrastructure/notifications/push_notification_service.dart';

/// Localized copy for the local notifications the [PushRegistrar] raises.
///
/// Lives in the application layer (a plain data holder, no Flutter/l10n
/// dependency) so the presentation layer can resolve the strings from
/// `AppLocalizations` and inject them, keeping the manager layer-clean.
class PushNotificationStrings {
  /// Creates a [PushNotificationStrings].
  const PushNotificationStrings({
    required this.turnCompletedBody,
    required this.turnErrorBody,
    required this.approvalNeededBody,
    required this.questionBody,
    required this.fallbackTitle,
  });

  /// Default English copy (used until the UI provides localized strings).
  const PushNotificationStrings.fallback()
      : turnCompletedBody = _fallbackCompleted,
        turnErrorBody = _fallbackError,
        approvalNeededBody = _fallbackApproval,
        questionBody = _fallbackQuestion,
        fallbackTitle = 'Uxnan';

  /// Body for a completed turn given the agent label, e.g. "Opencode replied".
  /// The notification's title is the thread's name (or [fallbackTitle]).
  final String Function(String agent) turnCompletedBody;

  /// Body for a failed turn given the agent label.
  final String Function(String agent) turnErrorBody;

  /// Body when an agent asks for an approval and waits, given its label.
  final String Function(String agent) approvalNeededBody;

  /// Body when an agent asks the user a question and waits, given its label.
  final String Function(String agent) questionBody;

  /// Title used when the thread's name is unknown.
  final String fallbackTitle;
}

String _fallbackCompleted(String agent) => '$agent replied';
String _fallbackError(String agent) => '$agent reported an error';
String _fallbackApproval(String agent) => '$agent needs your approval';
String _fallbackQuestion(String agent) => '$agent has a question for you';

/// Registers the phone's FCM token with the bridge and surfaces local
/// notifications for turn-completed events and for an agent that starts
/// waiting on the person — one per approval or question, taken back once it is
/// answered here or anywhere else (application layer, spec 02a §5.2).
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
    String? Function()? foregroundThreadId,
    ({String title, String agent})? Function(String threadId)? threadInfo,
    NotificationPreferences Function()? preferences,
    bool? isAndroid,
  })  : _push = pushService,
        _sendRequest = sendRequest,
        _foregroundThreadId = foregroundThreadId,
        _threadInfo = threadInfo,
        _preferences = preferences,
        _isAndroid = isAndroid ?? !Platform.isIOS {
    _phaseSub = connectionPhases.listen(_onPhase);
    _eventsSub = domainEvents.listen(_onDomainEvent);
    _tokenRefreshSub = _push.onTokenRefresh.listen(_onTokenRefresh);
  }

  final PushNotificationService _push;
  final RpcSend _sendRequest;

  /// Returns the threadId of the conversation the user is currently viewing in
  /// the foreground (null when none). A turn-end notification for that thread
  /// is suppressed — the user already sees the reply live. Null/absent disables
  /// the suppression (e.g. in tests).
  final String? Function()? _foregroundThreadId;

  /// Resolves the thread's display title + agent label for the notification
  /// copy. Null/absent falls back to the app name + an empty agent.
  final ({String title, String agent})? Function(String threadId)? _threadInfo;

  /// Reads the user's current notification preferences. Null/absent falls back
  /// to the fully opted-in default (both channels on).
  final NotificationPreferences Function()? _preferences;

  final bool _isAndroid;

  /// The localized notification copy currently in use. The UI assigns this once
  /// a localized context exists; defaults to English.
  PushNotificationStrings strings;

  StreamSubscription<ConnectionPhase>? _phaseSub;
  StreamSubscription<DomainEvent>? _eventsSub;
  StreamSubscription<String>? _tokenRefreshSub;

  bool _connected = false;
  String? _registeredToken;

  /// Whether a live bridge connection is currently active (drives whether a
  /// foreground FCM push is redundant with the live domain-event path).
  bool get isConnected => _connected;

  /// The platform string sent to the bridge (`"android"` or `"ios"`).
  String get _platform => _isAndroid ? 'android' : 'ios';

  /// The current notification preferences (opted-in default when unset).
  NotificationPreferences get _prefs =>
      _preferences?.call() ?? const NotificationPreferences();

  /// Stream of `threadId`s from tapped notifications, for deep-linking into the
  /// matching conversation (presentation subscribes to this).
  Stream<String> get onNotificationTap => _push.onNotificationTap;

  /// The `threadId` that cold-started the app via a notification tap, or null.
  Future<String?> initialThreadId() => _push.initialThreadId();

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
        'preferences': _prefs.toJson(),
      });
      _registeredToken = token;
      AppLogger.info('Registered push token with the bridge');
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Push token registration failed', error, stackTrace);
    }
  }

  /// Whether the user is currently viewing [threadId]'s conversation in the
  /// foreground — in which case a turn-end notification for it is redundant.
  bool _isViewing(String? threadId) =>
      threadId != null && _foregroundThreadId?.call() == threadId;

  /// Resolves the notification (title = thread name, body templated with the
  /// agent label) for [threadId]: e.g. title "Cambio de rutina", body
  /// "Opencode te respondió".
  ({String title, String agent}) _info(String? threadId) {
    final info = threadId == null ? null : _threadInfo?.call(threadId);
    final title = (info != null && info.title.isNotEmpty)
        ? info.title
        : strings.fallbackTitle;
    return (title: title, agent: info?.agent ?? '');
  }

  void _onDomainEvent(DomainEvent event) {
    switch (event) {
      case TurnCompletedEvent():
        if (!_prefs.turnCompleted) break;
        if (_isViewing(event.threadId)) break;
        final info = _info(event.threadId);
        unawaited(
          _push.showLocalNotification(
            title: info.title,
            body: strings.turnCompletedBody(info.agent),
            payload: event.threadId,
          ),
        );
      case TurnErrorEvent():
        if (!_prefs.turnError) break;
        if (_isViewing(event.threadId)) break;
        final info = _info(event.threadId);
        unawaited(
          _push.showLocalNotification(
            title: info.title,
            body: strings.turnErrorBody(info.agent),
            payload: event.threadId,
          ),
        );
      // An agent asked for an approval or a question: it waits, however long,
      // until someone answers — worth telling the person, once per request.
      case ContentBlockEvent(:final content, :final threadId):
        final request = _openRequest(content);
        if (request == null || !_prefs.needsInput) break;
        if (_isViewing(threadId)) break;
        final info = _info(threadId);
        unawaited(
          _push.showLocalNotification(
            title: info.title,
            body: request.approval
                ? strings.approvalNeededBody(info.agent)
                : strings.questionBody(info.agent),
            payload: threadId,
            key: request.id,
          ),
        );
      // Answered here, on another client, or withdrawn: its notification is
      // no longer news.
      case ApprovalResolvedEvent(:final approvalId):
        unawaited(_push.cancelLocalNotification(approvalId));
      case QuestionResolvedEvent(:final questionId):
        unawaited(_push.cancelLocalNotification(questionId));
      // A queued message being accepted, cancelled, drained or handed straight
      // to the running turn is not worth a notification: the user is the one
      // who queued it, and the turn it joins (or becomes) will announce itself
      // on completion like any other.
      case TurnStartedEvent() ||
            MessageDeltaEvent() ||
            ThinkingDeltaEvent() ||
            TurnAbortedEvent() ||
            TurnCancelledEvent() ||
            ThreadUpdatedEvent() ||
            ThreadDeletedEvent() ||
            TurnCreatedEvent() ||
            HistoryChangedEvent() ||
            QueueUpdatedEvent() ||
            ModelResolvedEvent() ||
            ProjectUpdatedEvent() ||
            ProjectRemovedEvent() ||
            SettingsUpdatedEvent() ||
            PresenceUpdatedEvent() ||
            DevicesUpdatedEvent() ||
            AgentsUpdatedEvent() ||
            BridgeUpdatedEvent() ||
            RelayUpdatedEvent() ||
            AgentSessionHeldEvent() ||
            GitProgressEvent() ||
            UnknownDomainEvent():
        break;
    }
  }

  /// The still-open approval or question [content] asks, if it is one.
  static ({String id, bool approval})? _openRequest(MessageContent content) =>
      switch (content) {
        ApprovalContent(:final request)
            when request.outcome == null && request.approvalId.isNotEmpty =>
          (id: request.approvalId, approval: true),
        QuestionContent(:final request)
            when request.outcome == null && request.questionId.isNotEmpty =>
          (id: request.questionId, approval: false),
        _ => null,
      };

  /// Releases resources.
  Future<void> dispose() async {
    await _phaseSub?.cancel();
    await _eventsSub?.cancel();
    await _tokenRefreshSub?.cancel();
  }
}
