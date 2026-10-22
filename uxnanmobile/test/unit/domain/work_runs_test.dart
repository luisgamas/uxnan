import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/services/work_runs.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

CommandExecutionContent _cmd(
  int index, {
  CommandStatus status = CommandStatus.completed,
  int? exitCode,
}) =>
    CommandExecutionContent(
      command: 'c$index',
      status: status,
      exitCode: exitCode,
      index: index,
    );

DiffContent _edit(int? index, String file, {int add = 1, int del = 0}) =>
    DiffContent(
      filename: file,
      diff: '',
      additions: add,
      deletions: del,
      index: index,
    );

void main() {
  group('step rules', () {
    test('a step is a command, an edit or a tool call', () {
      expect(isWorkStep(_cmd(0)), isTrue);
      expect(isWorkStep(_edit(1, 'a')), isTrue);
      expect(
        isWorkStep(const ToolUseContent(toolName: 't', toolId: 'i', input: {})),
        isTrue,
      );
      expect(isWorkStep(const TextContent('x')), isFalse);
      expect(stepIndexOf(_cmd(7)), 7);
      expect(stepIndexOf(const TextContent('x')), isNull);
    });

    test('failed and running follow the bridge', () {
      expect(stepFailed(_cmd(0, status: CommandStatus.error)), isTrue);
      expect(stepFailed(_cmd(0, exitCode: 2)), isTrue);
      expect(stepFailed(_cmd(0, exitCode: 0)), isFalse);
      expect(
        stepFailed(
          const ToolUseContent(
            toolName: 't',
            toolId: 'i',
            input: {},
            isError: true,
          ),
        ),
        isTrue,
      );
      expect(stepRunning(_cmd(0, status: CommandStatus.running)), isTrue);
      expect(stepRunning(_edit(0, 'a')), isFalse);
    });
  });

  group('foldWorkRuns', () {
    test('folds each run of addressed steps into one run', () {
      final folded = foldWorkRuns([
        const TextContent('a'),
        _cmd(1),
        _edit(2, 'x.dart', add: 3, del: 1),
        _cmd(3, exitCode: 1),
        const TextContent('b'),
        _cmd(5, status: CommandStatus.running),
      ]);
      expect(folded, hasLength(4));
      final first = folded[1] as WorkRunContent;
      expect((first.from, first.to), (1, 3));
      expect((first.commands, first.edits, first.tools), (2, 1, 0));
      expect(first.failed, 1);
      expect(first.files, const [
        ChangedFileSummary(filename: 'x.dart', additions: 3, deletions: 1),
      ]);
      expect(first.last, _cmd(3, exitCode: 1));
      final second = folded[3] as WorkRunContent;
      expect((second.from, second.to, second.running), (5, 5, 1));
    });

    test('continues a summarized run with the steps that follow it', () {
      final folded = foldWorkRuns([
        const WorkRunContent(
          from: 1,
          to: 4,
          commands: 4,
          files: [ChangedFileSummary(filename: 'a', additions: 1)],
        ),
        _edit(5, 'a', add: 2),
        _cmd(6),
      ]);
      final run = folded.single as WorkRunContent;
      expect((run.from, run.to, run.commands, run.edits), (1, 6, 5, 1));
      expect(run.files.single.additions, 3);
      expect(run.last, _cmd(6));
    });

    test('keeps a step without an index as it is', () {
      const legacy = CommandExecutionContent(
        command: 'old',
        status: CommandStatus.completed,
      );
      expect(foldWorkRuns(const [legacy]), const [legacy]);
    });
  });

  test('absorbStep settles a step of the run in its counts', () {
    final run = WorkRunContent(
      from: 1,
      to: 3,
      commands: 3,
      running: 1,
      last: _cmd(3, status: CommandStatus.running),
    );
    final settled = absorbStep(run, _cmd(3, exitCode: 1));
    expect(settled.running, 0);
    expect(settled.failed, 1);
    expect(settled.last, _cmd(3, exitCode: 1));
    expect(settled.commands, 3);
  });

  test('changedFilesOf merges edits and runs by file, first touched first', () {
    const run = WorkRunContent(
      from: 0,
      to: 4,
      edits: 2,
      files: [
        ChangedFileSummary(filename: 'b', additions: 5, deletions: 1),
        ChangedFileSummary(filename: 'a', additions: 1),
      ],
    );
    final files = changedFilesOf([
      _edit(null, 'a', add: 2),
      run,
      const TextContent('x'),
      _edit(9, 'c', del: 4),
    ]);
    expect(files.map((f) => f.filename), ['a', 'b', 'c']);
    expect((files[0].additions, files[0].edits.length), (3, 1));
    expect(files[0].runs, [run]);
    expect(files[1].runs, [run]);
    expect(files[2].deletions, 4);
  });

  group('appendThinkingSegment (the one rule)', () {
    test('grows the last thought, else opens one at the end', () {
      final segments = <MessageContent>[const TextContent('a')];
      expect(appendThinkingSegment(segments, ''), isFalse);
      expect(segments, const [TextContent('a')]);

      appendThinkingSegment(segments, 'think', indexOfNew: 1);
      appendThinkingSegment(segments, 'ing', indexOfNew: 9);
      expect(segments.last, const ThinkingContent('thinking', index: 1));

      // Never slotted before an open text run: after text, a new thought.
      segments.add(const TextContent('b'));
      appendThinkingSegment(segments, 'again', indexOfNew: 3);
      expect(segments, hasLength(4));
      expect(segments.last, const ThinkingContent('again', index: 3));
    });

    test("grows a summarized run's last thought, preview and length", () {
      final segments = <MessageContent>[
        WorkRunContent(
          from: 0,
          to: 2,
          thoughts: 1,
          last: ThinkingContent('x' * 598, index: 2),
        ),
      ];
      appendThinkingSegment(segments, 'yyyy');
      final run = segments.single as WorkRunContent;
      final thought = run.last! as ThinkingContent;
      expect(thought.text, '${'x' * 598}yy');
      expect(thought.textChars, 602);
      appendThinkingSegment(segments, 'z');
      expect(
        ((segments.single as WorkRunContent).last! as ThinkingContent)
            .textChars,
        603,
      );
    });
  });

  test('a thought folds into its run, counted and cut to its preview', () {
    final folded = foldWorkRuns([
      _cmd(0),
      ThinkingContent('t' * 900, index: 1),
      const TextContent('done'),
    ]);
    final run = folded.first as WorkRunContent;
    expect((run.from, run.to, run.commands, run.thoughts), (0, 1, 1, 1));
    expect(run.running, 0);
    final last = run.last! as ThinkingContent;
    expect((last.text.length, last.textChars, last.index), (600, 900, 1));
    expect(isWorkStep(last), isTrue);
    expect(stepRunning(const ThinkingContent('x', isStreaming: true)), isFalse);
  });
}
