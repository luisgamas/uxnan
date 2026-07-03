import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/package_licenses.dart';
import 'package:uxnan/presentation/providers/licenses_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PackageLicenses', () {
    test('licenseCount reflects the number of paragraphs', () {
      const entry = PackageLicenses(
        packageName: 'demo',
        paragraphs: ['MIT text', 'Apache text'],
      );
      expect(entry.licenseCount, 2);
    });
  });

  group('packageLicensesProvider', () {
    test('aggregates and sorts registry entries by package name', () async {
      // Register two packages (out of alphabetical order) before reading.
      LicenseRegistry.addLicense(() async* {
        yield const LicenseEntryWithLineBreaks(['zeta'], 'Zeta license');
        yield const LicenseEntryWithLineBreaks(['alpha'], 'Alpha license');
        yield const LicenseEntryWithLineBreaks(['alpha'], 'Alpha extra');
      });

      final container = ProviderContainer();
      addTearDown(container.dispose);

      final entries = await container.read(packageLicensesProvider.future);
      final byName = {for (final e in entries) e.packageName: e};

      // Both packages surfaced.
      expect(byName.containsKey('alpha'), isTrue);
      expect(byName.containsKey('zeta'), isTrue);
      // 'alpha' registered two license texts.
      expect(byName['alpha']!.licenseCount, 2);
      // The list is sorted case-insensitively; 'alpha' precedes 'zeta'.
      final names = entries.map((e) => e.packageName).toList();
      expect(names.indexOf('alpha'), lessThan(names.indexOf('zeta')));
    });
  });
}
