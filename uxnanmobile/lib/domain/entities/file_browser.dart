import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';

/// A single entry in a `workspace/list` response (spec 02a §5.8.7).
///
/// Mirrors the bridge's [WorkspaceEntry] JSON shape. The `name` is
/// always the immediate entry basename; use [path] to navigate into it.
class FileEntry extends Equatable {
  /// Creates a [FileEntry].
  const FileEntry({
    required this.name,
    required this.type,
    this.size,
  });

  /// Reconstructs a [FileEntry] from its JSON form. An unknown `type` falls
  /// back to [FileEntryType.file] (matches how the phone treats unknown
  /// entries as files).
  factory FileEntry.fromJson(Map<String, dynamic> json) => FileEntry(
        name: json['name'] as String? ?? '',
        type: _type(json['type'] as String?),
        size: json['size'] is num ? (json['size'] as num).toInt() : null,
      );

  /// Entry's base name (no path).
  final String name;

  /// Whether this entry is a directory or a file.
  final FileEntryType type;

  /// Size in bytes (files only; absent for directories).
  final int? size;

  static FileEntryType _type(String? name) {
    for (final value in FileEntryType.values) {
      if (value.name == name) return value;
    }
    return FileEntryType.file;
  }

  @override
  List<Object?> get props => [name, type, size];
}

/// Whether an entry is a directory or a file.
enum FileEntryType {
  /// A regular file.
  file,

  /// A directory.
  dir,
}

/// A directory listing for a specific path inside the workspace.
///
/// Mirrors the bridge's `WorkspaceListing` JSON shape; the `cwd` is the
/// *workspace-relative* path the listing was fetched for, not an absolute path.
class FileListing extends Equatable {
  /// Creates a [FileListing].
  const FileListing({required this.cwd, required this.entries});

  /// Reconstructs a [FileListing] from its JSON form.
  factory FileListing.fromJson(Map<String, dynamic> json) => FileListing(
        cwd: json['cwd'] as String? ?? '.',
        entries: [
          if (json['entries'] is List)
            for (final e in (json['entries'] as List))
              if (e is Map) FileEntry.fromJson(e.cast<String, dynamic>()),
        ],
      );

  /// Workspace-relative path the listing was fetched for.
  final String cwd;

  /// The entries in this directory (directories first, then files; alphabetic
  /// within each group, matching the bridge's `WorkspaceService.list`).
  final List<FileEntry> entries;

  @override
  List<Object?> get props => [cwd, entries];
}

/// A node in the lazy-loaded file tree displayed in the file browser.
///
/// The browser is intentionally lazy: only directories the user has expanded
/// carry their children. The node is immutable; toggling expansion produces a
/// new tree. [gitStatus] is `null` when the path is not in the current
/// `git/status` (untracked files included — see [GitFileStatus]).
class FileTreeNode extends Equatable {
  /// Creates a [FileTreeNode].
  const FileTreeNode({
    required this.name,
    required this.path,
    required this.type,
    this.size,
    this.children = const [],
    this.expanded = false,
    this.loading = false,
    this.error,
    this.gitStatus,
  });

  /// Whether this node is a directory.
  bool get isDir => type == FileEntryType.dir;

  /// Whether this node is a file.
  bool get isFile => type == FileEntryType.file;

  /// The basename, derived from [path] when missing.
  String get basename {
    if (name.isNotEmpty) return name;
    final i = path.lastIndexOf('/');
    return i < 0 ? path : path.substring(i + 1);
  }

  /// Copy with optional overrides — used when the user toggles expansion or
  /// the manager returns a fetched listing.
  FileTreeNode copyWith({
    List<FileTreeNode>? children,
    bool? expanded,
    bool? loading,
    Object? error = _sentinel,
    GitFileStatus? gitStatus,
  }) =>
      FileTreeNode(
        name: name,
        path: path,
        type: type,
        size: size,
        children: children ?? this.children,
        expanded: expanded ?? this.expanded,
        loading: loading ?? this.loading,
        error: identical(error, _sentinel) ? this.error : error as String?,
        gitStatus: gitStatus ?? this.gitStatus,
      );

