import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/profile_avatar.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// The curated set of preset avatar icons, keyed by the string stored on
/// [ProfileAvatar.icon]. All values are `const UxIconData` so icon tree-shaking
/// still works (a dynamic `UxIconData(codePoint)` would break release builds).
const Map<String, UxIconData> kProfileAvatarIcons = {
  'person': UxIcons.person,
  'face': UxIcons.face,
  'astro': UxIcons.rocketLaunch,
  'bolt': UxIcons.bolt,
  'star': UxIcons.star,
  'robot': UxIcons.smartToy,
  'code': UxIcons.code,
  'terminal': UxIcons.terminal,
  'pets': UxIcons.pets,
  'bug': UxIcons.bugReport,
  'memory': UxIcons.memory,
  'public': UxIcons.public,
};

/// Renders a [ProfileAvatar] as a circular avatar: the picked image, a preset
/// icon, or the default person glyph — all on the app's neutral surface tone.
class ProfileAvatarView extends StatelessWidget {
  /// Creates a [ProfileAvatarView].
  const ProfileAvatarView({required this.avatar, this.size = 56, super.key});

  /// The avatar to render.
  final ProfileAvatar avatar;

  /// The diameter of the avatar circle.
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    if (avatar.kind == ProfileAvatarKind.image) {
      final bytes = _decode(avatar.imageBase64);
      if (bytes != null) {
        return Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: colors.outline),
          ),
          child: ClipOval(
            child: Image.memory(
              bytes,
              width: size,
              height: size,
              fit: BoxFit.cover,
              gaplessPlayback: true,
              errorBuilder: (_, __, ___) => _glyph(colors, UxIcons.person),
            ),
          ),
        );
      }
    }

    final icon = avatar.kind == ProfileAvatarKind.icon
        ? (kProfileAvatarIcons[avatar.iconKey] ?? UxIcons.person)
        : UxIcons.person;
    return _glyph(colors, icon);
  }

  Widget _glyph(ColorScheme colors, UxIconData icon) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        shape: BoxShape.circle,
        border: Border.all(color: colors.outline),
      ),
      child: UxIcon(icon, size: size * 0.5, color: colors.onSurfaceVariant),
    );
  }

  static Uint8List? _decode(String? base64Data) {
    if (base64Data == null || base64Data.isEmpty) return null;
    try {
      return base64Decode(base64Data);
    } on Object {
      return null;
    }
  }
}
