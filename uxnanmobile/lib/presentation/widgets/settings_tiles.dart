import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';

/// Neural Expressive building blocks for settings-style screens: a quiet
/// section label, a one-line hint, and dynamic-corner toggle / navigation rows.
///
/// They keep the whole settings area low-noise and consistent (guide §4.6 /
/// §7.2): calm `surfaceContainer` tone, grouped 24/4 corners with a 3 dp gap
/// (via [ExpressiveCardGroup]), no per-row dividers, no accent-colored headers.

/// A quiet section label (no accent color) sitting above a card group. The
/// content carries the emphasis, not the header.
class NeSectionHeader extends StatelessWidget {
  /// Creates a [NeSectionHeader].
  const NeSectionHeader({required this.label, this.first = false, super.key});

  /// The section label.
  final String label;

  /// Whether this is the first header on the screen (tighter top padding).
  final bool first;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        UxnanSpacing.xs,
        first ? 0 : UxnanSpacing.xl,
        UxnanSpacing.xs,
        UxnanSpacing.sm,
      ),
      child: Text(
        label,
        style: textTheme.titleSmall?.copyWith(
          color: colors.onSurfaceVariant,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}

/// A one-line explanatory note under a card group.
class NeSectionHint extends StatelessWidget {
  /// Creates a [NeSectionHint].
  const NeSectionHint({required this.text, super.key});

  /// The note text.
  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.xs,
        UxnanSpacing.sm,
        UxnanSpacing.xs,
        0,
      ),
      child: Text(
        text,
        style: textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
      ),
    );
  }
}

/// A toggle row rendered as a dynamic-corner [ExpressiveCard]. The
/// [SwitchListTile] owns the whole-row tap + switch semantics; the card
/// supplies the calm tone and grouped corners.
class NeSwitchTile extends StatelessWidget {
  /// Creates a [NeSwitchTile].
  const NeSwitchTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
    this.position = CardGroupPosition.single,
    super.key,
  });

  /// Position within the enclosing group (drives the corner radii).
  final CardGroupPosition position;

  /// Leading icon.
  final IconData icon;

  /// Primary label.
  final String title;

  /// Secondary label.
  final String subtitle;

  /// Current value.
  final bool value;

  /// Called when toggled.
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ExpressiveCard(
      position: position,
      color: colors.surfaceContainer,
      padding: EdgeInsets.zero,
      child: SwitchListTile(
        secondary: Icon(icon, color: colors.onSurfaceVariant),
        title: Text(title),
        subtitle: Text(subtitle),
        value: value,
        onChanged: onChanged,
      ),
    );
  }
}

/// A tappable navigation row rendered as a dynamic-corner card. The card owns
/// the tap so it gets the NE spring press-feedback. [trailing] defaults to a
/// chevron.
class NeNavTile extends StatelessWidget {
  /// Creates a [NeNavTile].
  const NeNavTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.trailing,
    this.position = CardGroupPosition.single,
    super.key,
  });

  /// Position within the enclosing group (drives the corner radii).
  final CardGroupPosition position;

  /// Leading icon.
  final IconData icon;

  /// Primary label.
  final String title;

  /// Secondary label.
  final String subtitle;

  /// Optional trailing widget (defaults to a chevron).
  final Widget? trailing;

  /// Tap handler.
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ExpressiveCard(
      position: position,
      onTap: onTap,
      color: colors.surfaceContainer,
      padding: EdgeInsets.zero,
      child: ListTile(
        leading: Icon(icon, color: colors.onSurfaceVariant),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: trailing ??
            Icon(Icons.chevron_right_rounded, color: colors.onSurfaceVariant),
      ),
    );
  }
}
