import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/composer_handoff_provider.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_palette_card.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Drafts the composer was holding when a queued message was pulled back to be
/// edited.
///
/// Built on [ComposerPaletteCard], so it IS the `/` and `@` palettes' surface
/// rather than a look-alike: same tonal card, same 36 dp trigger badge, same
/// header and 56 dp row rhythm. Opened from the **Drafts** action beside the
/// queue button — a place to go back to, not something that should sit over the
/// conversation permanently.
class RescuedDraftsCard extends StatelessWidget {
  /// Creates a [RescuedDraftsCard].
  const RescuedDraftsCard({
    required this.drafts,
    required this.onRestore,
    required this.onDismiss,
    required this.onClearAll,
    super.key,
  });

  /// The saved drafts, newest first.
  final List<RescuedDraft> drafts;

  /// Called when a row is tapped.
  final ValueChanged<RescuedDraft> onRestore;

  /// Called when a row's delete button is tapped.
  final ValueChanged<RescuedDraft> onDismiss;

  /// Called once the header's clear-all action is confirmed.
  final VoidCallback onClearAll;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    return ComposerPaletteCard(
      key: const ValueKey('rescued-drafts'),
      // Parked composer text, not a typed trigger — the pencil says "yours,
      // unfinished" where `/` and `@` say "pick one of these".
      symbol: '✎',
      title: l10n.rescuedDraftsTitle,
      trailing: drafts.length > 1
          ? IconButton(
              onPressed: () => _confirmClearAll(context),
              tooltip: l10n.rescuedDraftsClearAll,
              icon: UxIcon(
                UxIcons.deleteSweep,
                size: 20,
                color: colors.onSurfaceVariant,
              ),
            )
          : null,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final draft in drafts)
            _RescuedDraftRow(
              key: ValueKey(draft.id),
              draft: draft,
              onRestore: () => onRestore(draft),
              onDismiss: () => onDismiss(draft),
            ),
        ],
      ),
    );
  }

  /// Clearing every draft is destructive and unrecoverable, so it asks —
  /// unlike deleting one row, which is a single, obvious, visible loss.
  Future<void> _confirmClearAll(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.rescuedDraftsClearAllTitle),
        content: Text(l10n.rescuedDraftsClearAllBody(drafts.length)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.actionCancel),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: TextButton.styleFrom(foregroundColor: colors.error),
            child: Text(l10n.rescuedDraftsClearAllConfirm),
          ),
        ],
      ),
    );
    if (confirmed ?? false) onClearAll();
  }
}

/// One saved draft: up to two lines of it, tap to put it back, delete to drop
/// it. Two lines rather than one because a draft is something the user was
/// still composing and needs to recognize — unlike a queued bubble, whose text
/// they just wrote and only need reminding of.
class _RescuedDraftRow extends StatelessWidget {
  const _RescuedDraftRow({
    required this.draft,
    required this.onRestore,
    required this.onDismiss,
    super.key,
  });

  final RescuedDraft draft;
  final VoidCallback onRestore;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final textTheme = theme.textTheme;
    final l10n = AppLocalizations.of(context);
    return InkWell(
      onTap: onRestore,
      child: ConstrainedBox(
        // The `/` palette's row rhythm.
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.only(left: UxnanSpacing.md),
          child: Row(
            children: [
              Expanded(
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
                  child: Text(
                    draft.text.trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.bodyMedium?.copyWith(
                      color: colors.onSurface,
                    ),
                  ),
                ),
              ),
              IconButton(
                onPressed: onDismiss,
                tooltip: l10n.rescuedDraftDiscard,
                visualDensity: VisualDensity.compact,
                icon: UxIcon(
                  UxIcons.delete,
                  size: 20,
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
