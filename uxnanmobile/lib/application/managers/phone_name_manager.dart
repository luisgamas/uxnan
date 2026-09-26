import 'dart:math';

import 'package:rxdart/rxdart.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/paired_phone.dart';
import 'package:uxnan/domain/repositories/i_phone_profile_repository.dart';
import 'package:uxnan/domain/value_objects/phone_details.dart';

/// This phone's name, kept the same on every PC it is paired to
/// (architecture/02a §5.8.17).
///
/// The phone owns it: its default is what the system calls it (or its model),
/// and its owner may rename it here — or on Uxnan Desktop, which renames it on
/// that PC. Every time it connects, the phone describes itself
/// (`device/describe`) with its name and how long ago it was chosen; the
/// bridge keeps whichever decision is the latest and answers with it, and a
/// newer name chosen elsewhere is adopted here and carried to the other PCs.
class PhoneNameManager {
  /// Creates a [PhoneNameManager].
  PhoneNameManager({
    required IPhoneProfileRepository repository,
    DateTime Function()? clock,
  })  : _repository = repository,
        _clock = clock ?? DateTime.now;

  final IPhoneProfileRepository _repository;
  final DateTime Function() _clock;
  final BehaviorSubject<String?> _name = BehaviorSubject.seeded(null);
  PhoneDetails? _details;
  PhoneNameChoice? _choice;

  /// This phone's id on its PCs, once one of them has answered.
  String? get selfId => _selfId;
  String? _selfId;

  /// The name this phone goes by, once known.
  Stream<String?> get nameStream => _name.stream;

  /// The name this phone goes by now.
  String? get name => _name.value;

  /// What this phone is (loaded on first use).
  Future<PhoneDetails> details() async =>
      _details ??= await _repository.details();

  Future<void> _load() async {
    _choice ??= await _repository.chosenName();
    final details = await this.details();
    _name.add(_choice?.name ?? details.defaultName);
  }

  /// Names this phone. The PCs hear it the next time it describes itself —
  /// right away for the connected one, through [describe].
  Future<void> rename(String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return;
    _choice = PhoneNameChoice(name: trimmed, decidedAt: _clock());
    await _repository.saveChosenName(_choice!);
    _name.add(trimmed);
  }

  /// Tells the connected PC what this phone is and is called, and adopts a
  /// name decided there later than here. Never throws.
  Future<void> describe(RpcSend send) async {
    try {
      await _load();
      final details = await this.details();
      final choice = _choice;
      final response = await send('device/describe', {
        'name': choice?.name ?? details.defaultName,
        if (choice != null)
          'nameAgeMs':
              max(0, _clock().difference(choice.decidedAt).inMilliseconds),
        if (details.model != null) 'model': details.model,
        if (details.platform != null) 'platform': details.platform,
        if (details.osVersion != null) 'osVersion': details.osVersion,
        if (details.appVersion != null) 'appVersion': details.appVersion,
      });
      if (response.error != null) return;
      final result = response.result;
      if (result is! Map) return;
      final phone = PairedPhone.fromJson(result['device']);
      if (phone == null) return;
      _selfId = phone.deviceId;
      final age = result['nameAgeMs'];
      if (!phone.namedByUser || age is! int) return;
      final decidedThere = _clock().subtract(Duration(milliseconds: age));
      if (choice != null && !decidedThere.isAfter(choice.decidedAt)) return;
      if (phone.name == choice?.name) return;
      _choice = PhoneNameChoice(name: phone.name, decidedAt: decidedThere);
      await _repository.saveChosenName(_choice!);
      _name.add(phone.name);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('device/describe failed', error, stackTrace);
    }
  }

  /// Whether the PC's record of this phone, in [phones], disagrees with the
  /// name it goes by — a rename made there that it should hear about.
  bool isRenamedIn(List<PairedPhone> phones) {
    final id = _selfId;
    if (id == null) return false;
    for (final phone in phones) {
      if (phone.deviceId == id) return phone.name != _name.value;
    }
    return false;
  }

  /// Releases resources.
  Future<void> dispose() => _name.close();
}
