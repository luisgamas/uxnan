import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/push_registrar.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/notifications/push_notification_service.dart';

/// A fake push service that avoids any Firebase / platform calls.
class _FakePushService extends PushNotificationService {
  String? token = 'tok-1';
  String? initial;
  final StreamController<String> _refresh =
      StreamController<String>.broadcast();
  final StreamController<String> _taps = StreamController<String>.broadcast();
  final List<({String title, String body, String? payload, String? key})>
      shown = [];
  final List<String> cancelled = [];

  void emitTokenRefresh(String value) => _refresh.add(value);

  void emitTap(String value) => _taps.add(value);

  @override
  Stream<String> get onTokenRefresh => _refresh.stream;

  @override
  Stream<String> get onNotificationTap => _taps.stream;

  @override
  Future<String?> initialThreadId() async => initial;

  @override
  Future<String?> getToken() async => token;

  @override
  Future<void> showLocalNotification({
    required String title,
    required String body,
    String? payload,
    String? key,
  }) async {
    shown.add((title: title, body: body, payload: payload, key: key));
  }

  @override
  Future<void> cancelLocalNotification(String key) async => cancelled.add(key);

  Future<void> close() async {
    await _refresh.close();
    await _taps.close();
  }
}

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  late _FakePushService push;
  late StreamController<ConnectionPhase> phases;
  late StreamController<DomainEvent> events;
  late List<({String method, Map<String, dynamic>? params})> sent;
  late PushRegistrar registrar;

  setUp(() {
    push = _FakePushService();
    phases = StreamController<ConnectionPhase>.broadcast();
    events = StreamController<DomainEvent>.broadcast();
    sent = [];
    registrar = PushRegistrar(
      pushService: push,
      sendRequest: (method, [params]) async {
        sent.add((method: method, params: params));
        return RpcMessage.response(id: 'r1', result: const {'ok': true});
      },
      connectionPhases: phases.stream,
      domainEvents: events.stream,
      isAndroid: true,
    );
  });

  tearDown(() async {
    await registrar.dispose();
    await push.close();
    await phases.close();
    await events.close();
  });

  test('registers the token when the session connects', () async {
    phases.add(ConnectionPhase.connected);
    await _settle();

    expect(sent, hasLength(1));
    expect(sent.single.method, 'notifications/register');
    expect(sent.single.params, {
      'pushToken': 'tok-1',
      'platform': 'android',
      'preferences': {
        'turnCompleted': true,
        'turnError': true,
        'needsInput': true,
      },
    });
  });

  test('does not register before connected', () async {
    phases.add(ConnectionPhase.connecting);
    await _settle();
    expect(sent, isEmpty);
  });

  test('does not re-register the same token on reconnect', () async {
    phases
      ..add(ConnectionPhase.connected)
      ..add(ConnectionPhase.reconnecting);
    await _settle();
    phases.add(ConnectionPhase.connected);
    await _settle();

    expect(sent, hasLength(1));
  });

  test('re-registers on token refresh', () async {
    phases.add(ConnectionPhase.connected);
    await _settle();
    push
      ..token = 'tok-2'
      ..emitTokenRefresh('tok-2');
    await _settle();

    expect(sent, hasLength(2));
    expect(sent.last.params!['pushToken'], 'tok-2');
  });

  test('shows a local notification on turn completed', () async {
    events.add(const TurnCompletedEvent(turnId: 't1', threadId: 'th1'));
    await _settle();

    expect(push.shown, hasLength(1));
    expect(push.shown.single.payload, 'th1');
  });

  test('shows a local notification on turn error', () async {
    events.add(
      const TurnErrorEvent(turnId: 't1', threadId: 'th1', message: 'boom'),
    );
    await _settle();

    expect(push.shown, hasLength(1));
    expect(push.shown.single.payload, 'th1');
  });

  test('titles with the thread name and bodies with the agent label', () async {
    final localPush = _FakePushService();
    final localEvents = StreamController<DomainEvent>.broadcast();
    final local = PushRegistrar(
      pushService: localPush,
      sendRequest: (method, [params]) async =>
          RpcMessage.response(id: 'r1', result: const {'ok': true}),
      connectionPhases: phases.stream,
      domainEvents: localEvents.stream,
      threadInfo: (id) =>
          id == 'th1' ? (title: 'Cambio de rutina', agent: 'Opencode') : null,
      strings: PushNotificationStrings(
        turnCompletedBody: (agent) => '$agent te respondió',
        turnErrorBody: (agent) => '$agent reportó un error',
        approvalNeededBody: (agent) => '$agent necesita tu aprobación',
        questionBody: (agent) => '$agent tiene una pregunta para ti',
        fallbackTitle: 'Uxnan',
      ),
      isAndroid: true,
    );

    localEvents.add(const TurnCompletedEvent(turnId: 't1', threadId: 'th1'));
    await _settle();
    expect(localPush.shown.single.title, 'Cambio de rutina');
    expect(localPush.shown.single.body, 'Opencode te respondió');

    await local.dispose();
    await localPush.close();
    await localEvents.close();
  });

  test('suppresses the notification for the conversation in the foreground',
      () async {
    // Isolated registrar (the shared one in setUp also listens to events).
    final localPush = _FakePushService();
    final localEvents = StreamController<DomainEvent>.broadcast();
    String? foreground = 'th1';
    final local = PushRegistrar(
      pushService: localPush,
      sendRequest: (method, [params]) async =>
          RpcMessage.response(id: 'r1', result: const {'ok': true}),
      connectionPhases: phases.stream,
      domainEvents: localEvents.stream,
      foregroundThreadId: () => foreground,
      isAndroid: true,
    );

    // Viewing th1: a turn-end for th1 is suppressed...
    localEvents.add(const TurnCompletedEvent(turnId: 't1', threadId: 'th1'));
    await _settle();
    expect(localPush.shown, isEmpty);

    // ...but a turn-end for a DIFFERENT thread still notifies...
    localEvents.add(const TurnCompletedEvent(turnId: 't2', threadId: 'th2'));
    await _settle();
    expect(localPush.shown, hasLength(1));
    expect(localPush.shown.single.payload, 'th2');

    // ...and once the user leaves (foreground cleared), th1 notifies again.
    foreground = null;
    localEvents.add(const TurnCompletedEvent(turnId: 't3', threadId: 'th1'));
    await _settle();
    expect(localPush.shown, hasLength(2));

    await local.dispose();
    await localPush.close();
    await localEvents.close();
  });

  group('an agent waiting on the person', () {
    const approval = ContentBlockEvent(
      turnId: 't1',
      threadId: 'th1',
      content: ApprovalContent(
        ApprovalRequest(approvalId: 'appr-1', action: 'Allow Bash: ls'),
      ),
    );
    const question = ContentBlockEvent(
      turnId: 't1',
      threadId: 'th1',
      content: QuestionContent(QuestionRequest(questionId: 'qst-1')),
    );

    test('raises one notification per request, keyed by its id', () async {
      events
        ..add(approval)
        ..add(question);
      await _settle();
      expect(push.shown.map((n) => (n.key, n.body, n.payload)), [
        ('appr-1', ' needs your approval', 'th1'),
        ('qst-1', ' has a question for you', 'th1'),
      ]);
    });

    test('takes it back once the request is answered anywhere', () async {
      events
        ..add(
          const ApprovalResolvedEvent(
            approvalId: 'appr-1',
            decision: 'approve',
          ),
        )
        ..add(
          const QuestionResolvedEvent(
            questionId: 'qst-1',
            answers: [],
            skipped: true,
            withdrawn: true,
          ),
        );
      await _settle();
      expect(push.cancelled, ['appr-1', 'qst-1']);
    });

    test('says nothing for a settled card, the chat on screen, or when off',
        () async {
      events.add(
        const ContentBlockEvent(
          turnId: 't1',
          threadId: 'th1',
          content: ApprovalContent(
            ApprovalRequest(
              approvalId: 'appr-2',
              action: 'x',
              outcome: ApprovalOutcome(decision: ApprovalDecision.approve),
            ),
          ),
        ),
      );
      await _settle();
      expect(push.shown, isEmpty);

      final localPush = _FakePushService();
      final localEvents = StreamController<DomainEvent>.broadcast();
      var viewing = 'th1';
      var prefs = const NotificationPreferences();
      final local = PushRegistrar(
        pushService: localPush,
        sendRequest: (method, [params]) async =>
            RpcMessage.response(id: 'r1', result: const {'ok': true}),
        connectionPhases: phases.stream,
        domainEvents: localEvents.stream,
        foregroundThreadId: () => viewing,
        preferences: () => prefs,
        isAndroid: true,
      );
      localEvents.add(approval);
      await _settle();
      expect(localPush.shown, isEmpty);
      viewing = 'other';
      prefs = const NotificationPreferences(needsInput: false);
      localEvents.add(question);
      await _settle();
      expect(localPush.shown, isEmpty);

      await local.dispose();
      await localPush.close();
      await localEvents.close();
    });
  });

  test('ignores other domain events', () async {
    events
      ..add(const TurnStartedEvent(turnId: 't1'))
      ..add(const MessageDeltaEvent(turnId: 't1', delta: 'x'));
    await _settle();
    expect(push.shown, isEmpty);
  });

  test('forwards notification taps for deep-linking', () async {
    final tapped = <String>[];
    final sub = registrar.onNotificationTap.listen(tapped.add);
    push
      ..emitTap('th-42')
      ..emitTap('th-7');
    await _settle();
    await sub.cancel();

    expect(tapped, ['th-42', 'th-7']);
  });

  test('forwards the cold-start thread id', () async {
    push.initial = 'th-cold';
    expect(await registrar.initialThreadId(), 'th-cold');
  });

  group('notification preferences', () {
    test('registers with the current preferences', () async {
      final localPush = _FakePushService();
      final localPhases = StreamController<ConnectionPhase>.broadcast();
      final localSent = <({String method, Map<String, dynamic>? params})>[];
      final local = PushRegistrar(
        pushService: localPush,
        sendRequest: (method, [params]) async {
          localSent.add((method: method, params: params));
          return RpcMessage.response(id: 'r1', result: const {'ok': true});
        },
        connectionPhases: localPhases.stream,
        domainEvents: const Stream.empty(),
        preferences: () => const NotificationPreferences(turnError: false),
        isAndroid: true,
      );

      localPhases.add(ConnectionPhase.connected);
      await _settle();

      expect(localSent.single.params!['preferences'], {
        'turnCompleted': true,
        'turnError': false,
        'needsInput': true,
      });

      await local.dispose();
      await localPush.close();
      await localPhases.close();
    });

    test('suppresses a turn-completed notification when opted out', () async {
      final localPush = _FakePushService();
      final localEvents = StreamController<DomainEvent>.broadcast();
      final local = PushRegistrar(
        pushService: localPush,
        sendRequest: (method, [params]) async =>
            RpcMessage.response(id: 'r1', result: const {'ok': true}),
        connectionPhases: phases.stream,
        domainEvents: localEvents.stream,
        preferences: () => const NotificationPreferences(turnCompleted: false),
        isAndroid: true,
      );

      // turnCompleted is off → suppressed; turnError stays on → shown.
      localEvents.add(const TurnCompletedEvent(turnId: 't1', threadId: 'th1'));
      await _settle();
      expect(localPush.shown, isEmpty);

      localEvents.add(
        const TurnErrorEvent(turnId: 't2', threadId: 'th2', message: 'boom'),
      );
      await _settle();
      expect(localPush.shown, hasLength(1));

      await local.dispose();
      await localPush.close();
      await localEvents.close();
    });
  });
}
