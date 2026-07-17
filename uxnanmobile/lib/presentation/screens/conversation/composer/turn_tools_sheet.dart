import 'package:flutter/material.dart';
import 'package:uxnan/infrastructure/media/attachment_picker_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Compact add-to-turn menu anchored to the composer's "+" action.
///
/// With only two immediate media actions, a contextual menu is more direct
/// than reserving the screen-wide footprint of a modal bottom sheet.
class TurnToolsMenuButton extends StatelessWidget {
  /// Creates the attachment menu button.
  const TurnToolsMenuButton({required this.onSelected, super.key});

  /// Called after the user chooses a media source.
  final ValueChanged<AttachmentSource> onSelected;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);

    return PopupMenuButton<AttachmentSource>(
      key: const ValueKey('turn-tools-menu'),
      tooltip: l10n.composerTools,
      position: PopupMenuPosition.over,
      onSelected: onSelected,
      itemBuilder: (context) => [
        PopupMenuItem(
          value: AttachmentSource.gallery,
          child: _MenuAction(
            icon: Icons.photo_library_outlined,
            label: l10n.composerAttachGallery,
          ),
        ),
        PopupMenuItem(
          value: AttachmentSource.camera,
          child: _MenuAction(
            icon: Icons.photo_camera_outlined,
            label: l10n.composerAttachCamera,
          ),
        ),
      ],
      icon: Icon(
        Icons.add_rounded,
        size: 22,
        color: colors.onSurfaceVariant,
      ),
    );
  }
}

class _MenuAction extends StatelessWidget {
  const _MenuAction({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Row(
      children: [
        Icon(icon, size: 20, color: colors.onSurfaceVariant),
        const SizedBox(width: UxnanSpacing.md),
        Text(label, style: textTheme.bodyMedium),
      ],
    );
  }
}
