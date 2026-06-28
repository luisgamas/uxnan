import 'dart:async';
import 'dart:convert';

import 'package:rxdart/rxdart.dart';
import 'package:uxnan/application/managers/thread_manager.dart' show RpcSend;
import 'package:uxnan/application/services/git_status_bus.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/domain/value_objects/git/git_status_change.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// Maximum directory depth the file browser will auto-descend into. The
/// browser is intentionally lazy (only the user-expanded directories fetch
/// children), but a single `workspace/list` call only fetches one level — so
/// a cap is only meaningful for the in-memory walk we use to flatten the tree.
/// We keep it as a safety net.
const int _kMaxDepth = 16;

/// Coordinates the file browser: lazy `workspace/list` walks, in-memory tree
/// state per (cwd, git status) pair, and read helpers used by the file viewer.
///
/// Designed to mirror the other managers' [RpcSend] pattern: it owns no
/// per-thread state, the providers' keys are the *active cwd* (a thread's
/// workspace, passed as an absolute path). One manager instance is shared
/// across the app; per-cwd trees are cached and rebuilt when the cwd or git
/// status changes.
///
/// **Path convention.** The bridge's `workspace/list` does `resolve(cwd)` on
/// the server side, so the `cwd` parameter must be the **absolute** path of
/// the directory to list — the bridge runs from the project root, not the
/// worktree / sub-folder the user is browsing, so a relative `cwd` would be
/// resolved against the wrong directory. The manager therefore joins the
/// workspace's absolute root (the [cwd] passed to [loadRoot]) with the
/// relative path of each expanded directory before sending.
///
/// **Git-status sync.** [statusBus] (optional, recommended) is the shared
/// `GitStatusBus` produced by `gitStatusBusProvider`. When wired, the
/// manager subscribes once and repaints any cwd it manages whenever a
/// `GitStatusChange` for that cwd arrives — including from external
/// producers (commits/pushes through the git screen, or a CLI commit done
/// outside the app on the same PC). Without the bus the manager still
/// works, but external changes are only visible after a manual reload.
class FileBrowserManager {
  /// Creates a [FileBrowserManager].
  ///
  /// [statusBus] (optional) is the shared [GitStatusBus]. When `null` the
  /// manager skips the subscription — useful for tests that drive the
  /// `git/status` RPC explicitly. In production the bus is always provided.
  FileBrowserManager({required RpcSend sendRequest, GitStatusBus? statusBus})
      : _sendRequest = sendRequest,
        _statusBus = statusBus {
    final bus = _statusBus;
    if (bus != null) {
      _statusSub = bus.changes.listen(_onStatusChange);
    }
  }

  final RpcSend _sendRequest;
  final GitStatusBus? _statusBus;
  StreamSubscription<GitStatusChange>? _statusSub;

  /// Per-cwd root tree. Kept as plain fields because each root is a single
  /// immutable `FileTreeNode` the UI watches; rebuilding it in place is the
  /// simplest way to drive a `BehaviorSubject` without a separate state
  /// store.
  final Map<String, FileTreeNode> _roots = <String, FileTreeNode>{};

  /// Per-cwd git status map (`path` to `GitFileStatus`), so the tree builder
  /// can paint the right color on each file. Cleared together with the root.
  final Map<String, Map<String, GitFileStatus>> _gitStatusByCwd =
      <String, Map<String, GitFileStatus>>{};

  /// `true` for cwds whose git status has been fetched at least once.
  final Set<String> _gitFetched = <String>{};

  final Map<String, BehaviorSubject<FileTreeNode?>> _rootSubjects =
      <String, BehaviorSubject<FileTreeNode?>>{};

  /// `true` while a root fetch is in flight for [cwd].
  final Map<String, bool> _loadingRoots = <String, bool>{};

  BehaviorSubject<FileTreeNode?> _subject(String cwd) =>
      _rootSubjects.putIfAbsent(
        cwd,
        () => BehaviorSubject.seeded(_roots[cwd]),
      );

  /// Streams the current root tree for [cwd]. Emits the latest tree on listen
  /// and every subsequent mutation (expand / collapse / git status update).
  Stream<FileTreeNode?> watchRoot(String cwd) => _subject(cwd).stream;

  /// The latest cached root for [cwd], or null when not yet loaded.
  FileTreeNode? rootFor(String cwd) => _roots[cwd];

