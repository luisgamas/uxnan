import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/package_licenses.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full license text(s) for a single package, one card per registered license.
class LicenseDetailScreen extends StatelessWidget {
  /// Creates the license detail screen for [entry].
  const LicenseDetailScreen({required this.entry, super.key});

  /// The package whose license texts are shown.
  final PackageLicenses entry;

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context, PackageLicenses entry) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => LicenseDetailScreen(entry: entry),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return NeScaffold(
      title: entry.packageName,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.lg,
            UxnanSpacing.xxl,
          ),
          sliver: SliverList.separated(
            itemCount: entry.paragraphs.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: UxnanSpacing.sm),
            itemBuilder: (context, i) => ExpressiveCard(
              color: colors.surfaceContainer,
              child: SelectableText(
                entry.paragraphs[i],
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                  height: 1.5,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
