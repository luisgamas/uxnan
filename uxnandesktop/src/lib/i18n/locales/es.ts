// Spanish (Español). Mirrors every key in `en.ts` (enforced by the type).

import type { MessageKey } from "./en";

export const es: Record<MessageKey, string> = {
  // Common
  "common.cancel": "Cancelar",
  "common.remove": "Eliminar",
  "common.add": "Agregar",
  "common.create": "Crear",
  "common.new": "Nuevo",
  "common.more": "Más",
  "common.close": "Cerrar",
  "common.copyPath": "Copiar ruta",
  "common.removing": "Eliminando…",
  "common.adding": "Agregando…",
  "common.creating": "Creando…",
  "common.loading": "Cargando…",

  // Left sidebar
  "sidebar.search": "Buscar proyectos y worktrees…",
  "sidebar.projects": "Proyectos",
  "sidebar.addProject": "Agregar proyecto…",
  "sidebar.refresh": "Actualizar worktrees y estado",
  "sidebar.sort": "Ordenar",
  "sidebar.sortBy": "Ordenar por",
  "sidebar.sortManual": "Predeterminado",
  "sidebar.sortNameAsc": "Nombre (A–Z)",
  "sidebar.sortNameDesc": "Nombre (Z–A)",
  "sidebar.noMatch": "Ningún proyecto coincide con tu búsqueda.",
  "sidebar.empty": "Aún no hay proyectos.",
  "sidebar.addRepo": "Agregar un repositorio git",

  // Project card
  "project.expand": "Expandir",
  "project.collapse": "Contraer",
  "project.workIn": "Trabajar en {name} (main)",
  "project.openTerminal": "Abrir una terminal en {name} (main)",
  "project.newWorktree": "Nuevo worktree…",
  "project.removeProject": "Eliminar proyecto",
  "project.removeTitle": "¿Eliminar proyecto?",
  "project.removeDesc":
    "“{name}” se quitará del ADE. El repositorio en disco no se modifica.",
  "project.noWorktrees": "Sin worktrees",
  "project.worktreeOne": "{n} worktree",
  "project.worktreeOther": "{n} worktrees",
  "project.dirtyTooltip": "{n} cambio(s) sin commitear en main",
  "project.runningTooltip": "{n} terminal(es) activa(s)",

  // Worktree row
  "worktree.openTerminal": "Abrir una terminal aquí",
  "worktree.removeWorktree": "Eliminar worktree",
  "worktree.removeTitle": "¿Eliminar worktree?",
  "worktree.removeDesc":
    "Elimina el worktree en {path}. Su rama “{branch}” solo se borra de forma segura si está totalmente fusionada.",
  "worktree.forceRemove": "Forzar eliminación",
  "worktree.detached": "(desacoplado)",
  "worktree.dirtyTooltip": "{n} cambio(s) sin commitear",
  "worktree.aheadTooltip": "adelante del upstream",
  "worktree.behindTooltip": "atrás del upstream",
  "worktree.runningTooltip": "{n} terminal(es) activa(s)",

  // New-worktree dialog
  "newWorktree.title": "Nuevo worktree",
  "newWorktree.desc": "Crea un worktree en una rama nueva en {name}.",
  "newWorktree.branch": "Nombre de la rama",
  "newWorktree.branchPlaceholder": "feature/login",
  "newWorktree.base": "Rama base",
  "newWorktree.selectBase": "Elegir rama base…",
  "newWorktree.baseDesc":
    "La rama nueva parte de aquí. Por defecto, la rama principal del repo.",
  "newWorktree.create": "Crear worktree",
  "newWorktree.preview": "Carpeta del worktree",

  // Terminal area
  "terminal.newDefault": "Nueva terminal (perfil predeterminado)",
  "terminal.terminal": "Terminal",
  "terminal.chooseProfile": "Elegir un perfil de terminal",
  "terminal.newTerminal": "Nueva terminal",
  "terminal.unnamedProfile": "Perfil sin nombre",
  "terminal.context":
    "Contexto de terminal activo — elige un proyecto o worktree en el panel izquierdo",
  "terminal.toggleRight": "Mostrar/ocultar panel derecho",
  "terminal.general": "General",
  "terminal.noTerminalsIn": "Sin terminales en {context}",
  "terminal.newInRegion": "Nueva terminal en esta región",
  "terminal.copy": "Copiar",
  "terminal.paste": "Pegar",
  "terminal.splitRight": "Dividir a la derecha",
  "terminal.splitDown": "Dividir abajo",
  "terminal.closeTerminal": "Cerrar terminal",

  // Directory picker
  "picker.title": "Agregar proyecto",
  "picker.desc":
    "Navega hasta un repositorio git y agrégalo. Las carpetas con la etiqueta “repo” son repositorios git.",
  "picker.pathPlaceholder": "Escribe o pega una ruta y presiona Enter…",
  "picker.parent": "Carpeta superior",
  "picker.empty": "No hay subcarpetas aquí.",
  "picker.open": "Abrir {name}",
  "picker.addFolder": "Agregar esta carpeta",
  "picker.repoBadge": "repo",

  // Settings
  "settings.title": "Configuración",
  "settings.general": "General",
  "settings.terminal": "Terminal",
  "settings.language": "Idioma",
  "settings.theme": "Tema",
  "settings.theme.system": "Sistema",
  "settings.theme.light": "Claro",
  "settings.theme.dark": "Oscuro",
  "settings.language.system": "Predeterminado del sistema",
  "settings.language.desc":
    "Idioma de la interfaz. Las contribuciones de nuevos idiomas son bienvenidas — ver docs/i18n.md.",

  // Title bar
  "titlebar.toggleLeft": "Mostrar/ocultar panel izquierdo",
  "titlebar.alphaTooltip": "Alpha — en desarrollo",
  "titlebar.settings": "Configuración",
  "titlebar.minimize": "Minimizar",
  "titlebar.maximize": "Maximizar",
  "titlebar.close": "Cerrar",

  // Right panel (changes / review)
  "rightPanel.changes": "Cambios",
  "rightPanel.selectWorktree": "Selecciona un proyecto o worktree para ver sus cambios.",
  "rightPanel.refresh": "Actualizar cambios",
  "rightPanel.staged": "Preparados",
  "rightPanel.noChanges": "Sin cambios.",
  "rightPanel.stageAll": "Preparar todo",
  "rightPanel.unstageAll": "Quitar todo",
  "rightPanel.stage": "Preparar",
  "rightPanel.unstage": "Quitar",
  "rightPanel.discard": "Descartar cambios",
  "rightPanel.discardTitle": "¿Descartar cambios?",
  "rightPanel.discardDesc":
    "¿Descartar los cambios locales de “{file}”? Esto no se puede deshacer.",
  "rightPanel.untracked": "Sin seguimiento",
  "rightPanel.commitPlaceholder": "Mensaje del commit",
  "rightPanel.commit": "Confirmar",
  "rightPanel.committing": "Confirmando…",
  "rightPanel.diffEmpty": "No hay nada que mostrar para este archivo.",
  "rightPanel.diffStaged": "Preparado",
  "rightPanel.diffUnstaged": "Árbol de trabajo",

  // Status bar
  "status.connected": "Backend conectado",
  "status.connecting": "Conectando…",
  "status.unreachable": "Backend inalcanzable",
  "status.reposOne": "{n} repositorio",
  "status.reposOther": "{n} repositorios",

  // Terminal tab state
  "terminal.exited": "finalizada",

  // Settings — terminal section
  "settings.defaultProfile": "Perfil predeterminado",
  "settings.defaultProfileDesc":
    "Se usa para nuevas terminales salvo que elijas otro desde el menú “+”.",
  "settings.profiles": "Perfiles",
  "settings.addProfile": "Agregar perfil",
  "settings.blankProfile": "Perfil en blanco",
  "settings.noProfiles":
    "Sin perfiles. Agrega uno para elegir cómo se lanzan las terminales.",

  // Terminal profile editor
  "profileEditor.namePlaceholder": "Nombre del perfil (p. ej. WSL: Ubuntu)",
  "profileEditor.removeProfile": "Eliminar perfil",
  "profileEditor.commandPlaceholder": "comando (p. ej. wsl.exe)",
  "profileEditor.argsPlaceholder": "argumentos (separados por espacios)",

  // Settings — agents section
  "settings.agents": "Agentes",
  "settings.agentsDesc":
    "Agentes de CLI que puedes lanzar en cualquier worktree — cada uno corre en la terminal que elijas, dentro del checkout de ese worktree.",
  "settings.agentsAvailable": "Agentes disponibles",
  "settings.addAllInstalled": "Agregar los instalados",
  "settings.agentAdded": "agregado",
  "settings.agentNotFound": "no encontrado",
  "settings.detecting": "Verificando qué agentes están instalados…",
  "settings.yourAgents": "Tus agentes",
  "settings.addCustomAgent": "Agregar agente personalizado",
  "settings.noAgents":
    "Aún no hay agentes. Agrega uno arriba para lanzarlo en cualquier worktree.",

  // Agent profile editor
  "agentEditor.namePlaceholder": "Nombre del agente (p. ej. Claude Code)",
  "agentEditor.removeAgent": "Eliminar agente",
  "agentEditor.commandPlaceholder": "comando (p. ej. claude)",
  "agentEditor.argsPlaceholder": "argumentos (separados por espacios)",
  "agentEditor.launchIn": "Lanzar en",
  "agentEditor.defaultTerminal": "Terminal predeterminada",

  // Launch agent (sidebar)
  "agent.launch": "Lanzar agente",
  "agent.launchIn": "Lanzar un agente en {name}",
  "agent.none": "Sin agentes configurados",
  "agent.configure": "Configurar agentes…",
};
