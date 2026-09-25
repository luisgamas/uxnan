import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/phone_details.dart';
import 'package:uxnan/infrastructure/repositories/phone_profile_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  PhoneProfileRepository repository() => PhoneProfileRepository(
        preferences: SharedPreferences.getInstance(),
        packageInfo: () async => PackageInfo(
          appName: 'Uxnan',
          packageName: 'dev.luisgamas.uxnanmobile',
          version: '0.0.23',
          buildNumber: '1',
        ),
      );

  test('no chosen name until the owner picks one; then it is kept', () async {
    SharedPreferences.setMockInitialValues({});
    final repo = repository();
    expect(await repo.chosenName(), isNull);

    final choice = PhoneNameChoice(
      name: 'Travel phone',
      decidedAt: DateTime.fromMillisecondsSinceEpoch(1790000000000),
    );
    await repo.saveChosenName(choice);
    expect(await repository().chosenName(), choice);
  });

  test('a half-written choice reads as none', () async {
    SharedPreferences.setMockInitialValues({'uxnan.phone.name': 'Orphan'});
    expect(await repository().chosenName(), isNull);
  });
}
