import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/package_licenses.dart';

/// Aggregates Flutter's [LicenseRegistry] into a sorted list of packages, each
/// bundling every license text registered under its name. Loaded once,
/// asynchronously, so the licenses screen can show a loading state while the
/// registry streams in.
final packageLicensesProvider =
    FutureProvider<List<PackageLicenses>>((ref) async {
  final byPackage = <String, List<String>>{};
  await for (final license in LicenseRegistry.licenses) {
    final text = license.paragraphs.map((p) => p.text.trim()).join('\n\n');
    for (final package in license.packages) {
      (byPackage[package] ??= <String>[]).add(text);
    }
  }
  final entries = byPackage.entries
      .map((e) => PackageLicenses(packageName: e.key, paragraphs: e.value))
      .toList()
    ..sort(
      (a, b) =>
          a.packageName.toLowerCase().compareTo(b.packageName.toLowerCase()),
    );
  return entries;
});
