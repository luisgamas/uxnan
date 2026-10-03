import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';

/// How the PC's bridge reaches its relay right now (`RelayConnectionState`).
enum RelayConnectionState {
  /// No relay, or the relay is switched off.
  off,

  /// The bridge is opening its control socket to the relay.
  connecting,

  /// The bridge is connected and phones can reach it through the relay.
  connected,

  /// The last attempt failed; [RelayStatus.lastError] says why.
  error;

  /// Parses the wire value; unknown values read as [off].
  static RelayConnectionState fromWire(Object? value) => switch (value) {
        'connecting' => connecting,
        'connected' => connected,
        'error' => error,
        _ => off,
      };
}

/// How the relay got there (`RelayProvider`).
enum RelayProvider {
  /// The bridge deployed it into the user's Cloudflare account.
  cloudflare,

  /// The user deployed it themselves and gave the bridge its URL.
  custom;

  /// Parses the wire value; `null` when absent or unknown.
  static RelayProvider? fromWire(Object? value) => switch (value) {
        'cloudflare' => cloudflare,
        'custom' => custom,
        _ => null,
      };
}

/// The PC's relay as its bridge reports it (`RelayStatus`, answered by every
/// `relay/*` method and carried whole by `stream/relay/updated`).
///
/// The bridge owns the relay: it deploys it, keeps it connected and reports
/// it. The phone only mirrors this and asks (architecture/02a §5.10).
class RelayStatus extends Equatable {
  /// Creates a [RelayStatus].
  const RelayStatus({
    required this.state,
    required this.bundledVersion,
    required this.tokenRemembered,
    required this.connectedPhones,
    this.endpoint,
    this.provider,
    this.lastError,
    this.deployedVersion,
  });

  /// Parses the wire object; `null` when it is malformed.
  static RelayStatus? fromJson(Object? json) {
    if (json is! Map) return null;
    final bundledVersion = json['bundledVersion'];
    if (bundledVersion is! String) return null;
    String? text(String key) =>
        json[key] is String ? json[key] as String : null;
    final phones = json['connectedPhones'];
    return RelayStatus(
      endpoint: RelayEndpoint.fromJson(json['endpoint']),
      provider: RelayProvider.fromWire(json['provider']),
      state: RelayConnectionState.fromWire(json['state']),
      lastError: text('lastError'),
      bundledVersion: bundledVersion,
      deployedVersion: text('deployedVersion'),
      tokenRemembered: json['tokenRemembered'] == true,
      connectedPhones: phones is int && phones >= 0 ? phones : 0,
    );
  }

  /// The relay, or `null` until one is set up.
  final RelayEndpoint? endpoint;

  /// How it got there, when one is set up.
  final RelayProvider? provider;

  /// How the bridge reaches it right now.
  final RelayConnectionState state;

  /// Why the last attempt failed, in words a person can act on.
  final String? lastError;

  /// The relay version this bridge ships — what `relay/update` deploys.
  final String bundledVersion;

  /// The version the deployed relay reports, when known.
  final String? deployedVersion;

  /// Whether the bridge keeps a Cloudflare token (in the PC's system keyring)
  /// for updating or removing the relay without asking for it again.
  final bool tokenRemembered;

  /// Phones talking to the bridge through the relay right now.
  final int connectedPhones;

  @override
  List<Object?> get props => [
        endpoint,
        provider,
        state,
        lastError,
        bundledVersion,
        deployedVersion,
        tokenRemembered,
        connectedPhones,
      ];
}
