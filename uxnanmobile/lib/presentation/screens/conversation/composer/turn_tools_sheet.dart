import 'package:flutter/material.dart';
import 'package:uxnan/infrastructure/media/attachment_picker_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_menu_button.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

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
      constraints: kNeMenuConstraints,
      onSelected: onSelected,
      itemBuilder: (context) => [
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
