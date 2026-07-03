import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// The running app's package info (app name, version, build number), loaded
/// from the platform via `package_info_plus`. Used by the About screen and the
/// Updates section to show the installed version.
final appPackageInfoProvider = FutureProvider<PackageInfo>((ref) {
  return PackageInfo.fromPlatform();
});
