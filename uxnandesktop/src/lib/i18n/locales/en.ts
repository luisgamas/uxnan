// English — the source-of-truth locale. Every other locale mirrors these keys
// (typed as `Record<MessageKey, string>`, so a missing key fails to compile).
// Placeholders use `{name}` and are filled by `i18n.t(key, { name })`.
//
// To add a language, copy this file to `<code>.ts`, translate the values, and
// register it in `../index.svelte.ts`. See docs/i18n.md.

export const en = {
  // Common
  "common.cancel": "Cancel",
  "common.remove": "Remove",
  "common.add": "Add",
  "common.create": "Create",
  "common.new": "New",
  "common.more": "More",
  "common.close": "Close",
  "common.dismiss": "Dismiss",
  "common.copyPath": "Copy path",
  "common.removing": "Removing…",
  "common.adding": "Adding…",
  "common.creating": "Creating…",
  "common.loading": "Loading…",

  // Left sidebar
  "sidebar.search": "Search projects & worktrees…",
  "sidebar.projects": "Projects",
  "sidebar.addProject": "Add project…",
  "sidebar.refresh": "Refresh worktrees & status",
  "sidebar.sort": "Sort",
  "sidebar.sortBy": "Sort by",
  "sidebar.sortManual": "Default",
  "sidebar.sortNameAsc": "Name (A–Z)",
  "sidebar.sortNameDesc": "Name (Z–A)",
  "sidebar.noMatch": "No projects match your search.",
  "sidebar.empty": "No projects yet.",
  "sidebar.addRepo": "Add a git repository",

  // Project card
  "project.expand": "Expand",
  "project.collapse": "Collapse",
  "project.workIn": "Work in {name} (main)",
  "project.openTerminal": "Open a terminal in {name} (main)",
  "project.newWorktree": "New worktree…",
  "project.removeProject": "Remove project",
  "project.removeTitle": "Remove project?",
  "project.removeDesc":
    "“{name}” will be removed from the ADE. The repository on disk is not touched.",
  "project.noWorktrees": "No worktrees",
  "project.worktreeOne": "{n} worktree",
  "project.worktreeOther": "{n} worktrees",
  "project.dirtyTooltip": "{n} uncommitted change(s) on main",
  "project.runningTooltip": "{n} terminal(s) running",

  // Worktree row
  "worktree.openTerminal": "Open a terminal here",
  "worktree.removeWorktree": "Remove worktree",
  "worktree.removeTitle": "Remove worktree?",
  "worktree.removeDesc":
    "Removes the worktree at {path}. Its branch “{branch}” is safe-deleted only if fully merged.",
  "worktree.forceRemove": "Force remove",
  "worktree.detached": "(detached)",
  "worktree.dirtyTooltip": "{n} uncommitted change(s)",
  "worktree.aheadTooltip": "ahead of upstream",
  "worktree.behindTooltip": "behind upstream",
  "worktree.runningTooltip": "{n} terminal(s) running",

  // New-worktree dialog
  "newWorktree.title": "New worktree",
  "newWorktree.desc": "Create a worktree on a new branch in {name}.",
  "newWorktree.branch": "Branch name",
  "newWorktree.branchPlaceholder": "feature/login",
  "newWorktree.base": "Base branch",
  "newWorktree.selectBase": "Select base branch…",
  "newWorktree.baseDesc":
    "The new branch starts from here. Defaults to the repo's main branch.",
  "newWorktree.create": "Create worktree",
  "newWorktree.preview": "Worktree folder",

  // Terminal area
  "terminal.newDefault": "New terminal (default profile)",
  "terminal.terminal": "Terminal",
  "terminal.chooseProfile": "Choose a terminal profile",
  "terminal.newTerminal": "New terminal",
  "terminal.unnamedProfile": "Unnamed profile",
  "terminal.context":
    "Active terminal context — choose a project or worktree in the left panel",
  "terminal.toggleRight": "Toggle right panel",
  "terminal.general": "General",
  "terminal.noTerminalsIn": "No terminals in {context}",
  "terminal.newInRegion": "New terminal in this region",
  "terminal.copy": "Copy",
  "terminal.paste": "Paste",
  "terminal.splitRight": "Split right",
  "terminal.splitDown": "Split down",
  "terminal.closeTerminal": "Close terminal",

  // Directory picker
  "picker.title": "Add project",
  "picker.desc":
    "Browse to a git repository and add it. Folders tagged “repo” are git repositories.",
  "picker.pathPlaceholder": "Type or paste a path, then Enter…",
  "picker.parent": "Parent folder",
  "picker.empty": "No sub-folders here.",
  "picker.open": "Open {name}",
  "picker.addFolder": "Add this folder",
  "picker.repoBadge": "repo",

  // Settings
  "settings.title": "Settings",
  "settings.general": "General",
  "settings.terminal": "Terminal",
  "settings.language": "Language",
  "settings.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.language.system": "System default",
  "settings.language.desc":
    "Interface language. Contributions for new languages are welcome — see docs/i18n.md.",

  // Title bar
  "titlebar.toggleLeft": "Toggle left sidebar",
  "titlebar.alphaTooltip": "Alpha — work in progress",
  "titlebar.settings": "Settings",
  "titlebar.minimize": "Minimize",
  "titlebar.maximize": "Maximize",
  "titlebar.close": "Close",

  // Right panel (changes / review)
  "rightPanel.changes": "Changes",
  "rightPanel.selectWorktree": "Select a project or worktree to see its changes.",
  "rightPanel.refresh": "Refresh changes",
  "rightPanel.staged": "Staged",
  "rightPanel.noChanges": "No changes.",
  "rightPanel.stageAll": "Stage all",
  "rightPanel.unstageAll": "Unstage all",
  "rightPanel.stage": "Stage",
  "rightPanel.unstage": "Unstage",
  "rightPanel.discard": "Discard changes",
  "rightPanel.discardTitle": "Discard changes?",
  "rightPanel.discardDesc":
    "Discard local changes to “{file}”? This cannot be undone.",
  "rightPanel.untracked": "Untracked",
  "rightPanel.commitPlaceholder": "Commit message",
  "rightPanel.commit": "Commit",
  "rightPanel.committing": "Committing…",
  "rightPanel.diffEmpty": "Nothing to show for this file.",
  "rightPanel.diffStaged": "Staged",
  "rightPanel.diffUnstaged": "Working tree",
  "rightPanel.push": "Push",
  "rightPanel.pull": "Pull",

  // Status bar
  "status.connected": "Backend connected",
  "status.connecting": "Connecting…",
  "status.unreachable": "Backend unreachable",
  "status.reposOne": "{n} repository",
  "status.reposOther": "{n} repositories",

  // Terminal tab state
  "terminal.exited": "exited",

  // Settings — terminal section
  "settings.defaultProfile": "Default profile",
  "settings.defaultProfileDesc":
    "Used for new terminals unless you pick another from the “+” menu.",
  "settings.profiles": "Profiles",
  "settings.addProfile": "Add profile",
  "settings.addDetectedShells": "Add detected shells",
  "settings.blankProfile": "Blank profile",
  "settings.noProfiles":
    "No profiles. Add one to choose how terminals are launched.",

  // Terminal profile editor
  "profileEditor.namePlaceholder": "Profile name (e.g. WSL: Ubuntu)",
  "profileEditor.removeProfile": "Remove profile",
  "profileEditor.commandPlaceholder": "command (e.g. wsl.exe)",
  "profileEditor.argsPlaceholder": "arguments (space-separated)",

  // Settings — agents section
  "settings.agents": "Agents",
  "settings.agentsDesc":
    "CLI coding agents you can launch into any worktree — each runs inside its chosen terminal in that worktree's checkout.",
  "settings.agentsAvailable": "Available agents",
  "settings.addAllInstalled": "Add all installed",
  "settings.agentAdded": "added",
  "settings.agentNotFound": "not found",
  "settings.detecting": "Checking which agents are installed…",
  "settings.yourAgents": "Your agents",
  "settings.addCustomAgent": "Add custom agent",
  "settings.noAgents": "No agents yet. Add one above to launch it into any worktree.",
  "settings.defaultAgent": "Default agent",
  "settings.defaultAgentNone": "None",
  "settings.defaultAgentDesc":
    "Auto-launched in a worktree right after you create it. Leave on “None” to never start an agent automatically.",

  // Agent profile editor
  "agentEditor.namePlaceholder": "Agent name (e.g. Claude Code)",
  "agentEditor.removeAgent": "Remove agent",
  "agentEditor.commandPlaceholder": "command (e.g. claude)",
  "agentEditor.argsPlaceholder": "arguments (space-separated)",
  "agentEditor.launchIn": "Launch in",
  "agentEditor.defaultTerminal": "Default terminal",

  // Launch agent (sidebar)
  "agent.launch": "Launch agent",
  "agent.launchIn": "Launch an agent in {name}",
  "agent.none": "No agents configured",
  "agent.configure": "Configure agents…",
} as const;

/** Union of every message key (drives `t()` and the locale type). */
export type MessageKey = keyof typeof en;
