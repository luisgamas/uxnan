import 'package:uxnan/domain/repositories/i_turn_detail_repository.dart';
import 'package:uxnan/domain/services/work_runs.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// Gathers every edit a turn made to one file, with its body, for the diff a
/// changed-files row opens.
///
/// A page of history names the files a run changed but not which of its
/// steps changed them, and no edit carries its body on the way in — so the
/// edits are found in their runs' steps (`turn/steps`) and each body is read
/// whole by its index (`turn/step`). An edit already held whole (stored
/// before the bridge addressed steps) is used as it is.
class FileEditsLoader {
  /// Creates a [FileEditsLoader].
  const FileEditsLoader(this._repository);

  final ITurnDetailRepository _repository;

  /// The edits of [file] in the reply of [turnId], in the order they were
  /// made, each with its body.
  Future<List<DiffContent>> load(
    String threadId,
    String turnId,
    TurnChangedFile file,
  ) async {
    final whole = <DiffContent>[];
    final indexes = <int>{};
    for (final edit in file.edits) {
      final index = edit.index;
      if (edit.hasBody) {
        whole.add(edit);
      } else if (index != null) {
        indexes.add(index);
      }
    }
    for (final run in file.runs) {
      int? from = run.from;
      while (from != null) {
        final page = await _repository.readSteps(
          threadId,
          turnId,
          from: from,
          to: run.to,
        );
        for (final step in page.steps) {
          final index = stepIndexOf(step);
          if (step is DiffContent &&
              step.filename == file.filename &&
              index != null) {
            indexes.add(index);
          }
        }
        from = page.next;
      }
    }
    final ordered = indexes.toList()..sort();
    final read = await Future.wait([
      for (final index in ordered)
        _repository.readStep(threadId, turnId, index),
    ]);
    return [
      ...whole,
      ...read.whereType<DiffContent>(),
    ];
  }
}
