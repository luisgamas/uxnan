//! "Open with" — detect installed external editors/IDEs and launch a path in
//! one. Powers the `Open with →` submenus on the project cards, worktree rows and
//! file-tree entries (`RowActionsMenu`, `ProjectCard`, `FileTreeContextMenu`,
//! `FileTreePanel`).
//!
//! Detection is best-effort and needs **no config files**: first a `PATH` probe
//! (via [`crate::which`]) for the editor's CLI, then — since most GUI editors
//! install without putting their CLI on `PATH` — a per-OS scan of where the app
//! actually lands (Windows: known `Program Files` / per-user install paths;
//! macOS: `/Applications` + `~/Applications` `.app` bundles). Anything not found
//! that way can still be added by the user (a browse-for-app in Settings).
//!
//! Launching goes through the OS with **no console flash**: on Windows a native
//! `.exe` (a found install path, or a bare `notepad.exe`) is spawned directly and
//! windowless, while a bare CLI name (an npm-style `.cmd`/`.bat` shim like VS
//! Code's `code.cmd`) runs under a windowless `cmd /C`; elsewhere the command is
//! spawned directly (a macOS app launches via `open -a <App> <path>`). Custom
//! editors reuse the exact same launch path with their own command + args.

use serde::Serialize;

use crate::which;

/// One detected external editor available on this machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEditor {
    /// Stable catalog id (e.g. `vscode`), so the UI can persist a "hidden" set.
    pub id: String,
    /// Human-readable name shown in the menu.
    pub name: String,
    /// The command used to launch it: a `PATH` CLI name, an absolute `.exe` path,
    /// or `open` (macOS, with the app in `args`).
    pub command: String,
    /// Fixed leading arguments (e.g. macOS `["-a", "<App>.app"]`); the target path
    /// is appended after these at launch.
    #[serde(default)]
    pub args: Vec<String>,
}

/// A native, always-available text editor for plain-text files (Notepad / TextEdit
/// / a detected Linux text editor).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEditor {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// One editor's detection recipe: its `PATH` CLI candidates and where the app
/// installs per-OS. Fields are used behind `#[cfg]`, so some are dead on a given
/// platform — that's fine.
#[allow(dead_code)]
struct EditorDef {
    id: &'static str,
    name: &'static str,
    /// `PATH` CLI candidates (first that resolves wins).
    commands: &'static [&'static str],
    /// Windows install-path candidates for the app `.exe` (with `%ENV%` vars).
    win_paths: &'static [&'static str],
    /// macOS `.app` bundle names (looked up in `/Applications` + `~/Applications`).
    mac_apps: &'static [&'static str],
}

