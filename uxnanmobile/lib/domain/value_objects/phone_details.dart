import 'package:equatable/equatable.dart';

/// What this phone is, as it tells each PC when it connects
/// (`device/describe`, architecture/02a §5.8.17).
class PhoneDetails extends Equatable {
  /// Creates [PhoneDetails].
  const PhoneDetails({
    required this.defaultName,
    this.model,
    this.platform,
    this.osVersion,
    this.appVersion,
  });

  /// What it calls itself until its owner names it: the name set in the
  /// system settings when there is one, its model otherwise.
  final String defaultName;

  /// Maker and model (e.g. `samsung SM-A556E`, `iPhone 15 Pro`).
  final String? model;

  /// `android` or `ios`.
  final String? platform;

  /// The operating system's version.
  final String? osVersion;

  /// The Uxnan app version.
  final String? appVersion;

  @override
  List<Object?> get props =>
      [defaultName, model, platform, osVersion, appVersion];
}

/// The name this phone's owner chose, and when (this phone's clock).
class PhoneNameChoice extends Equatable {
  /// Creates a [PhoneNameChoice].
  const PhoneNameChoice({required this.name, required this.decidedAt});

  /// The chosen name.
  final String name;

  /// When it was chosen — here, or on another client and adopted here.
  final DateTime decidedAt;

  @override
  List<Object?> get props => [name, decidedAt];
}
