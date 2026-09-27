import 'package:flutter/material.dart';
import 'package:uxnan/infrastructure/media/attachment_picker_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_menu_button.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Compact add-to-turn menu anchored to the composer's "+" action: photos
/// (gallery, camera) for an agent that takes images, and a file for any agent
/// — every agent opens a file with its own tools.
///
/// With so few immediate actions, a contextual menu is more direct than
/// reserving the screen-wide footprint of a modal bottom sheet.
class TurnToolsMenuButton extends StatelessWidget {
  /// Creates the attachment menu button.
  const TurnToolsMenuButton({
    required this.onSelected,
    this.images = true,
    super.key,
  });

  /// Called after the user chooses a source.
  final ValueChanged<AttachmentSource> onSelected;

  /// Whether the agent takes images (offers the gallery and the camera).
  final bool images;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);

    return PopupMenuButton<AttachmentSource>(
      key: const ValueKey('turn-tools-menu'),
      tooltip: l10n.composerTools,
      position: PopupMenuPosition.over,
      constraints: kNeMenuConstraints,
      onSelected: onSelected,
      itemBuilder: (context) => [
        if (images) ...[
          PopupMenuItem(
            value: AttachmentSource.gallery,
            child: _MenuAction(
              icon: UxIcons.photoLibrary,
              label: l10n.composerAttachGallery,
            ),
          ),
          PopupMenuItem(
            value: AttachmentSource.camera,
            child: _MenuAction(
              icon: UxIcons.photoCamera,
              label: l10n.composerAttachCamera,
            ),
          ),
        ],
        PopupMenuItem(
          value: AttachmentSource.file,
          child: _MenuAction(
            icon: UxIcons.description,
            label: l10n.composerAttachFile,
          ),
        ),
      ],
      icon: UxIcon(
        UxIcons.add,
        size: 22,
        color: colors.onSurfaceVariant,
      ),
    );
  }
}

class _MenuAction extends StatelessWidget {
  const _MenuAction({required this.icon, required this.label});

  final UxIconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Row(
      children: [
        UxIcon(icon, size: 20, color: colors.onSurfaceVariant),
        const SizedBox(width: UxnanSpacing.md),
        Text(label, style: textTheme.bodyMedium),
      ],
    );
  }
}
