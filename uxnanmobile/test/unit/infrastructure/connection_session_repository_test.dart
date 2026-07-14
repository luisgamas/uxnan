import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/connection_session.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/infrastructure/repositories/drift_connection_session_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

void main() {
  late UxnanDatabase db;
  late DriftConnectionSessionRepository repo;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    repo = DriftConnectionSessionRepository(db);
  });

  tearDown(() => db.close());

  ConnectionSession session(
    String id, {
    required DateTime started,
    DateTime? lastActive,
    DateTime? ended,
    ConnectionTransport transport = ConnectionTransport.direct,
    String deviceId = 'mac-1',
    String? endpoint,
  }) =>
      ConnectionSession(
        id: id,
        deviceId: deviceId,
        transport: transport,
        endpoint: endpoint,
        startedAt: started,
        lastActiveAt: lastActive ?? started,
        endedAt: ended,
      );

  test('start → end records a closed session carrying its duration', () async {
    await repo.startSession(session('s1', started: DateTime(2026, 7, 1, 10)));
    await repo.endSession('s1', DateTime(2026, 7, 1, 11));

    final all = await repo.getAll();
    expect(all, hasLength(1));
    expect(all.first.isOpen, isFalse);
    expect(all.first.duration, const Duration(hours: 1));
  });

  test('touchSession advances last-active but keeps it open', () async {
    await repo.startSession(session('s1', started: DateTime(2026, 7, 1, 10)));
    await repo.touchSession('s1', DateTime(2026, 7, 1, 10, 30));

    final all = await repo.getAll();
    expect(all.first.isOpen, isTrue);
    expect(all.first.duration, const Duration(minutes: 30));
  });

  test('closeDanglingSessions closes an open row at its last-active time',
      () async {
    await repo.startSession(session('s1', started: DateTime(2026, 7, 1, 10)));
    await repo.touchSession('s1', DateTime(2026, 7, 1, 10, 45));

    await repo.closeDanglingSessions();

    final all = await repo.getAll();
    expect(all.first.isOpen, isFalse);
    expect(all.first.endedAt, DateTime(2026, 7, 1, 10, 45));
    expect(all.first.duration, const Duration(minutes: 45));
  });

  test('endSession never resurrects or extends an already-closed session',
      () async {
    await repo.startSession(session('s1', started: DateTime(2026, 7, 1, 10)));
    await repo.endSession('s1', DateTime(2026, 7, 1, 11));
    // A late duplicate teardown must not move the recorded end forward.
    await repo.endSession('s1', DateTime(2026, 7, 1, 12));

    final all = await repo.getAll();
    expect(all.first.endedAt, DateTime(2026, 7, 1, 11));
  });

  test('getAll returns sessions most-recent first, preserving transport',
      () async {
    await repo.startSession(
      session('s1', started: DateTime(2026, 7, 1, 10)),
    );
    await repo.startSession(
      session(
        's2',
        started: DateTime(2026, 7, 2, 10),
        transport: ConnectionTransport.relay,
      ),
    );

    final all = await repo.getAll();
    expect(all.map((s) => s.id), ['s2', 's1']);
    expect(all.first.transport, ConnectionTransport.relay);
  });
}
