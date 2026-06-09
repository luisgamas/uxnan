import 'package:equatable/equatable.dart';

/// A configured base directory the phone may browse under (`workspace/browseDirs`).
class BrowseRoot extends Equatable {
  /// Creates a [BrowseRoot].
  const BrowseRoot({required this.id, required this.name, required this.cwd});

  /// Reconstructs a [BrowseRoot] from a JSON map, or null when malformed.
  static BrowseRoot? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'] as String?;
    final cwd = raw['cwd'] as String?;
    if (id == null || cwd == null) return null;
    return BrowseRoot(id: id, name: raw['name'] as String? ?? id, cwd: cwd);
  }

  /// Stable id derived from the absolute path.
  final String id;

  /// Display name (the root's basename).
  final String name;

  /// Absolute path of the root.
  final String cwd;

  @override
  List<Object?> get props => [id, name, cwd];
}

/// A sub-directory under the current browse path.
class BrowseDirEntry extends Equatable {
  /// Creates a [BrowseDirEntry].
  const BrowseDirEntry({
    required this.name,
    required this.path,
    required this.isGitRepo,
  });

  /// Reconstructs a [BrowseDirEntry] from a JSON map, or null when malformed.
  static BrowseDirEntry? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final name = raw['name'] as String?;
    final path = raw['path'] as String?;
    if (name == null || path == null) return null;
    return BrowseDirEntry(
      name: name,
      path: path,
      isGitRepo: raw['isGitRepo'] == true,
    );
  }

  /// Directory basename.
  final String name;

  /// Path relative to the browse root (POSIX separators, e.g. `projects/foo`).
  final String path;

  /// Whether this directory is a git repository.
  final bool isGitRepo;

  @override
  List<Object?> get props => [name, path, isGitRepo];
}

/// Result of browsing one directory under a configured [BrowseRoot]
/// (`workspace/browseDirs`). Parsing is tolerant of partial payloads.
class BrowseResult extends Equatable {
  /// Creates a [BrowseResult].
  const BrowseResult({
    required this.roots,
    required this.rootId,
    required this.path,
    required this.parent,
    required this.cwd,
    required this.isGitRepo,
    required this.dirs,
  });

  /// Reconstructs a [BrowseResult] from a JSON map, or null when malformed.
  static BrowseResult? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final rootId = raw['rootId'] as String?;
    final cwd = raw['cwd'] as String?;
    if (rootId == null || cwd == null) return null;
    final rootsRaw = raw['roots'];
    final dirsRaw = raw['dirs'];
    return BrowseResult(
      roots: [
        if (rootsRaw is List)
          for (final r in rootsRaw)
            if (BrowseRoot.fromJson(r) case final root?) root,
      ],
      rootId: rootId,
      path: raw['path'] as String? ?? '',
      parent: raw['parent'] as String?,
      cwd: cwd,
      isGitRepo: raw['isGitRepo'] == true,
      dirs: [
        if (dirsRaw is List)
          for (final d in dirsRaw)
            if (BrowseDirEntry.fromJson(d) case final dir?) dir,
      ],
    );
  }

  /// All configured roots, for the root picker.
  final List<BrowseRoot> roots;

  /// Id of the root currently being browsed.
  final String rootId;

  /// Current path relative to the root (`''` = the root itself).
  final String path;

  /// Parent path relative to the root, or null at the root.
  final String? parent;

  /// Absolute directory — pass as `thread/start { cwd }` to root an agent here.
  final String cwd;

  /// Whether the current directory is itself a git repository.
  final bool isGitRepo;

  /// Sub-directories the phone may open or descend into.
  final List<BrowseDirEntry> dirs;

  @override
  List<Object?> get props =>
      [roots, rootId, path, parent, cwd, isGitRepo, dirs];
}
