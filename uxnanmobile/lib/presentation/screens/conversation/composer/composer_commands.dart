import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/prompt_template.dart';
import 'package:uxnan/l10n/app_localizations.dart';

/// What a `/` palette entry does when picked.
enum ComposerCommandKind {
  /// Replaces the `/command` with a prompt template the user then completes.
  insertTemplate,

  /// Replaces the `/command` with `@`, handing off to the file/dir picker.
  startFileMention,
}

/// One entry in uxnan's own `/` command palette. These are **client-side**
/// actions (the `@`-file hand-off + user prompt templates), not the CLI agent's
/// own slash commands — those are interactive-mode features the bridge does not
/// drive.
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

  /// Stable, id — also what `/<query>` matches against.
  final String id;

  /// Leading glyph in the palette row.
  final IconData icon;

  /// Display name.
  final String label;

  /// One-line description (a body preview for templates).
  final String description;

  /// What picking the command does.
  final ComposerCommandKind kind;

  /// The text inserted for [ComposerCommandKind.insertTemplate] (else null).
  final String? template;
}

/// The `/` palette: the built-in `@`-file hand-off first, then the user's
/// [templates] (managed in Settings → Prompt templates).
List<ComposerCommand> composerCommands(
  AppLocalizations l10n,
  List<PromptTemplate> templates,
) =>
    [
      ComposerCommand(
        id: 'files',
        icon: Icons.alternate_email_rounded,
        label: l10n.composerCmdFilesLabel,
        description: l10n.composerCmdFilesDesc,
        kind: ComposerCommandKind.startFileMention,
      ),
      for (final t in templates)
        ComposerCommand(
          id: t.id,
          icon: Icons.notes_rounded,
          label: t.label,
          description: t.body,
          kind: ComposerCommandKind.insertTemplate,
          template: t.body,
        ),
    ];

/// The shipped default prompt templates, localized from [l10n]. Seeded into the
/// user's library on first run (and on a Settings *reset*); the user then owns
/// them. The `files` hand-off is **not** a template — it's always present.
List<PromptTemplate> defaultPromptTemplates(AppLocalizations l10n) => [
      PromptTemplate(
        id: 'explain',
        label: l10n.composerCmdExplainLabel,
        body: l10n.composerCmdExplainTemplate,
      ),
      PromptTemplate(
        id: 'review',
        label: l10n.composerCmdReviewLabel,
        body: l10n.composerCmdReviewTemplate,
      ),
      PromptTemplate(
        id: 'fix',
        label: l10n.composerCmdFixLabel,
        body: l10n.composerCmdFixTemplate,
      ),
      PromptTemplate(
        id: 'tests',
        label: l10n.composerCmdTestsLabel,
        body: l10n.composerCmdTestsTemplate,
      ),
    ];

/// Filters [commands] by a `/`-palette [rawQuery] (the text after the `/`),
/// matching the [ComposerCommand.id] or the label (case-insensitive). An empty
/// query returns the full catalog.
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
