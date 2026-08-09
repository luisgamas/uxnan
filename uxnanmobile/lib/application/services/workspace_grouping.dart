import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';

/// One working folder, with the conversations that run in it.
class WorkspaceGroup {
  /// Creates a [WorkspaceGroup].
  const WorkspaceGroup({
    required this.key,
    required this.label,
    required this.threads,
    this.path,
  });

  /// The normalized absolute path, and this group's identity.
  final String key;

  /// What to call it: the folder's own name.
  final String label;

  /// Its conversations, in the order the caller supplied them.
  final List<Thread> threads;

  /// The path as it was actually reported, for display and copying. The [key]
  /// is folded for matching and is not what a user should ever read.
  final String? path;
}

/// Normalizes a path so two spellings of the same folder are one key.
///
/// Separators are unified and a trailing one dropped; case is folded because
/// Windows — where most bridges run — treats `C:\Dev` and `c:\dev` as the same
/// folder and either spelling can reach us depending on who reported it. The
/// **original** casing is what gets displayed; only the key is folded.
String normalizeWorkspacePath(String path) {
  final unified = path.replaceAll(r'\', '/').replaceAll(RegExp(r'/+$'), '');
  return unified.toLowerCase();
}

/// The folder's own name, for display.
String workspaceLabel(String path) {
  final unified = path.replaceAll(r'\', '/').replaceAll(RegExp(r'/+$'), '');
  final parts = unified.split('/').where((p) => p.isNotEmpty);
  return parts.isEmpty ? path : parts.last;
}

/// Groups [threads] by the folder they run in.
///
/// One level, not two. `uxnandesktop` shows repositories over their worktrees
/// because it KNOWS which is which; the phone does not — the bridge reports a
/// flat list of configured roots and nothing about worktrees, which live as
/// siblings of their repository. A "project" level built on that knowledge
/// would have been a folder heading one folder, plus a bucket named "other"
/// holding most of the real work. So the folder is the top of the tree until
/// the bridge can say more (`git/worktrees`), at which point a project level
/// can come back meaning what it does on the desktop.
///
/// [projects] is still used, for naming only: a folder that IS a configured
/// root takes the project's name, which is usually friendlier than its
/// basename.
///
/// Paths are matched and de-duplicated after normalising separators and case,
/// so `C:\Dev\App` and `c:/dev/app/` are one folder however they reached us.
/// Thread order inside a folder is the caller's — the screen sorts first.
List<WorkspaceGroup> groupThreadsByWorkspace({
  required List<Thread> threads,
  required List<Project> projects,
}) {
  final names = {
    for (final project in projects)
      normalizeWorkspacePath(project.cwd): project.name,
  };

  final byKey = <String, List<Thread>>{};
  final labels = <String, String>{};
  final pathsOf = <String, Set<String>>{};
  for (final thread in threads) {
    final cwd = thread.cwd;
    final key = cwd == null || cwd.isEmpty ? '' : normalizeWorkspacePath(cwd);
    final paths = pathsOf[key] ??= <String>{};
    if (cwd != null && cwd.isNotEmpty) paths.add(cwd);
    labels.putIfAbsent(
      key,
      () => key.isEmpty ? '' : (names[key] ?? workspaceLabel(cwd!)),
    );
    (byKey[key] ??= []).add(thread);
  }

  return [
    for (final entry in byKey.entries)
      WorkspaceGroup(
        key: entry.key,
        label: labels[entry.key] ?? entry.key,
        // A thread with no folder has no path to show — reading one would
        // throw, which is what a test caught here.
        path: switch (pathsOf[entry.key]) {
          final paths? when paths.isNotEmpty => paths.first,
          _ => null,
        },
        threads: entry.value,
      ),
  ];
}
