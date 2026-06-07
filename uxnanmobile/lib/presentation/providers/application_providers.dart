import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/coordinators/session_coordinator.dart';
import 'package:uxnan/application/managers/git_action_manager.dart';
import 'package:uxnan/application/managers/push_registrar.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/incoming_message_processor.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/connection_recovery_state.dart';
import 'package:uxnan/domain/entities/git/git_action_log_entry.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/services/pairing_validator.dart';
import 'package:uxnan/domain/value_objects/git/git_action_progress.dart';
import 'package:uxnan/domain/value_objects/turn_timeline_snapshot.dart';
import 'package:uxnan/infrastructure/transport/secure_transport_layer.dart';
import 'package:uxnan/infrastructure/transport/transport_selector.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';

/// Application-layer providers (coordinators and their derived UI state).
///
/// The coordinator owns connection state and exposes it as streams; the UI
/// consumes those through the `StreamProvider`s below (spec 03 §1.3).

/// The E2EE handshake + channel layer.
final secureTransportLayerProvider =
    Provider<SecureTransportLayer>((ref) => SecureTransportLayer());

/// Chooses and opens the transport for a device (relay; LAN deferred).
final transportSelectorProvider = Provider<TransportSelector>(
  (ref) => RelayTransportSelector(WebSocketChannelTransport.new),
);

/// Validates pairing QR payloads.
final pairingValidatorProvider =
    Provider<PairingValidator>((ref) => const PairingValidator());

/// The session coordinator (connection lifecycle, reconnection, RPC, pairing).
final sessionCoordinatorProvider = Provider<SessionCoordinator>((ref) {
  final coordinator = SessionCoordinator(
    secureTransport: ref.watch(secureTransportLayerProvider),
    transportSelector: ref.watch(transportSelectorProvider),
    identityResolver: () => ref.read(phoneIdentityStoreProvider).loadOrCreate(),
    trustedDeviceRepository: ref.watch(trustedDeviceRepositoryProvider),
    pairingValidator: ref.watch(pairingValidatorProvider),
  );
  ref.onDispose(coordinator.dispose);
  return coordinator;
});

/// Current connection phase, as a stream for the UI.
final connectionPhaseProvider = StreamProvider<ConnectionPhase>(
  (ref) => ref.watch(sessionCoordinatorProvider).connectionPhaseStream,
);

/// Reconnection recovery state, as a stream for the UI.
final connectionRecoveryProvider = StreamProvider<ConnectionRecoveryState>(
  (ref) => ref.watch(sessionCoordinatorProvider).recoveryStateStream,
);

/// The active bridge device, as a stream for the UI.
final activeMacProvider = StreamProvider<TrustedDevice?>(
  (ref) => ref.watch(sessionCoordinatorProvider).activeMacStream,
);

/// Reactive list of paired trusted devices (PCs), for the UI.
final trustedDevicesProvider = StreamProvider<List<TrustedDevice>>(
  (ref) => ref.watch(trustedDeviceRepositoryProvider).watchDevices(),
);

/// Classifies inbound bridge notifications into domain events.
final incomingMessageProcessorProvider =
    Provider<IncomingMessageProcessor>((ref) {
  return const IncomingMessageProcessor();
});

/// Coordinates threads and the active conversation timeline.
final threadManagerProvider = Provider<ThreadManager>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  final processor = ref.watch(incomingMessageProcessorProvider);
  final manager = ThreadManager(
    threadRepository: ref.watch(threadRepositoryProvider),
    messageRepository: ref.watch(messageRepositoryProvider),
    domainEvents: processor.bind(coordinator.incomingMessages),
    sendRequest: coordinator.sendRequest,
  );
  ref.onDispose(manager.dispose);
  return manager;
});

/// Reactive list of threads, for the UI.
final threadsProvider = StreamProvider<List<Thread>>(
  (ref) => ref.watch(threadManagerProvider).threadsStream,
);

/// The active thread's timeline, for the UI.
final activeTimelineProvider = StreamProvider<TurnTimelineSnapshot>(
  (ref) => ref.watch(threadManagerProvider).timelineStream,
);

/// The thread with the given id (from the reactive thread list), for the UI.
final threadByIdProvider = Provider.family<Thread?, String>((ref, threadId) {
  final threads = ref.watch(threadsProvider).value ?? const <Thread>[];
  for (final thread in threads) {
    if (thread.id == threadId) return thread;
  }
  return null;
});

/// The bridge's projects (`project/list`) for the new-conversation flow.
final projectsProvider = FutureProvider<List<Project>>(
  (ref) => ref.watch(threadManagerProvider).loadProjects(),
);

/// The bridge's agents (`agent/list`) for the new-conversation flow.
final agentsProvider = FutureProvider<List<AgentDescriptor>>(
  (ref) => ref.watch(threadManagerProvider).loadAgents(),
);

/// Registers the FCM push token with the bridge once the session connects and
/// raises local notifications for turn-completed / turn-error events.
///
/// Best-effort and non-blocking: it lazily initializes the (guarded) push
/// service, and silently no-ops when Firebase native config is absent. Watch
/// this provider from a widget (e.g. the root app) to keep it alive; the UI
/// feeds it localized copy via the registrar's `strings` setter.
final pushRegistrarProvider = Provider<PushRegistrar>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  final processor = ref.watch(incomingMessageProcessorProvider);
  final pushService = ref.watch(pushNotificationServiceProvider);
  // Fire-and-forget init: must never block app startup.
  unawaited(pushService.init());
  final registrar = PushRegistrar(
    pushService: pushService,
    sendRequest: coordinator.sendRequest,
    connectionPhases: coordinator.connectionPhaseStream,
    domainEvents: processor.bind(coordinator.incomingMessages),
  );
  ref.onDispose(registrar.dispose);
  return registrar;
});

/// Coordinates git actions (status, commit, push) for the active workspace.
final gitActionManagerProvider = Provider<GitActionManager>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  final processor = ref.watch(incomingMessageProcessorProvider);
  final manager = GitActionManager(
    sendRequest: coordinator.sendRequest,
    domainEvents: processor.bind(coordinator.incomingMessages),
    actionLog: ref.watch(gitActionLogRepositoryProvider),
  );
  ref.onDispose(manager.dispose);
  return manager;
});

/// The active workspace's git repository state, for the UI.
final gitRepoStateProvider = StreamProvider<GitRepoState?>(
  (ref) => ref.watch(gitActionManagerProvider).repoStateStream,
);

/// The in-flight git action's progress, for the UI.
final gitActiveActionProvider = StreamProvider<GitActionProgress?>(
  (ref) => ref.watch(gitActionManagerProvider).activeActionStream,
);

/// Recent git actions recorded for the given thread id, most recent first.
final gitActionHistoryProvider =
    StreamProvider.family<List<GitActionLogEntry>, String>(
  (ref, threadId) =>
      ref.watch(gitActionLogRepositoryProvider).watchForThread(threadId),
);
