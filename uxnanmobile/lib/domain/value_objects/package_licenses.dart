import 'package:flutter/foundation.dart';

/// A third-party package and the license texts collected for it from Flutter's
/// `LicenseRegistry`. Named to avoid a clash with Flutter's own `LicenseEntry`.
@immutable
class PackageLicenses {
  /// Creates a [PackageLicenses].
  const PackageLicenses({required this.packageName, required this.paragraphs});

  /// The package name (e.g. `flutter`, `dio`).
  final String packageName;

  /// The full text of each license registered for this package.
  final List<String> paragraphs;

  /// How many distinct licenses this package registered.
  int get licenseCount => paragraphs.length;
}
