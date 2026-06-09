import 'package:uxnan/application/managers/thread_manager.dart' show RpcSend;
import 'package:uxnan/domain/entities/browse_result.dart';

/// Navigates the bridge's configured browse roots (`workspace/browseDirs`) so
/// the phone can pick any sub-directory as a new thread's working directory —
/// the plug-and-play alternative to the pre-configured project list.
class WorkspaceBrowser {
  /// Creates a [WorkspaceBrowser] that issues RPCs through [_send].
  const WorkspaceBrowser(this._send);

  final RpcSend _send;

  /// Browses [path] (relative to the root, `''`/null = the root itself) under
  /// [rootId] (null = the first configured root). Returns null on a malformed
  /// or missing response.
  Future<BrowseResult?> browse({String? rootId, String? path}) async {
    final response = await _send('workspace/browseDirs', {
      if (rootId != null) 'rootId': rootId,
      if (path != null) 'path': path,
    });
    return BrowseResult.fromJson(response.result);
  }
}
