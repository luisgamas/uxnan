import 'dart:async';

import 'package:uxnan/application/managers/file_browser_manager.dart'
    show FileBrowserManager;
import 'package:uxnan/application/managers/git_action_manager.dart'
    show GitActionManager;
import 'package:uxnan/domain/value_objects/git/git_status_change.dart';

/// Process-wide broadcast bus for `git/status` updates.
///
/// Anyone who drives a `git/status` RPC (today: [GitActionManager] after every
/// commit/push/pull/checkout/etc, [FileBrowserManager] on its own refresh)
/// calls [emit] with the new [GitStatusChange]. Any consumer interested in
/// "the working tree just changed" — typically the file browser so its
/// folder/file colour treatment stays in sync without manual refresh — calls
/// [changes] and repaints from the payload (no re-fetch needed).
///
/// **Why a dedicated bus (and not a method on `GitActionManager`).**
/// `GitActionManager` is itself a per-session application service, but
/// coupling the file browser to it would entangle two managers that today
/// only share the `RpcSend`. The bus is a one-direction pub/sub: producers
/// and consumers do not know each other. A future consumer (e.g. a search
/// pane, a "files changed" widget) can subscribe without touching the
/// git-action path.
///
/// **No-loop guarantee.** The bus carries a *state*, not a "please re-fetch"
/// signal. A listener that repaints from the payload never re-emits, so a
/// producer's own emission cannot bounce back into itself.
class GitStatusBus {
  /// Creates a [GitStatusBus] backed by a broadcast [StreamController].
  GitStatusBus();

  final StreamController<GitStatusChange> _controller =
      StreamController<GitStatusChange>.broadcast();

  /// Broadcast stream of every [GitStatusChange] published since the listener
  /// subscribed. Late subscribers do **not** receive a replay (a new
  /// subscriber that wants the current state should call the producer's
  /// `refresh*` method itself).
  Stream<GitStatusChange> get changes => _controller.stream;

  /// Publishes [change] to every current listener. Safe to call from
  /// `unawaited` code paths; a no-op once [dispose] has run.
  void emit(GitStatusChange change) {
    if (_controller.isClosed) return;
    _controller.add(change);
  }

  /// Closes the underlying controller. Subsequent [emit] calls are no-ops.
  Future<void> dispose() async {
    if (_controller.isClosed) return;
    await _controller.close();
  }
}
