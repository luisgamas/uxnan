import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/profile_avatar.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A bottom sheet to pick the profile's picture: a photo, or one of the preset
/// icons. Applied on Save. The name beside it is this phone's own, renamed from
/// the profile header (one name, the same on every paired PC).
class AvatarSheet extends ConsumerStatefulWidget {
  const AvatarSheet._();

  /// Shows the avatar sheet.
  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => const AvatarSheet._(),
    );
  }

  @override
  ConsumerState<AvatarSheet> createState() => _AvatarSheetState();
}

class _AvatarSheetState extends ConsumerState<AvatarSheet> {
  late ProfileAvatar _avatar = ref.read(profileAvatarProvider);
  bool _picking = false;

  Future<void> _pickImage() async {
    setState(() => _picking = true);
    final picked = await ref.read(attachmentPickerServiceProvider).pickAvatar();
    if (!mounted) return;
    setState(() {
      _picking = false;
      if (picked != null) {
        _avatar = ProfileAvatar.image(base64: picked.base64, mime: picked.mime);
      }
    });
  }

  Future<void> _save() async {
    await ref.read(profileAvatarProvider.notifier).set(_avatar);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            0,
            UxnanSpacing.lg,
            UxnanSpacing.lg,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.profileAvatarTitle, style: textTheme.titleMedium),
              const SizedBox(height: UxnanSpacing.lg),
              Center(child: ProfileAvatarView(avatar: _avatar, size: 88)),
              const SizedBox(height: UxnanSpacing.md),
              Center(
                child: FilledButton.tonalIcon(
                  onPressed: _picking ? null : _pickImage,
                  icon: const UxIcon(
                    UxIcons.image,
                    size: UxnanSize.iconContentSmall,
                  ),
                  label: Text(l10n.profileChoosePhoto),
                ),
              ),
              const SizedBox(height: UxnanSpacing.lg),
              Text(
                l10n.profilePickIcon,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: UxnanSpacing.sm),
              Wrap(
                spacing: UxnanSpacing.sm,
                runSpacing: UxnanSpacing.sm,
                children: [
                  for (final entry in kProfileAvatarIcons.entries)
                    _IconOption(
                      icon: entry.value,
                      label: l10n.profileAvatarIconLabel(entry.key),
                      selected: _avatar.kind == ProfileAvatarKind.icon &&
                          _avatar.iconKey == entry.key,
                      onTap: () => setState(
                        () => _avatar = ProfileAvatar.icon(entry.key),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: UxnanSpacing.lg),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(l10n.actionCancel),
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  FilledButton(
                    onPressed: _save,
                    child: Text(l10n.actionSave),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One preset icon in the picker.
///
/// Not an `IconSurface`: that is a 44 dp chrome action whose tooltip would pop
/// a name over a grid of pictures on every long-press, and whose selected tone
/// is the quiet secondary container — here the chosen picture has to read as
/// chosen at a glance, so it keeps the primary ring. What it borrows is the
/// contract: a [UxnanSize.minTouchTarget] circle that announces itself as a
/// named, selectable button.
class _IconOption extends StatelessWidget {
  const _IconOption({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final UxIconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: selected ? colors.primaryContainer : colors.surfaceContainerHigh,
        shape: CircleBorder(
          side: BorderSide(
            color: selected ? colors.primary : colors.outline,
            width: selected ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox.square(
            dimension: UxnanSize.minTouchTarget,
            child: UxIcon(
              icon,
              size: UxnanSize.iconSurfaceGlyph,
              color: selected
                  ? colors.onPrimaryContainer
                  : colors.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}
