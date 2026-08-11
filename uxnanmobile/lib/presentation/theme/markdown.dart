import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// The gap the Markdown renderer leaves between two blocks of the same body.
///
/// A reply that is still streaming is rendered as SEVERAL bodies, one per
/// settled chunk, so that only the chunk still growing is rebuilt. Separate
/// bodies have no gap between them, so it has to be put back by hand or the
/// answer visibly tightens as it is cut — measured at 8 logical pixels per
/// boundary, which is 32 px of drift over three paragraphs.
///
/// Resolved exactly the way the renderer resolves it — the theme's sheet merged
/// with ours — so a future override of `blockSpacing` is followed automatically
/// instead of silently disagreeing with a hard-coded copy.
double uxnanMarkdownBlockSpacing(BuildContext context) =>
    MarkdownStyleSheet.fromTheme(Theme.of(context))
        .merge(uxnanMarkdownStyleSheet(context))
        .blockSpacing ??
    0;

MarkdownStyleSheet uxnanMarkdownStyleSheet(BuildContext context) {
  final colors = Theme.of(context).colorScheme;
  final textTheme = Theme.of(context).textTheme;
  final isDark = Theme.of(context).brightness == Brightness.dark;
  final codeSurface =
      isDark ? colors.surfaceContainerHighest : colors.surfaceContainerHigh;
  return MarkdownStyleSheet(
    p: textTheme.bodyMedium,
    // Markdown needs SIX strictly descending steps; the UI scale does not have
    // six to spare, and two of its rungs deliberately share metrics
    // (titleLarge / headlineSmall differ in role, not size). So the deepest two
    // headings take an explicit size — the one place in the app where a
    // literal is right, because here the ramp itself is the requirement.
    // 20 → 18 → 16 → 14 → 13 → 12.
    h1: textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
    h2: textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
    h3: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
    h4: textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
    h5: textTheme.bodyMedium?.copyWith(
      fontSize: 13,
      fontWeight: FontWeight.w600,
    ),
    h6: textTheme.bodySmall?.copyWith(
      color: colors.onSurfaceVariant,
      fontWeight: FontWeight.w600,
    ),
    a: textTheme.bodyMedium?.copyWith(
      color: colors.primary,
      decoration: TextDecoration.underline,
      decorationColor: colors.primary,
    ),
    listBullet: textTheme.bodyMedium,
    code: UxnanTypography.codeBody.copyWith(
      backgroundColor: codeSurface,
    ),
    codeblockPadding: const EdgeInsets.all(UxnanSpacing.md),
    codeblockDecoration: BoxDecoration(
      color: codeSurface,
      borderRadius: const BorderRadius.all(UxnanRadius.md),
    ),
    blockquotePadding: const EdgeInsets.symmetric(
      horizontal: UxnanSpacing.md,
      vertical: UxnanSpacing.sm,
    ),
    blockquoteDecoration: BoxDecoration(
      color: colors.surfaceContainerHigh.withValues(alpha: 0.5),
      border: Border(
        left: BorderSide(color: colors.primary, width: 3),
      ),
      borderRadius: const BorderRadius.horizontal(right: UxnanRadius.md),
    ),
    horizontalRuleDecoration: BoxDecoration(
      border: Border(
        top: BorderSide(color: colors.outlineVariant),
      ),
    ),
    tableColumnWidth: const IntrinsicColumnWidth(),
    tableScrollbarThumbVisibility: true,
    tablePadding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
    tableCellsPadding: const EdgeInsets.symmetric(
      horizontal: UxnanSpacing.sm,
      vertical: UxnanSpacing.xs,
    ),
    tableHead: textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
    tableBody: textTheme.bodySmall,
    tableBorder: TableBorder.all(color: colors.outlineVariant),
  );
}
