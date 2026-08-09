import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';

/// One working folder, with the conversations that run in it.
class WorkspaceGroup {
  /// Creates a [WorkspaceGroup].
  const WorkspaceGroup({
    required this.key,
    required this.label,
    required this.threads,
  });

  /// The normalized absolute path, and this group's identity.
  final String key;

  /// What to call it: the folder's own name.
  final String label;

  /// Its conversations, in the order the caller supplied them.
  final List<Thread> threads;
}

/// One project, with the working folders found under it.
class ProjectGroup {
  /// Creates a [ProjectGroup].
  const ProjectGroup({
    required this.id,
    required this.name,
    required this.workspaces,
    this.cwd,
  });

  /// Stable identity: a project's bridge id, or [kOtherProjectId].
  final String id;

  /// Display name.
  final String name;

  /// Absolute path; null for [kOtherProjectId], which has no single root.
  final String? cwd;

  /// Its working folders.
  final List<WorkspaceGroup> workspaces;

  /// Every conversation under this project.
  Iterable<Thread> get threads => workspaces.expand((w) => w.threads);
}

/// Id of the catch-all group for work that hangs off no configured root.
const String kOtherProjectId = '__other__';

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

/// Groups [threads] into projects and the working folders under them.
///
/// The hierarchy `uxnandesktop` draws comes from state it owns; the phone has
/// to infer it, and this is the whole inference in one pure function — so it
/// can be tested against the awkward real-world paths, and so the day the
/// bridge learns to report worktrees ([FOR-DEV]) only this changes.
///
/// A thread belongs to the project whose root its `cwd` sits in — the
/// **longest** matching root, so nested roots resolve to the closest one
/// rather than to whichever was listed first.
///
/// Anything else lands in [kOtherProjectId]: a thread with no `cwd`, and — for
/// now — a git **worktree**, which conventionally lives as a sibling of its
/// repository (`…/app` and `…/app--branch`) and so matches no root at all. That
/// is the known gap the `git/worktrees` contract closes.
///
/// A project with no conversations is **not returned**. This is a list of work,
/// not of the bridge's configuration; an empty project is a row that can never
/// tell you anything.
List<ProjectGroup> groupThreadsByWorkspace({
  required List<Thread> threads,
  required List<Project> projects,
}) {
  // Longest root first, so `/a/b` wins over `/a` for a thread inside it.
  final roots = [...projects]..sort(
      (a, b) => normalizeWorkspacePath(b.cwd)
          .length
          .compareTo(normalizeWorkspacePath(a.cwd).length),
    );

  String? projectIdFor(String? cwd) {
    if (cwd == null || cwd.isEmpty) return null;
    final key = normalizeWorkspacePath(cwd);
    for (final project in roots) {
      final root = normalizeWorkspacePath(project.cwd);
      if (key == root || key.startsWith('$root/')) return project.id;
    }
    return null;
  }

  // projectId → workspaceKey → threads, both insertion-ordered so the caller's
  // sort survives all the way to the screen.
  final byProject = <String, Map<String, List<Thread>>>{};
  final labels = <String, String>{};

  for (final thread in threads) {
    final cwd = thread.cwd;
    final projectId = projectIdFor(cwd) ?? kOtherProjectId;
    // A thread with no folder still needs somewhere to live: it gets a
    // workspace of its own keyed by nothing, which the UI renders flat.
    final key = cwd == null || cwd.isEmpty ? '' : normalizeWorkspacePath(cwd);
    labels.putIfAbsent(key, () => key.isEmpty ? '' : workspaceLabel(cwd!));
    ((byProject[projectId] ??= {})[key] ??= []).add(thread);
  }

  final named = {for (final p in projects) p.id: p};
  final groups = <ProjectGroup>[];

  // Configured projects first, in the order the bridge listed them, so the
  // screen's order does not drift with whichever thread synced last.
  for (final project in projects) {
    final workspaces = byProject.remove(project.id);
    if (workspaces == null || workspaces.isEmpty) continue;
    groups.add(
      ProjectGroup(
        id: project.id,
        name: project.name,
        cwd: project.cwd,
        workspaces: [
          for (final entry in workspaces.entries)
            WorkspaceGroup(
              key: entry.key,
              label: labels[entry.key] ?? entry.key,
              threads: entry.value,
            ),
        ],
      ),
    );
  }

  // Then whatever matched no root, last: it is the residue, not the headline.
  final other = byProject.remove(kOtherProjectId);
  if (other != null && other.isNotEmpty) {
    groups.add(
      ProjectGroup(
        id: kOtherProjectId,
        name: '',
        workspaces: [
          for (final entry in other.entries)
            WorkspaceGroup(
              key: entry.key,
              label: labels[entry.key] ?? entry.key,
              threads: entry.value,
            ),
        ],
      ),
    );
  }

  // Anything left is a thread tagged with a project the bridge no longer lists
  // — keep it rather than dropping the conversation off the screen.
  for (final entry in byProject.entries) {
    groups.add(
      ProjectGroup(
        id: entry.key,
        name: named[entry.key]?.name ?? '',
        cwd: named[entry.key]?.cwd,
        workspaces: [
          for (final w in entry.value.entries)
            WorkspaceGroup(
              key: w.key,
              label: labels[w.key] ?? w.key,
              threads: w.value,
            ),
        ],
      ),
    );
  }

  return groups;
}
