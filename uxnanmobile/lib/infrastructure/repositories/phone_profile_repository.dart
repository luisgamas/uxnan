import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/repositories/i_phone_profile_repository.dart';
import 'package:uxnan/domain/value_objects/phone_details.dart';

/// [IPhoneProfileRepository] over the platform (what the phone is) and
/// `shared_preferences` (the name its owner chose — not a secret).
class PhoneProfileRepository implements IPhoneProfileRepository {
  /// Creates a [PhoneProfileRepository].
  PhoneProfileRepository({
    Future<SharedPreferences>? preferences,
    DeviceInfoPlugin? deviceInfo,
    Future<PackageInfo> Function()? packageInfo,
  })  : _prefs = preferences ?? SharedPreferences.getInstance(),
        _deviceInfo = deviceInfo ?? DeviceInfoPlugin(),
        _packageInfo = packageInfo ?? PackageInfo.fromPlatform;

  final Future<SharedPreferences> _prefs;
  final DeviceInfoPlugin _deviceInfo;
  final Future<PackageInfo> Function() _packageInfo;

  static const String _nameKey = 'uxnan.phone.name';
  static const String _decidedAtKey = 'uxnan.phone.nameDecidedAt';

  @override
  Future<PhoneDetails> details() async {
    final version = await _appVersion();
    if (Platform.isAndroid) {
      final info = await _deviceInfo.androidInfo;
      final model = _join(info.manufacturer, info.model);
      return PhoneDetails(
        // The name set in the system settings ("Galaxy A55 de Luis"), the
        // model when there is none.
        defaultName: info.name.trim().isNotEmpty ? info.name.trim() : model,
        model: model,
        platform: 'android',
        osVersion: info.version.release,
        appVersion: version,
      );
    }
    if (Platform.isIOS) {
      final info = await _deviceInfo.iosInfo;
      final model =
          info.modelName.trim().isNotEmpty ? info.modelName : info.model;
      return PhoneDetails(
        // iOS no longer shares the name the user gave the device; the model
        // reads better than a generic "iPhone".
        defaultName: model,
        model: model,
        platform: 'ios',
        osVersion: info.systemVersion,
        appVersion: version,
      );
    }
    return PhoneDetails(
      defaultName: Platform.localHostname,
      platform: Platform.operatingSystem,
      appVersion: version,
    );
  }

  @override
  Future<PhoneNameChoice?> chosenName() async {
    final prefs = await _prefs;
    final name = prefs.getString(_nameKey);
    final at = prefs.getInt(_decidedAtKey);
    if (name == null || name.isEmpty || at == null) return null;
    return PhoneNameChoice(
      name: name,
      decidedAt: DateTime.fromMillisecondsSinceEpoch(at),
    );
  }

  @override
  Future<void> saveChosenName(PhoneNameChoice choice) async {
    final prefs = await _prefs;
    await prefs.setString(_nameKey, choice.name);
    await prefs.setInt(_decidedAtKey, choice.decidedAt.millisecondsSinceEpoch);
  }

  Future<String?> _appVersion() async {
    try {
      return (await _packageInfo()).version;
    } on Object {
      return null;
    }
  }

  /// "samsung" + "SM-A556E" → "samsung SM-A556E"; a model that already starts
  /// with its maker keeps it once.
  static String _join(String maker, String model) {
    final m = model.trim();
    final b = maker.trim();
    if (b.isEmpty || m.toLowerCase().startsWith(b.toLowerCase())) return m;
    return '$b $m';
  }
}