  /// Loads the root of [cwd]. The first call lists the root entry itself; the
  /// phone then descends lazily as the user expands directories. Git status is
  /// fetched in parallel so changed files are painted immediately on first
  /// render. [cwd] is the **absolute** path of the workspace root.
  Future<void> loadRoot(String cwd) async {
    if (_roots.containsKey(cwd) && _loadingRoots[cwd] != true) {
      // Already loaded — still kick a git refresh in case the user just
      // committed or discarded, but don't re-list the directory.
      unawaited(refreshGitStatus(cwd));
      return;
    }
    _loadingRoots[cwd] = true;
    final subject = _subject(cwd)..add(_rootFor(cwd).copyWith(loading: true));
    try {
      final listing = await _list(cwd);
      // Apply the current git status (if any) to each entry so changed files
      // are painted immediately. New children created by a subsequent
      // `toggleDirectory` also receive the same treatment.
      final status = _gitStatusByCwd[cwd] ?? const <String, GitFileStatus>{};
      final root = FileTreeNode(
        name: '.',
        path: '.',
        type: FileEntryType.dir,
        children: _buildInitialChildren(
          listing.entries,
          parent: '.',
          status: status,
        ),
      );
      _roots[cwd] = root;
      subject.add(root);
    } on Object catch (error) {
      final root = FileTreeNode(
        name: '.',
        path: '.',
        type: FileEntryType.dir,
        error: _errorMessage(error),
      );
      _roots[cwd] = root;
      subject.add(root);
    } finally {
      _loadingRoots[cwd] = false;
    }
    // Best-effort git status (no-op for non-git cwds). Failure is silent so a
    // missing git status never blocks the browser.
    unawaited(refreshGitStatus(cwd));
  }

  /// Fetches `git/status` for [cwd] and patches the current root tree so each
  /// file carries the right [GitFileStatus]. Cleared/rebuilt on every call.
  ///
  /// Also publishes a [GitStatusChange] on the bus (when wired) so any other
  /// consumer — and, importantly, *this* manager's own listener for the
  /// reverse path — sees a consistent state. The payload is a minimal
  /// [GitRepoState] carrying only the `changedFiles` (the rest is irrelevant
  /// to the colour treatment and the only consumer today is this manager).
  Future<void> refreshGitStatus(String cwd) async {
    try {
      final response = await _sendRequest('git/status', {'cwd': cwd});
      final result = response.result;
      if (result is! Map) {
        _gitFetched.add(cwd);
        return;
      }
      final rawFiles = result['files'] ?? result['changedFiles'];
      final map = <String, GitFileStatus>{};
      final changedFiles = <GitChangedFile>[];
      if (rawFiles is List) {
        for (final entry in rawFiles) {
          if (entry is! Map) continue;
          final path = entry['path'] as String?;
          final status = entry['status'] as String?;
          if (path == null || status == null) continue;
          final parsed = _parseGitStatus(status);
          map[path] = parsed;
          changedFiles.add(GitChangedFile(path: path, status: parsed));
        }
      }
      _gitStatusByCwd[cwd] = map;
      _gitFetched.add(cwd);
      _repatchTree(cwd);
      _statusBus?.emit(
        GitStatusChange(
          cwd: cwd,
          state: GitRepoState(branch: '', changedFiles: changedFiles),
        ),
      );
    } on Object {
      // Best-effort: missing git status (no repo / not connected / older
      // bridge) is a soft state, not an error. We mark the cwd as "fetched"
      // so a missing status doesn't keep re-trying on every render.
      _gitFetched.add(cwd);
    }
  }

  static GitFileStatus _parseGitStatus(String name) {
    for (final value in GitFileStatus.values) {
      if (value.name == name) return value;
    }
    return GitFileStatus.modified;
  }

  /// Toggles the expansion of the directory at [path] under [cwd]. Expanding
  /// fetches the children lazily (only if not already loaded). Failures (a
  /// directory that no longer exists, a permission error, a stale cwd) mark
  /// the directory with an [FileTreeNode.error] rather than throwing — the
  /// UI then shows a recoverable error state without crashing the browser.
  Future<void> toggleDirectory(String cwd, String path) async {
    final current = _rootFor(cwd);
    final next = await _toggle(cwd, current, path, depth: 0);
    if (identical(next, current)) return;
    _roots[cwd] = next;
    _subject(cwd).add(next);
  }

