import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/value_objects/git/git_worktree_entry.dart';

/// One working folder, with the conversations that run in it.
class WorkspaceGroup {
  /// Creates a [WorkspaceGroup].
  const WorkspaceGroup({
    required this.key,
    required this.label,
    required this.threads,
    this.path,
    this.repoKey,
    this.repoLabel,
    this.branch,
    this.isMain = false,
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

  /// The normalized path of the repository's MAIN worktree, when the bridge
  /// told us — `git/worktrees`, never a path prefix, because worktrees are
  /// siblings and a prefix would be a guess dressed as a fact.
  ///
  /// Null on an older bridge, and null for a folder that is not in a
  /// repository. Both mean the same thing to the UI: this folder stands alone.
  final String? repoKey;

  /// What to call that repository.
  final String? repoLabel;

  /// The branch checked out here, when this folder is a worktree git named.
  final String? branch;

  /// Whether this folder is its repository's main worktree.
  final bool isMain;
}

/// A repository and the worktrees of it that hold conversations.
///
/// Only ever built when the relationship is **real and worth drawing**: two or
/// more folders proven by `git/worktrees` to belong to one repository. A repo
/// with a single folder is returned as a plain [WorkspaceGroup], because a
/// heading over one row is not structure — it is an extra tap and a line of
/// chrome, which is exactly what the first attempt at this got wrong.
class RepoGroup {
  /// Creates a [RepoGroup].
  const RepoGroup({
    required this.key,
    required this.label,
    required this.workspaces,
  });

  /// Normalized path of the repository's main worktree.
  final String key;

  /// What to call it.
  final String label;

  /// Its folders, main worktree first when it is among them.
  final List<WorkspaceGroup> workspaces;
}

/// One row of the folder list: either a lone folder, or a repository with the
/// worktrees under it.
sealed class WorkspaceTreeNode {
  const WorkspaceTreeNode();
}

/// A folder that belongs to no drawable repository group.
class LoneWorkspace extends WorkspaceTreeNode {
  /// Creates a [LoneWorkspace].
  const LoneWorkspace(this.workspace);

  /// The folder.
  final WorkspaceGroup workspace;
}

/// A repository with two or more of its worktrees.
class RepoWithWorktrees extends WorkspaceTreeNode {
  /// Creates a [RepoWithWorktrees].
  const RepoWithWorktrees(this.repo);

  /// The repository and its folders.
  final RepoGroup repo;
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
  Map<String, WorkspaceRepo> repos = const {},
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
        repoKey: repos[entry.key]?.key,
        repoLabel: repos[entry.key]?.label,
        branch: repos[entry.key]?.branch,
        isMain: repos[entry.key]?.isMain ?? false,
        threads: entry.value,
      ),
  ];
}

/// The identity of the repository whose main worktree is at [mainPath].
///
/// **Namespaced, and that is the whole point.** A repository is identified by
/// its main worktree's path — which is also, exactly, the identity of the
/// folder for that worktree. Collapse state is a set of these strings, so
/// sharing one meant collapsing the main folder collapsed the entire project
/// and vice versa: you could not keep a project open with its folders shut.
/// The prefix makes "the repo at X" and "the folder at X" two different
/// things, because on screen they are two different rows.
String repoKeyFor(String mainPath) =>
    'repo:${normalizeWorkspacePath(mainPath)}';

/// Which repository a folder belongs to, as reported by `git/worktrees`.
class WorkspaceRepo {
  /// Creates a [WorkspaceRepo].
  const WorkspaceRepo({
    required this.key,
    required this.label,
    this.branch,
    this.isMain = false,
  });

  /// The repository's identity — see [repoKeyFor].
  final String key;

  /// What to call the repository.
  final String label;

  /// The branch checked out in **this** folder, when git named one.
  ///
  /// Per folder rather than per repository, because the table is keyed by
  /// folder: that is the whole reason a worktree is worth showing separately.
  /// Null on a detached HEAD.
  final String? branch;

  /// Whether **this** folder is the repository's main worktree.
  final bool isMain;
}

/// Builds the folder-to-repository table from `git/worktrees` replies.
///
/// [replies] maps the folder that was ASKED to the worktree list it returned.
/// Every entry of a reply belongs to the repository whose main worktree that
/// reply names, so one call teaches us about every sibling at once — which is
/// why the caller asks once per configured root rather than once per folder.
Map<String, WorkspaceRepo> buildWorkspaceRepoTable(
  Map<String, List<GitWorktreeEntry>> replies,
) {
  final table = <String, WorkspaceRepo>{};
  for (final entries in replies.values) {
    if (entries.length < 2) continue; // nothing to relate
    final main = entries.firstWhere(
      (e) => e.isMain,
      orElse: () => entries.first,
    );
    if (main.path.isEmpty) continue;
    final key = repoKeyFor(main.path);
    final label = workspaceLabel(main.path);
    for (final entry in entries) {
      if (entry.path.isEmpty) continue;
      // The branch and the main flag come from the SAME reply that proves the
      // relationship — they were being discarded, which is why a worktree row
      // said less here than the identical row on the desktop.
      table[normalizeWorkspacePath(entry.path)] = WorkspaceRepo(
        key: key,
        label: label,
        branch: entry.branch,
        isMain: entry.isMain,
      );
    }
  }
  return table;
}

/// Arranges [groups] into the list the screen draws: a repository with two or
/// more of its folders becomes one node; everything else stays a lone folder.
///
/// The threshold is the whole point. The first attempt at a project level drew
/// a heading over a SINGLE folder plus a bucket named "other" holding most of
/// the real work, and it earned its removal. A group appears here only when it
/// relates folders that genuinely belong together, and a folder that relates
/// to nothing is never swept into a bucket — it simply stays where it is.
List<WorkspaceTreeNode> buildWorkspaceTree(
  List<WorkspaceGroup> groups, {
  int Function(WorkspaceGroup, WorkspaceGroup)? orderWorkspaces,
}) {
  final byRepo = <String, List<WorkspaceGroup>>{};
  final lone = <WorkspaceGroup>[];
  for (final group in groups) {
    final repo = group.repoKey;
    if (repo == null) {
      lone.add(group);
    } else {
      (byRepo[repo] ??= []).add(group);
    }
  }

  final nodes = <WorkspaceTreeNode>[];
  for (final entry in byRepo.entries) {
    final members = entry.value;
    if (members.length < 2) {
      // Proven to be in a repository, but the only folder of it we can see.
      // A heading over one row is chrome, not structure.
      lone.addAll(members);
      continue;
    }
    // Ordered like every other level — the folders inside a project were the
    // one list the sort menu could not reach, because this sorted them itself.
    // Without a comparator the main worktree still leads: it is the one a
    // person thinks of as "the repo".
    if (orderWorkspaces != null) {
      members.sort(orderWorkspaces);
    } else {
      members.sort((a, b) {
        // Compared THROUGH the namespace: the group's key is `repo:<path>`
        // now, so a bare workspace key can never equal it and every worktree
        // would look non-main.
        final aMain = repoKeyFor(a.key) == entry.key ? 0 : 1;
        final bMain = repoKeyFor(b.key) == entry.key ? 0 : 1;
        return aMain != bMain ? aMain - bMain : a.label.compareTo(b.label);
      });
    }
    nodes.add(
      RepoWithWorktrees(
        RepoGroup(
          key: entry.key,
          label: members.first.repoLabel ?? members.first.label,
          workspaces: members,
        ),
      ),
    );
  }
  nodes.addAll(lone.map(LoneWorkspace.new));
  return nodes;
}