/// Known GUI editor / IDE catalog. Terminal editors (vim/emacs/…) are excluded:
/// "Open with" opens a folder/file in a windowed editor, and launching a TUI
/// editor detached has nowhere to draw.
const CATALOG: &[EditorDef] = &[
    EditorDef {
        id: "vscode",
        name: "Visual Studio Code",
        commands: &["code"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe",
            r"%ProgramFiles%\Microsoft VS Code\Code.exe",
        ],
        mac_apps: &["Visual Studio Code"],
    },
    EditorDef {
        id: "vscode-insiders",
        name: "VS Code Insiders",
        commands: &["code-insiders"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\Microsoft VS Code Insiders\Code - Insiders.exe",
            r"%ProgramFiles%\Microsoft VS Code Insiders\Code - Insiders.exe",
        ],
        mac_apps: &["Visual Studio Code - Insiders"],
    },
    EditorDef {
        id: "vscodium",
        name: "VSCodium",
        commands: &["codium"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\VSCodium\VSCodium.exe",
            r"%ProgramFiles%\VSCodium\VSCodium.exe",
        ],
        mac_apps: &["VSCodium"],
    },
    EditorDef {
        id: "cursor",
        name: "Cursor",
        commands: &["cursor"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\cursor\Cursor.exe",
            r"%LOCALAPPDATA%\Programs\Cursor\Cursor.exe",
        ],
        mac_apps: &["Cursor"],
    },
    EditorDef {
        id: "windsurf",
        name: "Windsurf",
        commands: &["windsurf"],
        win_paths: &[r"%LOCALAPPDATA%\Programs\Windsurf\Windsurf.exe"],
        mac_apps: &["Windsurf"],
    },
    EditorDef {
        id: "zed",
        name: "Zed",
        commands: &["zed", "zeditor"],
        win_paths: &[r"%LOCALAPPDATA%\Programs\Zed\Zed.exe"],
        mac_apps: &["Zed"],
    },
    EditorDef {
        id: "sublime",
        name: "Sublime Text",
        commands: &["subl"],
        win_paths: &[
            r"%ProgramFiles%\Sublime Text\sublime_text.exe",
            r"%ProgramFiles%\Sublime Text 3\sublime_text.exe",
        ],
        mac_apps: &["Sublime Text"],
    },
    EditorDef {
        id: "fleet",
        name: "Fleet",
        commands: &["fleet"],
        win_paths: &[],
        mac_apps: &["Fleet"],
    },
    EditorDef {
        id: "intellij",
        name: "IntelliJ IDEA",
        commands: &["idea"],
        win_paths: &[],
        mac_apps: &[
            "IntelliJ IDEA",
            "IntelliJ IDEA Ultimate",
            "IntelliJ IDEA CE",
        ],
    },
    EditorDef {
        id: "pycharm",
        name: "PyCharm",
        commands: &["pycharm"],
        win_paths: &[],
        mac_apps: &["PyCharm", "PyCharm Professional", "PyCharm CE"],
    },
    EditorDef {
        id: "webstorm",
        name: "WebStorm",
        commands: &["webstorm"],
        win_paths: &[],
        mac_apps: &["WebStorm"],
    },
    EditorDef {
        id: "phpstorm",
        name: "PhpStorm",
        commands: &["phpstorm"],
        win_paths: &[],
        mac_apps: &["PhpStorm"],
    },
    EditorDef {
        id: "rubymine",
        name: "RubyMine",
        commands: &["rubymine"],
        win_paths: &[],
        mac_apps: &["RubyMine"],
    },
    EditorDef {
        id: "goland",
        name: "GoLand",
        commands: &["goland"],
        win_paths: &[],
        mac_apps: &["GoLand"],
    },
    EditorDef {
        id: "clion",
        name: "CLion",
        commands: &["clion"],
        win_paths: &[],
        mac_apps: &["CLion"],
    },
    EditorDef {
        id: "rider",
        name: "Rider",
        commands: &["rider"],
        win_paths: &[],
        mac_apps: &["Rider"],
    },
    EditorDef {
        id: "rustrover",
        name: "RustRover",
        commands: &["rustrover"],
        win_paths: &[],
        mac_apps: &["RustRover"],
    },
    EditorDef {
        id: "datagrip",
        name: "DataGrip",
        commands: &["datagrip"],
        win_paths: &[],
        mac_apps: &["DataGrip"],
    },
    EditorDef {
        id: "android-studio",
        name: "Android Studio",
        commands: &["studio"],
        win_paths: &[r"%ProgramFiles%\Android\Android Studio\bin\studio64.exe"],
        mac_apps: &["Android Studio"],
    },
    EditorDef {
        id: "nova",
        name: "Nova",
        commands: &["nova"],
        win_paths: &[],
        mac_apps: &["Nova"],
    },
];

/// The subset of the catalog present on this machine, each with a launch command.
pub fn detect() -> Vec<DetectedEditor> {
    CATALOG.iter().filter_map(detect_one).collect()
}

/// Detect a single editor: its CLI on `PATH` first, else the app's install
/// location for this OS. `None` when it isn't installed (findable).
fn detect_one(def: &EditorDef) -> Option<DetectedEditor> {
    if let Some(cmd) = def.commands.iter().find(|c| which::is_command_available(c)) {
        return Some(DetectedEditor {
            id: def.id.to_string(),
            name: def.name.to_string(),
            command: (*cmd).to_string(),
            args: Vec::new(),
        });
    }
    #[cfg(windows)]
    for p in def.win_paths {
        let expanded = expand_windows_env(p);
        if std::path::Path::new(&expanded).is_file() {
            return Some(DetectedEditor {
                id: def.id.to_string(),
                name: def.name.to_string(),
                command: expanded,
                args: Vec::new(),
            });
        }
    }
    #[cfg(target_os = "macos")]
    for app in def.mac_apps {
        if let Some(app_path) = mac_app_path(app) {
            return Some(DetectedEditor {
                id: def.id.to_string(),
                name: def.name.to_string(),
                command: "open".to_string(),
                args: vec!["-a".to_string(), app_path],
            });
        }
    }
    None
}