  /// Collapses every expanded directory under [cwd] in one shot. The fetched
  /// children are kept in the tree (so re-expanding is instant) — only the
  /// `expanded` flag is cleared. No-op when nothing is expanded.
  void collapseAll(String cwd) {
    final current = _roots[cwd];
    if (current == null) return;
    final next = _collapse(current);
    if (identical(next, current)) return;
    _roots[cwd] = next;
    _subject(cwd).add(next);
  }

  /// Recursively clears `expanded` on every directory in the subtree. Returns
  /// the same instance when nothing changed so the stream doesn't churn.
  FileTreeNode _collapse(FileTreeNode node) {
    var childrenChanged = false;
    final newChildren = <FileTreeNode>[];
    for (final child in node.children) {
      final updated = _collapse(child);
      if (!identical(updated, child)) childrenChanged = true;
      newChildren.add(updated);
    }
    final mustCollapse = node.expanded && node.path != '.';
    if (!mustCollapse && !childrenChanged) return node;
    return node.copyWith(
      expanded: mustCollapse ? false : null,
      children: childrenChanged ? newChildren : null,
    );
  }

  /// Lists a single directory level for the `@`-mention picker: the entries of
  /// [relPath] (workspace-relative; `'.'`/`''` = the workspace root itself)
  /// under the workspace [cwd]. Unlike the lazy tree above this is a stateless
  /// one-shot `workspace/list` — the composer holds its own transient results,
  /// so this never touches the cached tree. Throws [FileListingException] on a
  /// malformed response (callers degrade to "no matches").
  Future<FileListing> listDirectory(String cwd, String relPath) =>
      _list(_joinPath(cwd, relPath));

  /// Repo-wide fuzzy file search for the `@`-mention picker (`workspace/
  /// searchFiles`): the best matches for [query] across [cwd], honoring
  /// `.gitignore`. [limit] caps results (the bridge clamps it). Throws
  /// [FileListingException] on a malformed response.
  Future<FileSearchResult> searchFiles(
    String cwd,
    String query, {
    int? limit,
  }) async {
    final response =
        await _sendRequest('workspace/searchFiles', <String, dynamic>{
      'cwd': cwd,
      'query': query,
      if (limit != null) 'limit': limit,
    });
    final error = response.error;
    if (error != null) {
      // -32601 (method not found) = an older bridge without this method. The
      // caller degrades to browsing + filtering the current directory.
      if (error.code == -32601) {
        throw const WorkspaceMethodUnsupported('workspace/searchFiles');
      }
      throw FileListingException(
        'workspace/searchFiles failed (${error.code}): ${error.message}',
      );
    }
    final result = response.result;
    if (result is! Map) {
      throw FileListingException(
        'Invalid workspace/searchFiles response for "$cwd" '
        '(got ${result.runtimeType}).',
      );
    }
    return FileSearchResult.fromJson(result.cast<String, dynamic>());
  }

  /// Reads a file's text content (UTF-8 or base64). Caller decides which path
  /// to render — for binary files the base64 form is returned and the viewer
  /// should fall back to a "binary preview" placeholder.
  Future<FileContent> readFile(String cwd, String path) async {
    final response = await _sendRequest('workspace/readFile', <String, dynamic>{
      'cwd': cwd,
      'path': path,
    });
    return _parseContent(response, 'workspace/readFile');
  }

  /// Reads a file as an inline base64 image. The bridge rejects non-image
  /// extensions with `-32602` (invalid params) — callers should only request
  /// images for known image extensions.
  Future<ImageFile> readImage(String cwd, String path) async {
    final response =
        await _sendRequest('workspace/readImage', <String, dynamic>{
      'cwd': cwd,
      'path': path,
    });
    return _parseImage(response, 'workspace/readImage');
  }

