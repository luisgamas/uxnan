import 'package:uxnan/domain/value_objects/phone_details.dart';

/// This phone's own profile: what it is, and the name its owner chose for it
/// (architecture/02a §5.8.17).
abstract class IPhoneProfileRepository {
  /// What this phone is: its default name, model, platform and versions.
  Future<PhoneDetails> details();

  /// The name its owner chose, or `null` while it goes by its default.
  Future<PhoneNameChoice?> chosenName();

  /// Records the name its owner chose.
  Future<void> saveChosenName(PhoneNameChoice choice);
}
