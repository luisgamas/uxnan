import 'dart:math';

import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/value_objects/history_budget.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// How the phone reads the agent's steps the way the bridge serves them
/// (`shared/src/models/history.ts`): a step is a command, an edit, a tool call
/// or a thought; a page folds each run of them into one [WorkRunContent]; a
/// live turn streams each one as a preview that knows its stored index.
///
/// Pure functions, so the live view, the stored reply and the screen agree.

/// Whether [content] is a step of the agent's work.
bool isWorkStep(MessageContent content) =>
    content is CommandExecutionContent ||
    content is DiffContent ||
    content is ToolUseContent ||
    content is ThinkingContent;

/// The stored index of a step (its address for `turn/step`), or null for
/// anything else and for a step read before the bridge addressed steps.
int? stepIndexOf(MessageContent content) => switch (content) {
      final CommandExecutionContent c => c.index,
      final DiffContent c => c.index,
      final ToolUseContent c => c.index,
      final ThinkingContent c => c.index,
      _ => null,
    };

/// Whether a step failed — the bridge's `stepFailed`: an error status, a tool
/// error, a non-zero exit.
bool stepFailed(MessageContent step) => switch (step) {
      final CommandExecutionContent c => c.status == CommandStatus.error ||
          (c.exitCode != null && c.exitCode != 0),
      final ToolUseContent c => c.isError,
      _ => false,
    };

/// Whether a step is still running — the bridge's `stepRunning`. A thought
/// has no status: the live view marks the one still being written
/// ([ThinkingContent.isStreaming]), and no run counts it as running.
bool stepRunning(MessageContent step) => switch (step) {
      final CommandExecutionContent c => c.status == CommandStatus.running,
      final ToolUseContent c => c.running,
      _ => false,
    };

/// [run] with a newer state of one of its own steps ([step], whose index is
/// inside the run's range): a step that was running settles, so the counts
/// move with it. Only the run's last step is known by state, so another one
/// is taken to have been running — the only reason the bridge sends a step
/// again. The next page the bridge serves has the exact counts.
WorkRunContent absorbStep(WorkRunContent run, MessageContent step) {
  final index = stepIndexOf(step);
  final isLast = index == run.to;
  final previous = isLast ? run.last : null;
  final wasRunning = previous == null || stepRunning(previous);
  final wasFailed = previous != null && stepFailed(previous);
  return run.copyWith(
    running: max(
      0,
      run.running - (wasRunning ? 1 : 0) + (stepRunning(step) ? 1 : 0),
    ),
    failed: max(
      0,
      run.failed - (wasFailed ? 1 : 0) + (stepFailed(step) ? 1 : 0),
    ),
    files: step is DiffContent && previous is! DiffContent
        ? _mergeFile(run.files, step)
        : null,
    last: isLast ? step : null,
  );
}

/// [run] grown by [step], the step stored right after it.
WorkRunContent _extend(WorkRunContent run, MessageContent step) {
  final index = stepIndexOf(step)!;
  if (index >= run.from && index <= run.to) return absorbStep(run, step);
  return run.copyWith(
    from: min(run.from, index),
    to: max(run.to, index),
    commands: run.commands + (step is CommandExecutionContent ? 1 : 0),
    edits: run.edits + (step is DiffContent ? 1 : 0),
    tools: run.tools + (step is ToolUseContent ? 1 : 0),
    thoughts: run.thoughts + (step is ThinkingContent ? 1 : 0),
    failed: run.failed + (stepFailed(step) ? 1 : 0),
    running: run.running + (stepRunning(step) ? 1 : 0),
    files: step is DiffContent ? _mergeFile(run.files, step) : null,
    last: _preview(step),
  );
}

/// [step] as a run's `last` keeps it: a thought cut to its preview, the way
/// the bridge's `previewStep` cuts it; anything else as it is (live steps
/// already arrive as previews).
MessageContent _preview(MessageContent step) {
  if (step is! ThinkingContent) return step;
  final text = step.text;
  if (text.length <= HistoryBudget.stepThinkingPreviewChars) {
    return ThinkingContent(text, index: step.index, textChars: step.textChars);
  }
  return ThinkingContent(
    cutPreview(text, HistoryBudget.stepThinkingPreviewChars),
    index: step.index,
    textChars: step.textChars ?? text.length,
  );
}

/// The first [max] characters of [text], never splitting a surrogate pair —
/// the bridge's cut.
String cutPreview(String text, int max) {
  if (text.length <= max) return text;
  final unit = text.codeUnitAt(max - 1);
  final end = unit >= 0xd800 && unit <= 0xdbff ? max - 1 : max;
  return text.substring(0, end);
}

/// Adds a reasoning chunk to a reply's [segments], in place — the one rule
/// of `appendThinkingSegment` (shared/src/models/history.ts): the last
/// segment grows when it is a thought, otherwise a new thought opens at the
/// END (never before an open text run). An empty chunk changes nothing.
/// Returns whether it changed anything.
///
/// A last segment that is a summarized run ending on a thought (a re-sync
/// mid-thought) is that same stored thought growing: its preview grows with
/// it, up to the preview's length, and its full length is counted.
/// [indexOfNew] gives a new thought its stored index, when it is known.
bool appendThinkingSegment(
  List<MessageContent> segments,
  String delta, {
  int? indexOfNew,
}) {
  if (delta.isEmpty) return false;
  final last = segments.isEmpty ? null : segments.last;
  if (last is ThinkingContent) {
    segments[segments.length - 1] = ThinkingContent(
      last.text + delta,
      index: last.index,
      textChars: last.textChars == null ? null : last.textChars! + delta.length,
    );
    return true;
  }
  if (last is WorkRunContent) {
    final thought = last.last;
    if (thought is ThinkingContent && thought.index == last.to) {
      final whole = (thought.textChars ?? thought.text.length) + delta.length;
      final text = thought.isCut ? thought.text : thought.text + delta;
      segments[segments.length - 1] = last.copyWith(
        last: ThinkingContent(
          cutPreview(text, HistoryBudget.stepThinkingPreviewChars),
          index: thought.index,
          textChars:
              whole > HistoryBudget.stepThinkingPreviewChars ? whole : null,
        ),
      );
      return true;
    }
  }
  segments.add(ThinkingContent(delta, index: indexOfNew));
  return true;
}

