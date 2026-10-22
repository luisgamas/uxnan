import 'package:uxnan/domain/entities/step_page.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// Reads what a page of history leaves out, on demand (architecture/02b §1.5,
/// *Historial acotado*): a summarized run's steps, and one step whole — a
/// command, an edit, a tool call or a thought. Every method throws when the
/// bridge cannot answer — unreachable, an unknown turn, or a `ResponseTooLarge`
/// (-32011) refusal — as an `RpcException` when the bridge said why.
abstract interface class ITurnDetailRepository {
  /// The previews of the steps stored at [from]..[to] (inclusive) of the
  /// reply of [turnId]; follow [StepPage.next] for the rest. [fresh] skips
  /// the copy kept from an earlier read (a run still running changes).
  Future<StepPage> readSteps(
    String threadId,
    String turnId, {
    required int from,
    required int to,
    bool fresh = false,
  });

  /// The block stored at [index] of the reply of [turnId], whole: the whole
  /// command and output, the edit with its body, the call with its result,
  /// the whole thought.
  Future<MessageContent> readStep(String threadId, String turnId, int index);
}
