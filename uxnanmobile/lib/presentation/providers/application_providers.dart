import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/coordinators/session_coordinator.dart';
import 'package:uxnan/domain/entities/connection_recovery_state.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/services/pairing_validator.dart';
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
