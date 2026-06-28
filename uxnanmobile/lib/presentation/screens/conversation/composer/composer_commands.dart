import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';

/// What a `/` palette entry does when picked.
enum ComposerCommandKind {
  /// Replaces the `/command` with a prompt template the user then completes.
  insertTemplate,

  /// Replaces the `/command` with `@`, handing off to the file/dir picker.
  startFileMention,
}

/// One entry in uxnan's own `/` command palette. These are **client-side**
/// actions (prompt templates + the file-mention hand-off), not the CLI agent's
/// own slash commands — those are interactive-mode features the bridge does not
/// drive. Keeping the catalog data-driven means the set is easy to curate.
class ComposerCommand {
  /// Creates a [ComposerCommand].
  const ComposerCommand({
    required this.id,
    required this.icon,
    required this.label,
    required this.description,
    required this.kind,
    this.template,
  });

  /// Stable, language-neutral id — also what `/<query>` matches against.
  final String id;

  /// Leading glyph in the palette row.
  final IconData icon;

  /// Localized display name.
  final String label;

  /// Localized one-line description.
  final String description;

  /// What picking the command does.
  final ComposerCommandKind kind;

  /// The text inserted for [ComposerCommandKind.insertTemplate] (else null).
  final String? template;
}

/// The `/` palette catalog, localized from [l10n]. The first entry hands off to
/// the `@` file picker; the rest drop in common prompt templates the user then
/// completes.
List<ComposerCommand> composerCommands(AppLocalizations l10n) => [
      ComposerCommand(
        id: 'files',
        icon: Icons.alternate_email_rounded,
        label: l10n.composerCmdFilesLabel,
        description: l10n.composerCmdFilesDesc,
        kind: ComposerCommandKind.startFileMention,
      ),
      ComposerCommand(
        id: 'explain',
        icon: Icons.lightbulb_outline_rounded,
        label: l10n.composerCmdExplainLabel,
        description: l10n.composerCmdExplainDesc,
        kind: ComposerCommandKind.insertTemplate,
        template: l10n.composerCmdExplainTemplate,
      ),
      ComposerCommand(
        id: 'review',
        icon: Icons.rate_review_outlined,
        label: l10n.composerCmdReviewLabel,
        description: l10n.composerCmdReviewDesc,
        kind: ComposerCommandKind.insertTemplate,
        template: l10n.composerCmdReviewTemplate,
      ),
      ComposerCommand(
        id: 'fix',
        icon: Icons.bug_report_outlined,
        label: l10n.composerCmdFixLabel,
        description: l10n.composerCmdFixDesc,
        kind: ComposerCommandKind.insertTemplate,
        template: l10n.composerCmdFixTemplate,
      ),
      ComposerCommand(
        id: 'tests',
        icon: Icons.science_outlined,
        label: l10n.composerCmdTestsLabel,
        description: l10n.composerCmdTestsDesc,
        kind: ComposerCommandKind.insertTemplate,
        template: l10n.composerCmdTestsTemplate,
      ),
    ];

/// Filters [commands] by a `/`-palette [rawQuery] (the text after the `/`),
/// matching the stable [ComposerCommand.id] or the localized label
/// (case-insensitive). An empty query returns the full catalog.
List<ComposerCommand> matchComposerCommands(
  List<ComposerCommand> commands,
  String rawQuery,
) {
  final q = rawQuery.trim().toLowerCase();
  if (q.isEmpty) return commands;
  return commands.where((c) {
    return c.id.toLowerCase().contains(q) || c.label.toLowerCase().contains(q);
  }).toList();
}
