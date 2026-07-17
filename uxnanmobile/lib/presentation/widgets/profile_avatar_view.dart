import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/profile_avatar.dart';

/// The curated set of preset avatar icons, keyed by the string stored on
/// [ProfileAvatar.icon]. All values are `const IconData` so icon tree-shaking
/// still works (a dynamic `IconData(codePoint)` would break release builds).
const Map<String, IconData> kProfileAvatarIcons = {
  'person': Icons.person_rounded,
  'face': Icons.face_rounded,
  'astro': Icons.rocket_launch_rounded,
  'bolt': Icons.bolt_rounded,
  'star': Icons.star_rounded,
  'robot': Icons.smart_toy_rounded,
  'code': Icons.code_rounded,
  'terminal': Icons.terminal_rounded,
  'pets': Icons.pets_rounded,
  'bug': Icons.bug_report_rounded,
  'memory': Icons.memory_rounded,
  'public': Icons.public_rounded,
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
              errorBuilder: (_, __, ___) =>
                  _glyph(colors, Icons.person_rounded),
            ),
          ),
        );
      }
    }

    final icon = avatar.kind == ProfileAvatarKind.icon
        ? (kProfileAvatarIcons[avatar.iconKey] ?? Icons.person_rounded)
        : Icons.person_rounded;
    return _glyph(colors, icon);
  }

  Widget _glyph(ColorScheme colors, IconData icon) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        shape: BoxShape.circle,
        border: Border.all(color: colors.outline),
      ),
      child: Icon(icon, size: size * 0.5, color: colors.onSurfaceVariant),
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