/// The platform's native, always-available plain-text editor: Notepad on
/// Windows, TextEdit on macOS, or the first detected common editor on Linux
/// (`None` if none is found there).
pub fn native_text_editor() -> Option<NativeEditor> {
    #[cfg(windows)]
    {
        Some(NativeEditor {
            name: "Notepad".to_string(),
            // `.exe` so it's spawned directly (windowless), not via `cmd /C`.
            command: "notepad.exe".to_string(),
            args: Vec::new(),
        })
    }
    #[cfg(target_os = "macos")]
    {
        Some(NativeEditor {
            name: "TextEdit".to_string(),
            command: "open".to_string(),
            args: vec!["-a".to_string(), "TextEdit".to_string()],
        })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        const LINUX_TEXT_EDITORS: &[(&str, &str)] = &[
            ("gnome-text-editor", "Text Editor"),
            ("gedit", "gedit"),
            ("kate", "Kate"),
            ("kwrite", "KWrite"),
            ("mousepad", "Mousepad"),
            ("xed", "Text Editor"),
        ];
        LINUX_TEXT_EDITORS
            .iter()
            .find(|(cmd, _)| which::is_command_available(cmd))
            .map(|(cmd, name)| NativeEditor {
                name: (*name).to_string(),
                command: (*cmd).to_string(),
                args: Vec::new(),
            })
    }
}

