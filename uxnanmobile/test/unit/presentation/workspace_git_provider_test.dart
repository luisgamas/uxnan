import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/git_action_manager.dart';
import 'package:uxnan/application/services/git_status_bus.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/git/git_status_change.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/workspace_git_provider.dart';

/// The rules that keep a folder list from turning into a network storm.
///
/// Every one of these is a *cost* decision, not a display one: fifteen folders
/// on screen is fifteen round trips to a PC that may be behind a relay, from a
/// phone on a battery. So the provider is tested on what it REFUSES to ask for
/// at least as much as on what it returns.
final _device = TrustedDevice(
  macDeviceId: 'mac-1',
  displayName: 'PC',
  macIdentityPublicKey: Uint8List(32),
  relayUrl: 'wss://relay.test',
  sessionId: 'session-1',
  pairedAt: DateTime(2026),
);

void main() {
  const cwd = '/dev/app';

  GitRepoState state({int ahead = 0}) =>
      GitRepoState(branch: 'main', ahead: ahead);

  /// Counts `git/status` calls so "did it ask?" is an assertion, not a guess.
  late int calls;
  late GitStatusBus bus;

  setUp(() {
    calls = 0;
    bus = GitStatusBus();
    resetWorkspaceGitCache();
  });

  tearDown(() => bus.dispose());

  ProviderContainer harness({required bool connected, int ahead = 0}) {
    final container = ProviderContainer(
      overrides: [
        gitStatusBusProvider.overrideWithValue(bus),
        connectedDeviceProvider.overrideWith(
          (ref) => Stream.value(
            connected ? _device : null,
          ),
        ),
        gitActionManagerProvider.overrideWithValue(
          _FakeGitActions(
            onStatus: (_) {
              calls++;
              return state(ahead: ahead);
            },
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  Future<WorkspaceGitState> read(ProviderContainer c) async {
    c.listen(workspaceGitProvider(cwd), (_, __) {});
    await c.read(connectedDeviceProvider.future);
    return c.read(workspaceGitProvider(cwd).future);
  }

  test('does not ask a PC we are not connected to', () async {
    final container = harness(connected: false);
    final value = await read(container);

    expect(calls, 0);
    expect(value.git, isNull);
    // Nothing known is NOT the same as clean, and the row must be able to tell.
    expect(value.stale, isFalse);
  });

  test('asks once, then serves the answer from cache', () async {
    final first = harness(connected: true);
    expect((await read(first)).git!.branch, 'main');
    expect(calls, 1);

    // A second container is a second screen visit: within the throttle window
    // it must not spend another round trip.
    final second = harness(connected: true);
    expect((await read(second)).git!.branch, 'main');
    expect(
      calls,
      1,
      reason: 'the throttle window was ignored — every folder would re-fetch',
    );
  });

  test('a commit refreshes it without a round trip', () async {
    final container = harness(connected: true);
    await read(container);
    expect(calls, 1);

    // The producer already holds the new status, so re-asking the bridge for
    // what it just handed us would be a round trip to learn nothing.
    bus.emit(GitStatusChange(cwd: cwd, state: state(ahead: 3)));
    await Future<void>.delayed(Duration.zero);

    final refreshed = await container.read(workspaceGitProvider(cwd).future);
    expect(refreshed.git!.ahead, 3);
    expect(calls, 1);
  });

  test("another folder's commit is not this folder's business", () async {
    final container = harness(connected: true);
    await read(container);

    bus.emit(GitStatusChange(cwd: '/dev/other', state: state(ahead: 9)));
    await Future<void>.delayed(Duration.zero);

    final unchanged = await container.read(workspaceGitProvider(cwd).future);
    expect(unchanged.git!.ahead, 0);
  });

  test('going offline keeps the last answer, marked as old', () async {
    final online = harness(connected: true);
    await read(online);

    final offline = harness(connected: false);
    final value = await read(offline);

    expect(value.git!.branch, 'main');
    expect(
      value.stale,
      isTrue,
      reason: 'a remembered answer shown as current would read as fresh truth',
    );
  });

  test('a folder that is not a repository is silent, not an error', () async {
    final container = ProviderContainer(
      overrides: [
        gitStatusBusProvider.overrideWithValue(bus),
        connectedDeviceProvider.overrideWith(
          (ref) => Stream.value(_device),
        ),
        gitActionManagerProvider.overrideWithValue(
          _FakeGitActions(onStatus: (_) => throw StateError('not a repo')),
        ),
      ],
    );
    addTearDown(container.dispose);

    final value = await read(container);
    expect(value.git, isNull);
  });
}

class _FakeGitActions implements GitActionManager {
  _FakeGitActions({required this.onStatus});

  final GitRepoState? Function(String cwd) onStatus;

  @override
  Future<GitRepoState?> refreshStatus(String cwd) async => onStatus(cwd);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
