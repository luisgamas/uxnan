import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

MarkdownStyleSheet uxnanMarkdownStyleSheet(BuildContext context) {
  final colors = Theme.of(context).colorScheme;
  final textTheme = Theme.of(context).textTheme;
  final isDark = Theme.of(context).brightness == Brightness.dark;
  final codeSurface =
      isDark ? colors.surfaceContainerHighest : colors.surfaceContainerHigh;
  return MarkdownStyleSheet(
    p: textTheme.bodyMedium,
    h1: textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
    h2: textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
    h3: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
    h4: textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
    h5: textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600),
    h6: textTheme.labelMedium?.copyWith(
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
