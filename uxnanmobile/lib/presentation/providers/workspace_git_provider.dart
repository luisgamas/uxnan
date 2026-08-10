import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// How long a folder's git state is reused before another `git/status` is
/// worth spending.
///
/// `uxnandesktop` sweeps every 3 s, which is nearly free when it is reading
/// its own disk. Here every sweep is a round trip to a PC that may be on the
/// far side of a relay, from a phone on a battery — and the moment that
/// actually changes the answer is the user committing, which
/// [gitStatusBusProvider] already reports the instant it happens. So the poll
/// is the slow safety net, not the mechanism.
const Duration kWorkspaceGitThrottle = Duration(seconds: 15);

/// What the UI knows about one folder's git state.
///
/// [stale] separates *we have nothing* from *we have last week's answer*: a
/// folder on a PC that went offline keeps showing what it last knew, dimmed,
/// rather than dropping to blank — which would read as "clean", the one thing
/// it must never claim without knowing.
typedef WorkspaceGitState = ({GitRepoState? git, bool stale});

/// Everything the app has been told about a folder's git state, by path.
///
/// Session-lived, so collapsing a folder and opening it again shows what was
/// known instead of blanking while a fresh request flies. Small by
/// construction: one status per folder the user has actually looked at.
final Map<String, _Cached> _cache = {};

/// Forgets every cached status. For tests, and whenever the paired PC changes
/// — one machine's paths mean nothing on another.
@visibleForTesting
void resetWorkspaceGitCache() => _cache.clear();

/// The git state of one working folder, by absolute path.
///
/// Deliberately **outside** the folder list's own build path: the list paints
/// immediately and these land as they arrive, so a slow or unreachable PC can
/// never hold up the screen the user opened in order to read it.
///
/// `autoDispose` is what makes the "only visible folders" rule real rather
/// than aspirational: a collapsed folder does not draw its indicators, so
/// nothing watches this, so nothing is fetched.
final workspaceGitProvider =
    FutureProvider.autoDispose.family<WorkspaceGitState, String>((
  ref,
  cwd,
) async {
  // Take the refresh from the bus instead of polling for it: after a
  // commit, push or pull the producer is already holding the new status,
  // so asking the bridge again would be a round trip to learn what we were
  // just handed.
  final sub = ref.watch(gitStatusBusProvider).changes.listen((change) {
    if (change.cwd != cwd) return;
    _cache[cwd] = _Cached(change.state, DateTime.now());
    // Re-runs this body, which now finds a fresh cache entry and returns
    // it without touching the network.
    ref.invalidateSelf();
  });
  ref.onDispose(sub.cancel);

  final cached = _cache[cwd];

  // Only for the PC we are actually talking to — everything live in this
  // app works that way, and a status read from one machine says nothing
  // about the same path on another.
  final connected = ref.watch(connectedDeviceProvider).value != null;
  if (!connected) return (git: cached?.state, stale: cached != null);

  final now = DateTime.now();
  if (cached != null && now.difference(cached.at) < kWorkspaceGitThrottle) {
    return (git: cached.state, stale: false);
  }

  try {
    final fresh = await ref.read(gitActionManagerProvider).refreshStatus(cwd);
    if (fresh == null) {
      return (git: cached?.state, stale: cached != null);
    }
    _cache[cwd] = _Cached(fresh, DateTime.now());
    return (git: fresh, stale: false);
  } on Object {
    // A folder that is not a repository, or a PC that dropped mid-request.
    // Neither deserves an error state in a list row: the row simply says
    // nothing about git, which is exactly the truth.
    return (git: cached?.state, stale: cached != null);
  }
});

class _Cached {
  const _Cached(this.state, this.at);

  final GitRepoState state;
  final DateTime at;
}
