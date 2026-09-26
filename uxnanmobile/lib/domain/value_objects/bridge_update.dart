import 'package:equatable/equatable.dart';

/// Where an update of the PC's bridge stands (`BridgeUpdatePhase`).
enum BridgeUpdatePhase {
  /// Nothing under way.
  idle,

  /// The bridge stopped to install the new version; it comes back on it.
  updating,

  /// The last attempt failed; [BridgeUpdate.failure] says why.
  failed;

  /// Parses the wire value; unknown values read as [idle].
  static BridgeUpdatePhase fromWire(Object? value) => switch (value) {
        'updating' => updating,
        'failed' => failed,
        _ => idle,
      };
}

/// Why an update of the bridge did not happen (`BridgeUpdateFailure`).
class BridgeUpdateFailure extends Equatable {
  /// Creates a [BridgeUpdateFailure].
  const BridgeUpdateFailure({
    required this.reason,
    required this.message,
    this.command,
  });

  /// Parses the wire object; `null` when it is malformed.
  static BridgeUpdateFailure? fromJson(Object? json) {
    if (json is! Map) return null;
    final reason = json['reason'];
    final message = json['message'];
    if (reason is! String || message is! String) return null;
    final command = json['command'];
    return BridgeUpdateFailure(
      reason: reason,
      message: message,
      command: command is String ? command : null,
    );
  }

  /// `busy`, `unsupported`, `permission` or `install`.
  final String reason;

  /// What went wrong, for a person.
  final String message;

  /// The command that updates the bridge by hand, when that is the way out.
  final String? command;

  @override
  List<Object?> get props => [reason, message, command];
}

/// The PC's bridge's own update (`BridgeUpdate`, architecture/02a §5.8.18).
/// The bridge owns it: it knows the newest published version, installs it and
/// restarts itself (`bridge/update`), and tells every client
/// (`stream/bridge/updated`). The phone only mirrors it and asks.
class BridgeUpdate extends Equatable {
  /// Creates a [BridgeUpdate].
  const BridgeUpdate({
    required this.version,
    required this.available,
    required this.canApply,
    required this.phase,
    this.latestVersion,
    this.unsupportedReason,
    this.targetVersion,
    this.failure,
  });

  /// Parses the wire object; `null` when it is malformed.
  static BridgeUpdate? fromJson(Object? json) {
    if (json is! Map) return null;
    final version = json['version'];
    if (version is! String) return null;
    String? text(String key) =>
        json[key] is String ? json[key] as String : null;
    return BridgeUpdate(
      version: version,
      latestVersion: text('latestVersion'),
      available: json['available'] == true,
      canApply: json['canApply'] == true,
      unsupportedReason: text('unsupportedReason'),
      phase: BridgeUpdatePhase.fromWire(json['phase']),
      targetVersion: text('targetVersion'),
      failure: BridgeUpdateFailure.fromJson(json['failure']),
    );
  }

  /// The version running now.
  final String version;

  /// The newest published version, once the bridge knows it.
  final String? latestVersion;

  /// [latestVersion] is newer than [version].
  final bool available;

  /// The bridge can install it and restart by itself (it runs as the PC
  /// user's service); otherwise it is updated on the PC.
  final bool canApply;

  /// Why [canApply] is false, when it is.
  final String? unsupportedReason;

  /// Where an update stands.
  final BridgeUpdatePhase phase;

  /// The version being installed while [phase] is `updating`.
  final String? targetVersion;

  /// Why the last attempt failed, while [phase] is `failed`.
  final BridgeUpdateFailure? failure;

  @override
  List<Object?> get props => [
        version,
        latestVersion,
        available,
        canApply,
        unsupportedReason,
        phase,
        targetVersion,
        failure,
      ];
}
