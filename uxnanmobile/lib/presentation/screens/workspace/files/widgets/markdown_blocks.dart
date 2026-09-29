import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_preview_support.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/highlighted_source.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Renders a fenced code block the way GitHub does: syntax-highlighted, and
/// horizontally scrollable instead of clipped at the content width.
///
/// The default renderer paints the block as plain wrapped text inside a clipped
/// container, so a long line simply disappeared past the right edge.
class MarkdownCodeBlockBuilder extends MarkdownElementBuilder {
  @override
  Widget visitElementAfter(md.Element element, TextStyle? preferredStyle) {
    final code = element.children?.whereType<md.Element>().firstWhere(
              (child) => child.tag == 'code',
              orElse: () => element,
            ) ??
        element;
    final classes = code.attributes['class'] ?? '';
    // FOR-DEV: a ```mermaid fence renders as highlighted source rather than a
    // diagram (GitHub draws it). Needs a pure-Dart renderer or an explicit
    // diagram placeholder; the mobile stack carries no WebView by design.
    final language = classes.startsWith('language-')
        ? languageIdForFence(classes.substring('language-'.length))
        : 'plaintext';

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.all(UxnanSpacing.md),
      child: HighlightedSource(
        source: code.textContent.trimRight(),
        language: language,
        selectable: false,
        filled: false,
        padding: EdgeInsets.zero,
      ),
    );
  }
}

/// GitHub alert callout (`> [!NOTE]`, `> [!WARNING]`, …).
///
/// GitHub renders these as a titled, colour-coded aside; Markdown itself has no
/// such construct, so the block is lifted out of the document and given the
/// chrome here while its body stays ordinary Markdown. The left rule matches
/// the blockquote it degrades from, so a document that mixes both reads as one
/// family.
class MarkdownAlertCard extends StatelessWidget {
  /// Creates a callout of [kind] wrapping [child].
  const MarkdownAlertCard({
    required this.kind,
    required this.child,
    super.key,
  });

  /// Which alert this is.
  final MarkdownAlertKind kind;

  /// Rendered Markdown body.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final accent = _accent(colors);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.08),
          border: Border(left: BorderSide(color: accent, width: 3)),
          borderRadius: const BorderRadius.horizontal(right: UxnanRadius.md),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.md,
            vertical: UxnanSpacing.sm,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  UxIcon(_icon, size: UxnanSpacing.lg, color: accent),
                  const SizedBox(width: UxnanSpacing.sm),
                  Text(
                    _title(AppLocalizations.of(context)),
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: accent,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: UxnanSpacing.xs),
              child,
            ],
          ),
        ),
      ),
    );
  }

  /// Semantic tone per alert kind, following GitHub's own mapping onto the
  /// app's tokens (informational → brand, advice → success, risk → error).
  Color _accent(ColorScheme colors) => switch (kind) {
        MarkdownAlertKind.note => colors.primary,
        MarkdownAlertKind.tip => UxnanColors.success,
        MarkdownAlertKind.important => colors.tertiary,
        MarkdownAlertKind.warning => UxnanColors.warning,
        MarkdownAlertKind.caution => colors.error,
      };

  UxIconData get _icon => switch (kind) {
        MarkdownAlertKind.note => UxIcons.info,
        MarkdownAlertKind.tip => UxIcons.lightbulb,
        MarkdownAlertKind.important => UxIcons.campaign,
        MarkdownAlertKind.warning => UxIcons.warningAmber,
        MarkdownAlertKind.caution => UxIcons.report,
      };

  String _title(AppLocalizations l10n) => switch (kind) {
        MarkdownAlertKind.note => l10n.markdownAlertNote,
        MarkdownAlertKind.tip => l10n.markdownAlertTip,
        MarkdownAlertKind.important => l10n.markdownAlertImportant,
        MarkdownAlertKind.warning => l10n.markdownAlertWarning,
        MarkdownAlertKind.caution => l10n.markdownAlertCaution,
      };
}

/// A `<details>` disclosure: a tappable summary row over collapsible Markdown.
///
/// READMEs use it to fold long sections (install matrices, FAQ entries). The
/// previous pass flattened the tags, so the hidden body was always visible and
/// the summary read as a stray line above it.
class MarkdownDetailsTile extends StatefulWidget {
  /// Creates a disclosure showing [summary] over [child].
  const MarkdownDetailsTile({
    required this.summary,
    required this.child,
    this.initiallyExpanded = false,
    super.key,
  });

  /// Label on the always-visible row.
  final String summary;

  /// Rendered Markdown body.
  final Widget child;

  /// Whether the document declared `<details open>`.
  final bool initiallyExpanded;

  @override
  State<MarkdownDetailsTile> createState() => _MarkdownDetailsTileState();
}

class _MarkdownDetailsTileState extends State<MarkdownDetailsTile> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final l10n = AppLocalizations.of(context);
    final label =
        widget.summary.isEmpty ? l10n.markdownDetails : widget.summary;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surfaceContainerHigh.withValues(alpha: 0.5),
          borderRadius: const BorderRadius.all(UxnanRadius.md),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              borderRadius: const BorderRadius.all(UxnanRadius.md),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.md,
                  vertical: UxnanSpacing.sm,
                ),
                child: Row(
                  children: [
                    AnimatedRotation(
                      turns: _expanded ? 0.25 : 0,
                      duration: const Duration(milliseconds: 150),
                      child: UxIcon(
                        UxIcons.chevronRight,
                        size: UxnanSpacing.xl,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    Expanded(
                      child: Text(
                        label,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_expanded)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  UxnanSpacing.md,
                  0,
                  UxnanSpacing.md,
                  UxnanSpacing.md,
                ),
                child: widget.child,
              ),
          ],
        ),
      ),
    );
  }
}
