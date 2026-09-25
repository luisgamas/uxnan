import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/phone_name_manager.dart';
import 'package:uxnan/domain/entities/paired_phone.dart';
import 'package:uxnan/domain/repositories/i_phone_profile_repository.dart';
import 'package:uxnan/domain/value_objects/phone_details.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

class _FakeProfile implements IPhoneProfileRepository {
  PhoneNameChoice? choice;

  @override
  Future<PhoneDetails> details() async => const PhoneDetails(
        defaultName: 'Galaxy A55 de Luis',
        model: 'samsung SM-A556E',
        platform: 'android',
        osVersion: '16',
        appVersion: '0.0.23',
      );

  @override
  Future<PhoneNameChoice?> chosenName() async => choice;

  @override
  Future<void> saveChosenName(PhoneNameChoice choice) async =>
      this.choice = choice;
}

/// The bridge's answer to `device/describe`: the record, and — when a person
/// named it — how long ago.
RpcMessage _described(String name, {int? ageMs}) => RpcMessage(
      id: '1',
      result: {
        'device': {
          'deviceId': 'phone-1',
          'displayName': name,
          'nameSource': ageMs == null ? 'device' : 'user',
        },
        if (ageMs != null) 'nameAgeMs': ageMs,
      },
    );

void main() {
  late _FakeProfile profile;
  late DateTime now;
  late PhoneNameManager manager;
  late List<Map<String, dynamic>?> sent;

  setUp(() {
    profile = _FakeProfile();
    now = DateTime(2026, 9, 25, 12);
    manager = PhoneNameManager(repository: profile, clock: () => now);
    sent = [];
  });

  tearDown(() => manager.dispose());

  test('describes itself by its own name until its owner names it', () async {
    await manager.describe((method, [params]) async {
      sent.add(params);
      return _described('Galaxy A55 de Luis');
    });
    expect(sent.single, {
      'name': 'Galaxy A55 de Luis',
      'model': 'samsung SM-A556E',
      'platform': 'android',
      'osVersion': '16',
      'appVersion': '0.0.23',
    });
    expect(manager.name, 'Galaxy A55 de Luis');
    expect(manager.selfId, 'phone-1');
  });

  test('a name chosen here travels with how long ago it was chosen', () async {
    await manager.rename('  Travel phone ');
    now = now.add(const Duration(minutes: 5));
    await manager.describe((method, [params]) async {
      sent.add(params);
      return _described('Travel phone', ageMs: 300000);
    });
    expect(sent.single?['name'], 'Travel phone');
    expect(sent.single?['nameAgeMs'], 300000);
    expect(profile.choice?.name, 'Travel phone');
  });

  test('a newer name given on another client is adopted; an older is not',
      () async {
    await manager.rename('Mine');
    now = now.add(const Duration(hours: 1));
    // Renamed on the desktop 10 minutes ago — after "Mine".
    await manager.describe(
      (method, [params]) async => _described('Work phone', ageMs: 600000),
    );
    expect(manager.name, 'Work phone');
    expect(
      profile.choice?.decidedAt,
      now.subtract(const Duration(minutes: 10)),
    );

    // A PC that still holds an older decision does not win it back.
    await manager.describe(
      (method, [params]) async => _described('Stale', ageMs: 7200000),
    );
    expect(manager.name, 'Work phone');
  });

  test('knows when a PC calls it something else', () async {
    await manager.describe(
      (method, [params]) async => _described('Galaxy A55 de Luis'),
    );
    const other = PairedPhone(deviceId: 'phone-2', name: 'Someone else');
    expect(
      manager.isRenamedIn(const [
        PairedPhone(deviceId: 'phone-1', name: 'Galaxy A55 de Luis'),
        other,
      ]),
      isFalse,
    );
    expect(
      manager.isRenamedIn(const [
        PairedPhone(deviceId: 'phone-1', name: 'Renamed on the desktop'),
      ]),
      isTrue,
    );
  });

  test('never throws when the PC cannot answer', () async {
    await manager.describe(
      (method, [params]) async => throw StateError('offline'),
    );
    expect(manager.name, 'Galaxy A55 de Luis');
  });

  test('parses the bridge record of a paired phone', () {
    final phone = PairedPhone.fromJson({
      'deviceId': 'p',
      'displayName': 'Pixel',
      'nameSource': 'user',
      'model': 'Google Pixel 9',
      'platform': 'android',
      'pairedAt': 1000,
    });
    expect(phone?.namedByUser, isTrue);
    expect(phone?.model, 'Google Pixel 9');
    expect(phone?.pairedAt, DateTime.fromMillisecondsSinceEpoch(1000));
    expect(PairedPhone.fromJson({'displayName': 'no id'}), isNull);
  });
}
