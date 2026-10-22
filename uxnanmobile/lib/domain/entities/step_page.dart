import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// One answer of `turn/steps`: the previews of a run's steps, in stored order,
/// and — when the bridge's byte budget ended it before the run did — the
/// index to ask from next (`StepPage`, shared/src/models/history.ts).
class StepPage extends Equatable {
  /// Creates a [StepPage].
  const StepPage({required this.steps, this.next});

  /// Step previews: [CommandExecutionContent], [DiffContent] and
  /// [ToolUseContent], each with its stored index.
  final List<MessageContent> steps;

  /// The `from` to ask with for the rest of the run, when there is more.
  final int? next;

  @override
  List<Object?> get props => [steps, next];
}