/// Expand `%VAR%` occurrences in a Windows path from the environment (a missing
/// var expands to empty, so the path simply won't exist and is skipped).
#[cfg(windows)]
fn expand_windows_env(path: &str) -> String {
    let mut out = String::new();
    let mut rest = path;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        rest = &rest[start + 1..];
        match rest.find('%') {
            Some(end) => {
                if let Ok(val) = std::env::var(&rest[..end]) {
                    out.push_str(&val);
                }
                rest = &rest[end + 1..];
            }
            None => {
                out.push('%');
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Path of a macOS `.app` bundle if it exists in `/Applications` or the user's
/// `~/Applications`.
#[cfg(target_os = "macos")]
fn mac_app_path(app: &str) -> Option<String> {
    let mut roots = vec!["/Applications".to_string()];
    if let Ok(home) = std::env::var("HOME") {
        roots.push(format!("{home}/Applications"));
    }
    roots
        .into_iter()
        .map(|root| format!("{root}/{app}.app"))
        .find(|p| std::path::Path::new(p).exists())
}

/// Build the `(program, args)` that launches `command` (with its own `args`)
/// against `path`.
///
/// On Windows an explicit path or an `.exe`/`.com` command is spawned **directly**
/// and windowless (no console); a bare CLI name (an npm-style `.cmd`/`.bat` shim
/// `CreateProcess` can't run directly) goes through a windowless `cmd /C`.
/// Everywhere else it's the command itself plus its args and the path
/// (PATH-resolved by the OS at spawn — e.g. macOS `open -a <App> <path>`).
pub fn build_open_command(command: &str, args: &[String], path: &str) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        let lower = command.to_ascii_lowercase();
        let direct = command.contains('\\')
            || command.contains('/')
            || lower.ends_with(".exe")
            || lower.ends_with(".com");
        if direct {
            let mut out: Vec<String> = args.to_vec();
            out.push(path.to_string());
            (command.to_string(), out)
        } else {
            let mut out: Vec<String> = vec!["/C".to_string(), command.to_string()];
            out.extend(args.iter().cloned());
            out.push(path.to_string());
            ("cmd".to_string(), out)
        }
    }
    #[cfg(not(windows))]
    {
        let mut out: Vec<String> = args.to_vec();
        out.push(path.to_string());
        (command.to_string(), out)
    }
}

/// Launch `path` in the editor identified by `command` (+ its `args`), detached
/// from this process's stdio so it never blocks or leaks pipes. `command` is
/// either a detected editor's launch command or a user-configured one.
pub fn open_in_editor(command: &str, args: &[String], path: &str) -> std::io::Result<()> {
    if command.trim().is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "no editor command",
        ));
    }
    let (program, spawn_args) = build_open_command(command, args, path);
    crate::winproc::command(program)
        .args(spawn_args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique() {
        let mut ids: Vec<&str> = CATALOG.iter().map(|d| d.id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate editor id in the catalog");
    }

    #[test]
    fn catalog_entries_are_well_formed() {
        for d in CATALOG {
            assert!(!d.id.is_empty(), "empty catalog id");
            assert!(!d.name.is_empty(), "empty catalog name for {}", d.id);
            // Every editor must be findable *some* way on *some* platform.
            assert!(
                !d.commands.is_empty() || !d.win_paths.is_empty() || !d.mac_apps.is_empty(),
                "no way to detect {}",
                d.id
            );
        }
    }

    #[test]
    fn detect_only_returns_installed_editors() {
        // Whatever this machine has, every returned command must be launchable: a
        // resolvable CLI, an existing file path, or macOS `open`.
        for ed in detect() {
            let ok = which::is_command_available(&ed.command)
                || std::path::Path::new(&ed.command).is_file()
                || ed.command == "open";
            assert!(ok, "{ed:?} is not launchable");
        }
    }

    #[test]
    fn native_text_editor_is_available_on_desktop_oses() {
        // Windows/macOS always have one; Linux may not in a bare CI container.
        #[cfg(any(windows, target_os = "macos"))]
        assert!(native_text_editor().is_some());
        #[cfg(all(unix, not(target_os = "macos")))]
        let _ = native_text_editor(); // just exercise it
    }

    #[test]
    fn build_open_command_puts_the_path_last() {
        let (_program, args) = build_open_command("code", &[], "/tmp/project");
        assert_eq!(args.last().map(String::as_str), Some("/tmp/project"));
    }

    #[test]
    fn build_open_command_keeps_leading_args_before_the_path() {
        // macOS `open -a App` shape: args stay ahead of the path everywhere.
        let extra = vec!["-a".to_string(), "My Editor".to_string()];
        let (_program, args) = build_open_command("open", &extra, "/tmp/file.rs");
        let a = args.iter().position(|x| x == "-a").unwrap();
        let path = args.iter().position(|x| x == "/tmp/file.rs").unwrap();
        assert!(a < path, "leading args must precede the path");
    }

    #[cfg(windows)]
    #[test]
    fn windows_bare_cli_routes_through_windowless_cmd() {
        let (program, args) = build_open_command("code", &[], "C:/proj");
        assert_eq!(program, "cmd");
        // cmd /C code C:/proj — no `start` (that would pop a console window).
        assert_eq!(
            args,
            vec!["/C".to_string(), "code".to_string(), "C:/proj".to_string()]
        );
        assert!(!args.iter().any(|a| a == "start"), "must not use `start`");
    }

    #[cfg(windows)]
    #[test]
    fn windows_exe_path_is_spawned_directly() {
        let (program, args) = build_open_command(r"C:\Programs\Cursor\Cursor.exe", &[], "C:/proj");
        assert_eq!(program, r"C:\Programs\Cursor\Cursor.exe");
        assert_eq!(args, vec!["C:/proj".to_string()]);
        // `notepad.exe` (bare, but `.exe`) is direct too — no lingering `cmd`.
        let (p2, a2) = build_open_command("notepad.exe", &[], "C:/f.txt");
        assert_eq!(p2, "notepad.exe");
        assert_eq!(a2, vec!["C:/f.txt".to_string()]);
    }

    #[cfg(windows)]
    #[test]
    fn expand_windows_env_substitutes_vars() {
        std::env::set_var("UXNAN_TEST_ROOT", r"C:\Root");
        assert_eq!(
            expand_windows_env(r"%UXNAN_TEST_ROOT%\App\x.exe"),
            r"C:\Root\App\x.exe"
        );
        // An unknown var expands to empty (path just won't exist).
        assert_eq!(expand_windows_env(r"%UXNAN_NOPE_XYZ%\a"), r"\a");
    }

    #[test]
    fn open_in_editor_rejects_a_blank_command() {
        assert!(open_in_editor("   ", &[], "/tmp/x").is_err());
    }
}
