/// Pure logic for the composer's inline `@`-file mentions and `/`-command
/// palette. Kept widget-free so the trigger detection and text-replacement
/// rules can be unit-tested directly (the `ComposerBar` only renders the
/// results and drives the text controller).
library;

import 'package:equatable/equatable.dart';

/// What kind of inline affordance the cursor is currently inside.
enum ComposerTrigger {
  /// An `@` file/dir mention — backed by `workspace/list` under the thread cwd.
  file,

  /// A leading `/` command — backed by uxnan's own client-side command palette.
  command,
}

/// The active mention/command context at the caret: which [trigger] fired, the
/// [query] typed after it (excluding the trigger char), and where the trigger
/// char sits in the text ([triggerOffset]) so a selection can replace the right
/// range. Produced by [detectComposerTrigger]; `null` when the caret isn't in a
/// mention.
class ComposerTriggerContext extends Equatable {
  /// Creates a [ComposerTriggerContext].
  const ComposerTriggerContext({
    required this.trigger,
    required this.query,
    required this.triggerOffset,
    required this.cursor,
  });

  /// The kind of affordance that is active.
  final ComposerTrigger trigger;

  /// The text typed after the trigger char, up to the caret (may be empty).
  final String query;

  /// Index of the trigger char (`@` or the leading `/`) in the full text.
  final int triggerOffset;

  /// The caret offset the context was computed for.
  final int cursor;

  @override
  List<Object?> get props => [trigger, query, triggerOffset, cursor];
}

/// The result of applying a suggestion: the new [text] and where to place the
/// [cursor] after it.
typedef ComposerEdit = ({String text, int cursor});

bool _isWhitespace(String ch) => ch.trim().isEmpty;

/// Index of the first whitespace char in [text], or `text.length` when there is
/// none.
int _firstWhitespace(String text) {
  for (var i = 0; i < text.length; i++) {
    if (_isWhitespace(text[i])) return i;
  }
  return text.length;
}

/// Detects whether the caret at [cursor] sits inside an `@` mention or a
/// leading `/` command, returning the active [ComposerTriggerContext] or null.
///
/// Rules:
/// - **Command (`/`)**: only when the whole message *begins* with `/` and the
///   caret is within the unbroken run of non-whitespace chars right after it
///   (so a path like `lib/main.dart` mid-message never opens it).
/// - **File (`@`)**: the nearest `@` before the caret that sits at a word
///   boundary (start of text or after whitespace) with no whitespace between it
///   and the caret. The query may contain `/`, `.`, `-` etc. (a partial path).
ComposerTriggerContext? detectComposerTrigger(String text, int cursor) {
  if (cursor < 0 || cursor > text.length) return null;

  // Command palette — message-initial '/' only.
  if (text.startsWith('/')) {
    final end = _firstWhitespace(text);
    if (cursor >= 1 && cursor <= end) {
      return ComposerTriggerContext(
        trigger: ComposerTrigger.command,
        query: text.substring(1, cursor),
        triggerOffset: 0,
        cursor: cursor,
      );
    }
  }

  // File mention — nearest '@' at a word boundary, no whitespace up to caret.
  for (var i = cursor - 1; i >= 0; i--) {
    final ch = text[i];
    if (ch == '@') {
      final boundaryOk = i == 0 || _isWhitespace(text[i - 1]);
      if (!boundaryOk) return null;
      return ComposerTriggerContext(
        trigger: ComposerTrigger.file,
        query: text.substring(i + 1, cursor),
        triggerOffset: i,
        cursor: cursor,
      );
    }
    if (_isWhitespace(ch)) return null;
  }
  return null;
}

/// Splits a file-mention [query] into the directory part to list and the
/// basename fragment to filter by. `"lib/pres"` → `(dir: "lib", name: "pres")`;
/// `"lib/"` → `(dir: "lib", name: "")`; `"mai"` → `(dir: "", name: "mai")`.
({String dir, String name}) splitFileQuery(String query) {
  final slash = query.lastIndexOf('/');
  if (slash < 0) return (dir: '', name: query);
  return (dir: query.substring(0, slash), name: query.substring(slash + 1));
}

/// Replaces [ctx]'s `@<query>` with a picked file/dir [relativePath].
///
/// A directory keeps the user inside the picker: it re-inserts `@<path>/` with
/// a trailing slash and no closing space, so [detectComposerTrigger] still sees
/// an active mention and the next level lists. A file finalizes the mention:
/// `@<path>` followed by a single space, so the mention closes.
ComposerEdit applyFileMention(
  String text,
  ComposerTriggerContext ctx, {
  required String relativePath,
  required bool isDir,
}) {
  final insert = isDir ? '@$relativePath/' : '@$relativePath ';
  final newText = text.replaceRange(ctx.triggerOffset, ctx.cursor, insert);
  return (text: newText, cursor: ctx.triggerOffset + insert.length);
}

/// Replaces the leading `/command` token with [replacement], placing the caret
/// at its end. Used by the command palette to either drop in a prompt template
/// or hand off to the `@` picker.
ComposerEdit applyCommand(
  String text,
  ComposerTriggerContext ctx, {
  required String replacement,
}) {
  // Replace the whole command run (to the first whitespace), not just up to the
  // caret, so a mid-word selection still swaps the entire `/cmd`.
  final end = _firstWhitespace(text);
  final newText = text.replaceRange(0, end, replacement);
  return (text: newText, cursor: replacement.length);
}