  /// Overwrites a text file's content via `workspace/applyPatch` (a single
  /// `modify` change). Reuses the existing patch RPC — no new contract — so the
  /// edit lands through the same sensitive-file guard as every other workspace
  /// write. After the write succeeds the cached git status is refreshed so the
  /// browser tree and the viewer's diff repaint with the new changes.
  ///
  /// [cwd] is the workspace's **absolute** root; [path] is workspace-relative.
  Future<void> writeFile(String cwd, String path, String content) async {
    final response =
        await _sendRequest('workspace/applyPatch', <String, dynamic>{
      'cwd': cwd,
      'changes': [
        <String, dynamic>{'op': 'modify', 'path': path, 'content': content},
      ],
    });
    final result = response.result;
    if (result is Map && result['success'] == false) {
      throw const FileReadException('workspace/applyPatch reported a failure');
    }
    // The file's git status almost certainly changed — repaint the tree so the
    // browser colours update without a manual refresh.
    unawaited(refreshGitStatus(cwd));
  }

  /// Fetches the unified diff for a single file (`git/diff { path }`).
  /// Returns an empty diff when there are no textual changes.
  Future<String> fileDiff(String cwd, String path) async {
    final response = await _sendRequest('git/diff', <String, dynamic>{
      'cwd': cwd,
      'path': path,
    });
    final result = response.result;
    if (result is! Map) return '';
    return result['diff'] as String? ?? '';
  }