  /// Display name for this node — strips the extension when [showExtension]
  /// is false; always keeps the dotfile prefix (`.gitignore`, …).
  String displayName({required bool showExtension}) {
    final base = basename;
    if (showExtension || isDir) return base;
    final dot = base.lastIndexOf('.');
    // Keep dotfiles (`.foo`) intact — the dot is the first character, not a
    // separator inside the name. Also keep names with no extension.
    if (dot <= 0) return base;
    return base.substring(0, dot);
  }

  /// Workspace-relative base name.
  final String name;

  /// Workspace-relative path (`'.'` = the root itself).
  final String path;

  /// Whether this is a file or a directory.
  final FileEntryType type;

  /// File size in bytes (files only).
  final int? size;

  /// Lazily-loaded children (directories only; files always empty).
  final List<FileTreeNode> children;

  /// Whether the user has expanded this directory (drives the `children`
  /// visibility on screen).
  final bool expanded;

  /// True while the manager is fetching the directory's children.
  final bool loading;

  /// Error message from the last failed `workspace/list` for this directory;
  /// `null` when there was no error.
  final String? error;

  /// Per-file git status (only meaningful for files; `null` = no change).
  final GitFileStatus? gitStatus;

  @override
  List<Object?> get props => [
        name,
        path,
        type,
        size,
        children,
        expanded,
        loading,
        error,
        gitStatus,
      ];
}

/// Sentinel for [FileTreeNode.copyWith]: distinguishes "not passed" from
/// "passed null". A typed `Object?` parameter would lose the type at the
/// caller; this singleton keeps `copyWith(error: null)` legal.
const Object _sentinel = Object();

/// Result of a `workspace/readFile` request.
///
/// The bridge returns the file content either as UTF-8 text or as base64
/// (binary / large files). The phone's file browser forwards the encoding
/// bit to the viewer so it can render the right type.
class FileContent extends Equatable {
  /// Creates a [FileContent].
  const FileContent({
    required this.path,
    required this.content,
    required this.encoding,
  });

  /// Reconstructs a [FileContent] from its JSON form.
  factory FileContent.fromJson(Map<String, dynamic> json) => FileContent(
        path: json['path'] as String? ?? '',
        content: json['content'] as String? ?? '',
        encoding: _encoding(json['encoding'] as String?),
      );

  /// Workspace-relative path of the file.
  final String path;

  /// File content. UTF-8 text when [encoding] is [FileEncoding.utf8],
  /// base64-encoded bytes when [encoding] is [FileEncoding.base64].
  final String content;

  /// How [content] should be interpreted.
  final FileEncoding encoding;

  static FileEncoding _encoding(String? name) {
    for (final value in FileEncoding.values) {
      if (value.name == name) return value;
    }
    return FileEncoding.utf8;
  }

  @override
  List<Object?> get props => [path, content, encoding];
}

/// Encoding of a [FileContent.content] payload.
enum FileEncoding {
  /// The content is plain UTF-8 text.
  utf8,

  /// The content is base64-encoded binary bytes (the bridge falls back to
  /// this when the file is detected as non-text or larger than the inline
  /// text budget).
  base64,
}

/// Result of a `workspace/readImage` request.
class ImageFile extends Equatable {
  /// Creates an [ImageFile].
  const ImageFile({
    required this.path,
    required this.base64Data,
    required this.mimeType,
  });

  /// Reconstructs an [ImageFile] from its JSON form.
  factory ImageFile.fromJson(Map<String, dynamic> json) => ImageFile(
        path: json['path'] as String? ?? '',
        base64Data: json['base64Data'] as String? ?? '',
        mimeType: json['mimeType'] as String? ?? 'application/octet-stream',
      );

  /// Workspace-relative path of the image.
  final String path;

  /// Inline base64 payload (no `data:` URI prefix).
  final String base64Data;

  /// MIME type (e.g. `image/png`).
  final String mimeType;

  @override
  List<Object?> get props => [path, base64Data, mimeType];
}