/// The run of one [step], stored at [index].
WorkRunContent _runOf(MessageContent step, int index) => WorkRunContent(
      from: index,
      to: index,
      commands: step is CommandExecutionContent ? 1 : 0,
      edits: step is DiffContent ? 1 : 0,
      tools: step is ToolUseContent ? 1 : 0,
      thoughts: step is ThinkingContent ? 1 : 0,
      failed: stepFailed(step) ? 1 : 0,
      running: stepRunning(step) ? 1 : 0,
      files: step is DiffContent ? _mergeFile(const [], step) : const [],
      last: _preview(step),
    );

/// Two runs read as one, [later] stored after [earlier].
WorkRunContent _join(WorkRunContent earlier, WorkRunContent later) {
  var files = earlier.files;
  for (final file in later.files) {
    files = _mergeSummary(files, file);
  }
  return WorkRunContent(
    from: min(earlier.from, later.from),
    to: max(earlier.to, later.to),
    commands: earlier.commands + later.commands,
    edits: earlier.edits + later.edits,
    tools: earlier.tools + later.tools,
    thoughts: earlier.thoughts + later.thoughts,
    failed: earlier.failed + later.failed,
    running: earlier.running + later.running,
    files: files,
    last: later.last ?? earlier.last,
  );
}

List<ChangedFileSummary> _mergeFile(
  List<ChangedFileSummary> files,
  DiffContent diff,
) =>
    _mergeSummary(
      files,
      ChangedFileSummary(
        filename: diff.filename,
        additions: diff.additions,
        deletions: diff.deletions,
      ),
    );

List<ChangedFileSummary> _mergeSummary(
  List<ChangedFileSummary> files,
  ChangedFileSummary file,
) {
  if (file.filename.isEmpty) return files;
  final at = files.indexWhere((f) => f.filename == file.filename);
  if (at < 0) return [...files, file];
  final known = files[at];
  return [
    for (var i = 0; i < files.length; i++)
      if (i == at)
        ChangedFileSummary(
          filename: known.filename,
          additions: known.additions + file.additions,
          deletions: known.deletions + file.deletions,
        )
      else
        files[i],
  ];
}

/// [contents] with every run of consecutive addressed steps — and any
/// [WorkRunContent] they continue — folded into one [WorkRunContent], the
/// shape a page of history gives a reply. What a live turn kept as
/// individual previews is stored like this once it ends, so a stored reply
/// never holds a turn's steps one by one; a run a mid-turn resync summarized
/// and the steps that streamed after it read as one log.
///
/// A step without an index (read before the bridge addressed steps) cannot be
/// fetched again, so it is kept as it is.
List<MessageContent> foldWorkRuns(List<MessageContent> contents) {
  final out = <MessageContent>[];
  WorkRunContent? run;
  for (final content in contents) {
    if (content is WorkRunContent) {
      run = run == null ? content : _join(run, content);
      continue;
    }
    final index = stepIndexOf(content);
    if (index != null) {
      run = run == null ? _runOf(content, index) : _extend(run, content);
      continue;
    }
    if (run != null) {
      out.add(run);
      run = null;
    }
    out.add(content);
  }
  if (run != null) out.add(run);
  return out;
}

/// One file a turn changed: its line counts summed over every edit, and
/// where those edits are — the ones at hand ([edits], previews by index or
/// whole bodies) and the summarized runs that hold the rest ([runs]).
class TurnChangedFile extends Equatable {
  /// Creates a [TurnChangedFile].
  const TurnChangedFile({
    required this.filename,
    this.additions = 0,
    this.deletions = 0,
    this.edits = const [],
    this.runs = const [],
  });

  /// The file, as the agent named it.
  final String filename;

  /// Lines added across the turn.
  final int additions;

  /// Lines removed across the turn.
  final int deletions;

  /// The edits of this file the reply holds one by one.
  final List<DiffContent> edits;

  /// The summarized runs with edits of this file (their steps hold them).
  final List<WorkRunContent> runs;

  @override
  List<Object?> get props => [filename, additions, deletions, edits, runs];
}

/// The files a reply changed, merged by name in first-touched order, from its
/// edits ([DiffContent]) and its summarized runs' `files`.
List<TurnChangedFile> changedFilesOf(Iterable<MessageContent> contents) {
  final byName = <String, TurnChangedFile>{};
  void add(
    String filename,
    int additions,
    int deletions, {
    DiffContent? edit,
    WorkRunContent? run,
  }) {
    if (filename.isEmpty) return;
    final known = byName[filename];
    byName[filename] = TurnChangedFile(
      filename: filename,
      additions: (known?.additions ?? 0) + additions,
      deletions: (known?.deletions ?? 0) + deletions,
      edits: [...?known?.edits, if (edit != null) edit],
      runs: [...?known?.runs, if (run != null) run],
    );
  }

  for (final content in contents) {
    switch (content) {
      case final DiffContent diff:
        add(diff.filename, diff.additions, diff.deletions, edit: diff);
      case final WorkRunContent run:
        for (final file in run.files) {
          add(file.filename, file.additions, file.deletions, run: run);
        }
      default:
        break;
    }
  }
  return byName.values.toList();
}
