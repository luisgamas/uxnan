import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/profile_avatar.dart';

void main() {
  test('icon avatar round-trips through JSON', () {
    const avatar = ProfileAvatar.icon('robot');
    final restored = ProfileAvatar.fromJson(avatar.toJson());
    expect(restored, avatar);
    expect(restored.kind, ProfileAvatarKind.icon);
    expect(restored.iconKey, 'robot');
  });

  test('image avatar round-trips through JSON', () {
    const avatar = ProfileAvatar.image(base64: 'AAAA', mime: 'image/png');
    final restored = ProfileAvatar.fromJson(avatar.toJson());
    expect(restored, avatar);
    expect(restored.kind, ProfileAvatarKind.image);
    expect(restored.imageBase64, 'AAAA');
    expect(restored.imageMime, 'image/png');
  });

  test('malformed / unknown documents degrade to the fallback', () {
    expect(
      ProfileAvatar.fromJson(const {'kind': 'icon'}),
      const ProfileAvatar.fallback(),
    );
    expect(
      ProfileAvatar.fromJson(const {'kind': 'image', 'data': ''}),
      const ProfileAvatar.fallback(),
    );
    expect(
      ProfileAvatar.fromJson(const {'kind': 'nonsense'}),
      const ProfileAvatar.fallback(),
    );
  });
}
