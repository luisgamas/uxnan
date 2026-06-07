import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/push_registrar.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/notifications/push_notification_service.dart';

/// A fake push service that avoids any Firebase / platform calls.
class _FakePushService extends PushNotificationService {
  String? token = 'tok-1';
  final StreamController<String> _refresh =
      StreamController<String>.broadcast();
  final List<({String title, String body, String? payload})> shown = [];

  void emitTokenRefresh(String value) => _refresh.add(value);

  @override
  Stream<String> get onTokenRefresh => _refresh.stream;

  @override
  Future<String?> getToken() async => token;

  @override
  Future<void> showLocalNotification({
    required String title,
    required String body,
    String? payload,
  }) async {
    shown.add((title: title, body: body, payload: payload));
  }

  Future<void> close() => _refresh.close();
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
      'preferences': {'turnCompleted': true, 'turnError': true},
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

  test('shows a local notification on turn error with its message', () async {
    events.add(
      const TurnErrorEvent(turnId: 't1', threadId: 'th1', message: 'boom'),
    );
    await _settle();

    expect(push.shown, hasLength(1));
    expect(push.shown.single.body, 'boom');
  });

  test('ignores other domain events', () async {
    events
      ..add(const TurnStartedEvent(turnId: 't1'))
      ..add(const MessageDeltaEvent(turnId: 't1', delta: 'x'));
    await _settle();
    expect(push.shown, isEmpty);
  });
}