  /// Clears the cached tree for [cwd]. Called when the user navigates away or
  /// the thread is destroyed.
  void invalidate(String cwd) {
    _roots.remove(cwd);
    _gitStatusByCwd.remove(cwd);
    _gitFetched.remove(cwd);
    _loadingRoots.remove(cwd);
    final subject = _rootSubjects.remove(cwd);
    if (subject != null && !subject.isClosed) {
      subject.add(null);
      unawaited(subject.close());
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  FileTreeNode _rootFor(String cwd) =>
      _roots[cwd] ??
      const FileTreeNode(
        name: '.',
        path: '.',
        type: FileEntryType.dir,
      );

  FileContent _parseContent(RpcMessage response, String method) {
    final result = response.result;
    if (result is Map) {
      return FileContent.fromJson(result.cast<String, dynamic>());
    }
    // A `null` or unexpected payload from the bridge is treated as a soft
    // failure: the file viewer shows its own error state instead of
    // crashing the whole browser. The message carries the method name so
    // the user can tell which call failed.
    throw FileReadException(
      'Invalid $method response (got ${result.runtimeType})',
    );
  }

  ImageFile _parseImage(RpcMessage response, String method) {
    final result = response.result;
    if (result is Map) {
      return ImageFile.fromJson(result.cast<String, dynamic>());
    }
    throw FileReadException(
      'Invalid $method response (got ${result.runtimeType})',
    );
  }

  /// Builds the absolute path the bridge expects: [workspaceRoot] joined with
  /// [relPath] (a workspace-relative path or `'.'` for the root itself).
  String _joinPath(String workspaceRoot, String relPath) {
    if (relPath == '.' || relPath.isEmpty) return workspaceRoot;
    // Normalize separators so the bridge gets a POSIX-style path even on
    // Windows clients.
    final root = workspaceRoot.replaceAll(r'\', '/');
    final rel = relPath.replaceAll(r'\', '/');
    final cleanRel = rel.startsWith('/') ? rel.substring(1) : rel;
    if (root.endsWith('/')) return '$root$cleanRel';
    return '$root/$cleanRel';
  }

  /// Sends `workspace/list` for [absPath] (already absolute) and parses the
  /// response. Throws [FileListingException] on a malformed response.
  Future<FileListing> _list(String absPath) async {
    final response = await _sendRequest('workspace/list', <String, dynamic>{
      'cwd': absPath,
    });
    final result = response.result;
    if (result is! Map) {
      throw FileListingException(
        'Invalid workspace/list response for "$absPath" '
        '(got ${result.runtimeType}).',
      );
    }
    return FileListing.fromJson(result.cast<String, dynamic>());
  }

  List<FileTreeNode> _buildInitialChildren(
    List<FileEntry> entries, {
    required String parent,
    required Map<String, GitFileStatus> status,
  }) {
    return [
      for (final entry in entries)
        _nodeFromEntry(entry, parent: parent, status: status),
    ];
  }

  FileTreeNode _nodeFromEntry(
    FileEntry entry, {
    required String parent,
    required Map<String, GitFileStatus> status,
  }) {
    final path = parent == '.' ? entry.name : '$parent/${entry.name}';
    return FileTreeNode(
      name: entry.name,
      path: path,
      type: entry.type,
      size: entry.size,
      mtime: entry.mtime,
      // Git ignores this entry (computed by the bridge per-listing). Carried
      // straight through so the tile can dim it; it's orthogonal to `gitStatus`
      // (ignored entries are never in `git/status`).
      ignored: entry.ignored,
      // Files inherit their git status from the cached `git/status` map so
      // they're coloured as soon as the listing arrives (no second rebuild).
      // Directories aggregate the status of their (possibly still-collapsed)
      // descendants so a changed file deep in the tree colours its parent
      // folders too — without forcing the user to expand them first.
      gitStatus: entry.type == FileEntryType.file
          ? status[path]
          : _dirStatus(path, status),
    );
  }

  /// Aggregated git status for the directory at [dirPath]:
  /// [GitFileStatus.modified] when any tracked descendant changed
  /// (added/modified/deleted/renamed), [GitFileStatus.untracked] when the only
  /// changes underneath are untracked files, or `null` when nothing changed
  /// below it. Lets folders carry the colour of their contents even while
  /// collapsed — the status map only holds *changed* paths, so this scan is
  /// cheap.
  static GitFileStatus? _dirStatus(
    String dirPath,
    Map<String, GitFileStatus> status,
  ) {
    if (status.isEmpty) return null;
    final prefix = '$dirPath/';
    GitFileStatus? aggregate;
    for (final entry in status.entries) {
      if (!entry.key.startsWith(prefix)) continue;
      // A tracked change is the strongest signal — short-circuit on it.
      if (entry.value != GitFileStatus.untracked) {
        return GitFileStatus.modified;
      }
      aggregate = GitFileStatus.untracked;
    }
    return aggregate;
  }

  /// Recursive toggle. Returns a new tree if the target's expansion state
  /// changed, or the same instance when nothing relevant was found.
  Future<FileTreeNode> _toggle(
    String workspaceRoot,
    FileTreeNode node,
    String path, {
    required int depth,
  }) async {
    if (depth > _kMaxDepth) return node;
    if (node.path == path) {
      if (!node.isDir) return node;
      if (node.expanded) return node.copyWith(expanded: false);
      // Expanding: if children haven't been loaded yet, fetch them first.
      if (node.children.isEmpty && !node.loading) {
        try {
          final absPath = _joinPath(workspaceRoot, node.path);
          final listing = await _list(absPath);
          // Apply the current git status (if any) to the new children so
          // changed files keep their colour when the user expands a deeper
          // directory after the initial git fetch.
          final status =
              _gitStatusByCwd[workspaceRoot] ?? const <String, GitFileStatus>{};
          return node.copyWith(
            children: _buildInitialChildren(
              listing.entries,
              parent: node.path,
              status: status,
            ),
            expanded: true,
          );
        } on Object catch (error) {
          // Surface the failure on the directory itself instead of throwing
          // out of the call. The user sees an inline error and can tap to
          // retry (or refresh from the app-bar action).
          return node.copyWith(
            error: _errorMessage(error),
            loading: false,
          );
        }
      }
      return node.copyWith(expanded: true);
    }
    var changed = false;
    final newChildren = <FileTreeNode>[];
    for (final child in node.children) {
      final updated =
          await _toggle(workspaceRoot, child, path, depth: depth + 1);
      if (!identical(updated, child)) changed = true;
      newChildren.add(updated);
    }
    if (!changed) return node;
    return node.copyWith(children: newChildren);
  }

  /// Re-paints the current root tree for [cwd] so each file carries the
  /// latest [GitFileStatus]. Walks the (already-loaded) tree in place; lazy
  /// children pick up the status on their first load.
  void _repatchTree(String cwd) {
    final root = _roots[cwd];
    if (root == null) return;
    final status = _gitStatusByCwd[cwd] ?? const <String, GitFileStatus>{};
    final updated = _applyGitStatus(root, status);
    if (identical(updated, root)) return;
    _roots[cwd] = updated;
    _subject(cwd).add(updated);
  }

  FileTreeNode _applyGitStatus(
    FileTreeNode node,
    Map<String, GitFileStatus> status,
  ) {
    final ownStatus =
        node.isFile ? status[node.path] : _dirStatus(node.path, status);
    var childrenChanged = false;
    final newChildren = <FileTreeNode>[];
    for (final child in node.children) {
      final updated = _applyGitStatus(child, status);
      if (!identical(updated, child)) childrenChanged = true;
      newChildren.add(updated);
    }
    // Rebuild only when this node's own status actually changed (this includes
    // a non-null → null transition: a file/folder that went clean after a
    // commit) or a descendant changed. Comparing against the *new* status — not
    // just `ownStatus == null` — is what clears a stale colour once the change
    // is committed; `copyWith` now propagates the `null` through.
    if (node.gitStatus == ownStatus && !childrenChanged) return node;
    return node.copyWith(
      gitStatus: ownStatus,
      children: childrenChanged ? newChildren : null,
    );
  }

  /// Releases all resources (subjects, caches).
  Future<void> dispose() async {
    await _statusSub?.cancel();
    for (final subject in _rootSubjects.values) {
      if (!subject.isClosed) await subject.close();
    }
    _rootSubjects.clear();
    _roots.clear();
    _gitStatusByCwd.clear();
    _gitFetched.clear();
    _loadingRoots.clear();
  }

  // ---------------------------------------------------------------------------
  // Bus integration
  // ---------------------------------------------------------------------------

  /// Listener for [GitStatusBus.changes]. Repaints any managed cwd that
  /// matches [GitStatusChange.cwd] from the supplied [GitRepoState]. Late
  /// events for a cwd the manager no longer holds are ignored.
  void _onStatusChange(GitStatusChange change) {
    final cwd = change.cwd;
    if (!_roots.containsKey(cwd)) return;
    final map = <String, GitFileStatus>{
      for (final f in change.state.changedFiles) f.path: f.status,
    };
    _gitStatusByCwd[cwd] = map;
    _gitFetched.add(cwd);
    _repatchTree(cwd);
  }
}

/// Raised when the bridge returns an unexpected payload to a workspace call.
/// Caught by the manager and surfaced as a per-node `error` field so the UI
/// can recover instead of crashing the whole screen.
class FileListingException implements Exception {
  /// Creates a [FileListingException].
  const FileListingException(this.message);

  /// Human-readable diagnostic.
  final String message;

  @override
  String toString() => 'FileListingException: $message';
}

/// Raised by [FileBrowserManager.searchFiles] when the connected bridge doesn't
/// implement the method (JSON-RPC -32601) — i.e. an older bridge predating
/// `workspace/searchFiles`. The composer catches this to degrade the `@` picker
/// to browsing + filtering the current directory.
class WorkspaceMethodUnsupported implements Exception {
  /// Creates a [WorkspaceMethodUnsupported] for [method].
  const WorkspaceMethodUnsupported(this.method);

  /// The JSON-RPC method the bridge didn't recognize.
  final String method;

  @override
  String toString() => 'WorkspaceMethodUnsupported: $method';
}

/// Raised by [FileBrowserManager.readFile] / [readImage] when the bridge
/// returns an unexpected payload. The file viewer catches this and shows
/// its own error state.
class FileReadException implements Exception {
  /// Creates a [FileReadException].
  const FileReadException(this.message);

  /// Human-readable diagnostic.
  final String message;

  @override
  String toString() => 'FileReadException: $message';
}

/// Returns a user-friendly message for any error the manager might catch
/// (RPC errors, timeouts, malformed payloads, network drops). Keeps the
/// diagnostic detail (the bridge's message) and drops the stack trace.
String _errorMessage(Object error) {
  if (error is RpcError) {
    return error.message;
  }
  if (error is FileListingException) {
    return error.message;
  }
  if (error is FileReadException) {
    return error.message;
  }
  return error.toString();
}

/// Helpers for callers that want to turn a [FileContent] into a UTF-8 string
/// or a binary blob without sprinkling the encoding check across the UI.
extension FileContentDecoding on FileContent {
  /// Returns the content as a UTF-8 string. Throws [FormatException] for
  /// base64 payloads — callers should branch on [FileContent.encoding] first.
  String get text {
    if (encoding == FileEncoding.utf8) return content;
    return utf8.decode(base64Decode(content));
  }

  /// Returns the content as raw bytes. For UTF-8 payloads we encode the
  /// string; for base64 payloads we decode the base64.
  List<int> get bytes {
    if (encoding == FileEncoding.base64) return base64Decode(content);
    return utf8.encode(content);
  }
}
