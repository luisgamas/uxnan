import 'package:equatable/equatable.dart';

/// A phone paired to a PC, as that PC's bridge keeps it (`TrustedDevice` in
/// `shared/src/models/session.ts`, architecture/02a §5.8.17) — this one, or
/// another phone paired to the same PC.
class PairedPhone extends Equatable {
  /// Creates a [PairedPhone].
  const PairedPhone({
    required this.deviceId,
    required this.name,
    this.namedByUser = false,
    this.model,
    this.platform,
    this.osVersion,
    this.appVersion,
    this.pairedAt,
  });

  /// Parses one wire entry; `null` when it is malformed.
  static PairedPhone? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = json['deviceId'];
    final name = json['displayName'];
    if (id is! String || name is! String) return null;
    String? text(String key) =>
        json[key] is String ? json[key] as String : null;
    final paired = json['pairedAt'];
    return PairedPhone(
      deviceId: id,
      name: name,
      namedByUser: json['nameSource'] == 'user',
      model: text('model'),
      platform: text('platform'),
      osVersion: text('osVersion'),
      appVersion: text('appVersion'),
      pairedAt:
          paired is int ? DateTime.fromMillisecondsSinceEpoch(paired) : null,
    );
  }

  /// Parses a wire list, dropping malformed entries.
  static List<PairedPhone> listFromJson(Object? json) => [
        if (json is List)
          for (final raw in json)
            if (fromJson(raw) case final PairedPhone phone) phone,
      ];

  /// The phone's id on its PCs.
  final String deviceId;

  /// What every client calls it.
  final String name;

  /// Whether a person chose [name] (rather than the phone's own default).
  final bool namedByUser;

  /// Maker and model.
  final String? model;

  /// `android` or `ios`.
  final String? platform;

  /// Operating system version.
  final String? osVersion;

  /// Uxnan app version.
  final String? appVersion;

  /// When it was paired.
  final DateTime? pairedAt;

  @override
  List<Object?> get props => [
        deviceId,
        name,
        namedByUser,
        model,
        platform,
        osVersion,
        appVersion,
        pairedAt,
      ];
}
