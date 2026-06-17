import 'dart:async';
import 'dart:convert';

import 'package:rxdart/rxdart.dart';
import 'package:uxnan/application/managers/thread_manager.dart' show RpcSend;
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';

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
/// workspace). One manager instance is shared across the app; per-cwd trees
/// are cached and rebuilt when the cwd or git status changes.
class FileBrowserManager {
  /// Creates a [FileBrowserManager].
  FileBrowserManager({required RpcSend sendRequest})
      : _sendRequest = sendRequest;

  final RpcSend _sendRequest;

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
  /// render.
  Future<void> loadRoot(String cwd) async {
    if (_roots.containsKey(cwd) && _loadingRoots[cwd] != true) {
      // Already loaded — still kick a git refresh in case the user just
      // committed or discarded, but don't re-list the directory.
      unawaited(refreshGitStatus(cwd));
      return;
    }
    _loadingRoots[cwd] = true;
    final subject = _subject(cwd);
    subject.add(_rootFor(cwd).copyWith(loading: true));
    try {
      final listing = await _list(cwd);
      final root = FileTreeNode(
        name: '.',
        path: '.',
        type: FileEntryType.dir,
        children: _buildInitialChildren(listing.entries, parent: '.'),
      );
      _roots[cwd] = root;
      subject.add(root);
    } on Object catch (error) {
      final root = FileTreeNode(
        name: '.',
        path: '.',
        type: FileEntryType.dir,
        error: '$error',
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
      if (rawFiles is List) {
        for (final entry in rawFiles) {
          if (entry is! Map) continue;
          final path = entry['path'] as String?;
          final status = entry['status'] as String?;
          if (path == null || status == null) continue;
          map[path] = _parseGitStatus(status);
        }
      }
      _gitStatusByCwd[cwd] = map;
      _gitFetched.add(cwd);
      _repatchTree(cwd);
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
  /// fetches the children lazily (only if not already loaded).
  Future<void> toggleDirectory(String cwd, String path) async {
    final current = _rootFor(cwd);
    final next = await _toggle(current, path, depth: 0);
    if (identical(next, current)) return;
    _roots[cwd] = next;
    _subject(cwd).add(next);
  }

  /// Reads a file's text content (UTF-8 or base64). Caller decides which path
  /// to render — for binary files the base64 form is returned and the viewer
  /// should fall back to a "binary preview" placeholder.
  Future<FileContent> readFile(String cwd, String path) async {
    final response = await _sendRequest('workspace/readFile', <String, dynamic>{
      'cwd': cwd,
      'path': path,
    });
    final result = response.result;
    if (result is! Map) {
      throw const FormatException('Invalid workspace/readFile response');
    }
    return FileContent.fromJson(result.cast<String, dynamic>());
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
    final result = response.result;
    if (result is! Map) {
      throw const FormatException('Invalid workspace/readImage response');
    }
    return ImageFile.fromJson(result.cast<String, dynamic>());
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

  Future<FileListing> _list(String cwd) async {
    final response = await _sendRequest('workspace/list', <String, dynamic>{
      'cwd': cwd,
    });
    final result = response.result;
    if (result is! Map) {
      throw const FormatException('Invalid workspace/list response');
    }
    return FileListing.fromJson(result.cast<String, dynamic>());
  }

  List<FileTreeNode> _buildInitialChildren(
    List<FileEntry> entries, {
    required String parent,
  }) {
    return [for (final entry in entries) _nodeFromEntry(entry, parent: parent)];
  }

  FileTreeNode _nodeFromEntry(
    FileEntry entry, {
    required String parent,
  }) {
    final path = parent == '.' ? entry.name : '$parent/${entry.name}';
    return FileTreeNode(
      name: entry.name,
      path: path,
      type: entry.type,
      size: entry.size,
    );
  }

  /// Recursive toggle. Returns a new tree if the target's expansion state
  /// changed, or the same instance when nothing relevant was found.
  Future<FileTreeNode> _toggle(
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
        final listing = await _listForDir(node);
        return node.copyWith(
          children: _buildInitialChildren(
            listing.entries,
            parent: node.path,
          ),
          expanded: true,
          loading: false,
        );
      }
      return node.copyWith(expanded: true);
    }
    var changed = false;
    final newChildren = <FileTreeNode>[];
    for (final child in node.children) {
      final updated = await _toggle(child, path, depth: depth + 1);
      if (!identical(updated, child)) changed = true;
      newChildren.add(updated);
    }
    if (!changed) return node;
    return node.copyWith(children: newChildren);
  }

  Future<FileListing> _listForDir(FileTreeNode dir) async {
    // The bridge expects the path relative to the workspace root (e.g.
    // `src/lib`). The browser uses the *active cwd* as the workspace root,
    // so any nested directory's path is already in that form.
    final response = await _sendRequest('workspace/list', <String, dynamic>{
      'cwd': dir.path,
    });
    final result = response.result;
    if (result is! Map) {
      throw const FormatException('Invalid workspace/list response');
    }
    return FileListing.fromJson(result.cast<String, dynamic>());
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
    final ownStatus = node.isFile ? status[node.path] : null;
    var childrenChanged = false;
    final newChildren = <FileTreeNode>[];
    for (final child in node.children) {
      final updated = _applyGitStatus(child, status);
      if (!identical(updated, child)) childrenChanged = true;
      newChildren.add(updated);
    }
    if (ownStatus == null && !childrenChanged) return node;
    return node.copyWith(
      gitStatus: ownStatus,
      children: childrenChanged ? newChildren : null,
    );
  }

  /// Releases all resources (subjects, caches).
  Future<void> dispose() async {
    for (final subject in _rootSubjects.values) {
      if (!subject.isClosed) await subject.close();
    }
    _rootSubjects.clear();
    _roots.clear();
    _gitStatusByCwd.clear();
    _gitFetched.clear();
    _loadingRoots.clear();
  }
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
