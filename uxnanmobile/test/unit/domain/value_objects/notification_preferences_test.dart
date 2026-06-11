import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';

void main() {
  test('defaults to fully opted-in', () {
    const prefs = NotificationPreferences();
    expect(prefs.turnCompleted, isTrue);
    expect(prefs.turnError, isTrue);
  });

  test('toJson / fromJson round-trips', () {
    const prefs = NotificationPreferences(turnCompleted: false);
    expect(
      NotificationPreferences.fromJson(prefs.toJson()),
      prefs,
    );
  });

  test('fromJson is tolerant of missing or malformed fields (defaults on)', () {
    expect(
      NotificationPreferences.fromJson(const {}),
      const NotificationPreferences(),
    );
    expect(
      NotificationPreferences.fromJson(const {'turnCompleted': 'nope'}),
      const NotificationPreferences(),
    );
    expect(
      NotificationPreferences.fromJson(const {'turnError': false}),
      const NotificationPreferences(turnError: false),
    );
  });

  test('copyWith overrides only the given field', () {
    const prefs = NotificationPreferences();
    expect(
      prefs.copyWith(turnCompleted: false),
      const NotificationPreferences(turnCompleted: false),
    );
    expect(prefs.copyWith(), prefs);
  });

  test('value equality', () {
    expect(
      const NotificationPreferences(turnCompleted: false),
      const NotificationPreferences(turnCompleted: false),
    );
    expect(
      const NotificationPreferences(turnCompleted: false),
      isNot(const NotificationPreferences()),
    );
  });
}
