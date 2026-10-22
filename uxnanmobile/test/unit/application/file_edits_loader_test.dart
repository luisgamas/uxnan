import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/file_edits_loader.dart';
import 'package:uxnan/domain/entities/step_page.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/repositories/i_turn_detail_repository.dart';
import 'package:uxnan/domain/services/work_runs.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// Serves a reply whose stored segments are [steps], by index.
class _Repository implements ITurnDetailRepository {
  _Repository(this.steps);

  final Map<int, MessageContent> steps;
  final List<String> asked = [];

  @override
  Future<StepPage> readSteps(
    String threadId,
    String turnId, {
    required int from,
    required int to,
    bool fresh = false,
  }) async {
    asked.add('steps $from..$to');
    // Two steps per page, like a budget would cut it.
    final indexes = steps.keys.where((i) => i >= from && i <= to).toList()
      ..sort();
    final page = indexes.take(2).toList();
    return StepPage(
      steps: [
        for (final i in page)
          switch (steps[i]!) {
            final DiffContent d => DiffContent(
                filename: d.filename,
                diff: '',
                additions: d.additions,
                index: i,
                diffChars: d.diff.length,
              ),
            final other => other,
          },
      ],
      next: indexes.length > 2 ? indexes[2] : null,
    );
  }

  @override
  Future<MessageContent> readStep(
    String threadId,
    String turnId,
    int index,
  ) async {
    asked.add('step $index');
    return steps[index]!;
  }
}

void main() {
  test("finds a file's edits in its runs and reads each body whole", () async {
    final repository = _Repository({
      1: const CommandExecutionContent(
        command: 'ls',
        status: CommandStatus.completed,
        index: 1,
      ),
      2: const DiffContent(filename: 'a', diff: '+one', additions: 1),
      3: const DiffContent(filename: 'b', diff: '+other', additions: 1),
      4: const DiffContent(filename: 'a', diff: '+two', additions: 1),
      7: const DiffContent(filename: 'a', diff: '+live', additions: 1),
    });
    const run = WorkRunContent(from: 1, to: 4, edits: 3);
    final edits = await FileEditsLoader(repository).load(
      'th',
      'tu',
      const TurnChangedFile(
        filename: 'a',
        additions: 3,
        runs: [run],
        edits: [
          // A live preview, by index.
          DiffContent(filename: 'a', diff: '', index: 7, diffChars: 5),
          // Held whole already: used as it is.
          DiffContent(filename: 'a', diff: '+stored'),
        ],
      ),
    );
    expect(edits.map((e) => e.diff), ['+stored', '+one', '+two', '+live']);
    expect(repository.asked, [
      'steps 1..4',
      'steps 3..4',
      'step 2',
      'step 4',
      'step 7',
    ]);
  });
}
