//! The macOS menu bar — the app's commands where a Mac app keeps them, and the
//! native half of the keyboard layer there (`keyboard.rs`, `docs/keyboard.md`).
//!
//! macOS always has a menu bar. The one Tauri installs by default bound **Close
//! Window to ⌘W** and its Quit ended the process without the app's shutdown; a
//! menu key equivalent runs whenever the focused webview leaves the key
//! unhandled, so ⌘W in a terminal closed the whole window. This menu is built
//! by the app instead:
//!
//! - **App** — About, Settings… (the app's own binding), Services, Hide, Quit.
//!   Quit closes the main window, so it takes the same road as its close button
//!   (unsaved-work check, pending writes flushed) instead of ending the process.
//! - **File** — the app's file commands, and Close Window on **⌘⇧W** — the
//!   convention of tabbed Mac apps; ⌘W belongs to the app ("close tab").
//! - **Edit** — the standard editing items, which is how ⌘C/⌘V/⌘Z reach a text
//!   field in a webview.
//! - **View** — the app's panel commands, and full screen.
//! - **Window** — minimize, zoom.
//!
//! Every command item carries the person's binding, so the menu both shows the
//! shortcut and hears it where the app's UI cannot: inside a browser page. It
//! is rebuilt whenever the bindings or the language change
//! (`keyboard_set_commands`). Windows and Linux get no menu bar: the window is
//! frameless and draws its own controls (`WindowControls.svelte`).

use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime};

use crate::keyboard::{emit_action, Chord, MenuPlacement, Snapshot};

/// Our Close Window item (the predefined one is bound to ⌘W).
const CLOSE_WINDOW_ID: &str = "uxnan.close-window";
/// Our Quit item (the predefined one skips the app's shutdown).
const QUIT_ID: &str = "uxnan.quit";
/// The prefix of an app command's item id; the rest is its action id.
const COMMAND_PREFIX: &str = "uxnan.action.";

/// Close Window's accelerator: ⌘W is the app's.
pub const CLOSE_WINDOW_ACCELERATOR: &str = "CmdOrCtrl+Shift+W";

/// Chords the menu bar already spends on standard items. An app command bound
/// to one of them is listed without its shortcut, so the standard item keeps it.
const RESERVED: &[&str] = &[
    "Mod+Q",
    "Mod+H",
    "Mod+Alt+H",
    "Mod+M",
    "Mod+Shift+W",
    "Mod+Z",
    "Mod+Shift+Z",
    "Mod+X",
    "Mod+C",
    "Mod+V",
    "Mod+A",
    "Mod+Ctrl+F",
];

/// The accelerator a command's chord takes in the menu, if it can take one:
/// not empty, not spent on a standard item, and not already used by `taken`.
fn accelerator_for(chord: &str, taken: &mut Vec<String>) -> Option<String> {
    let parsed = Chord::parse(chord)?;
    if RESERVED.contains(&chord) || taken.iter().any(|t| t == chord) {
        return None;
    }
    taken.push(chord.to_string());
    Some(parsed.menu_accelerator())
}

/// Build the menu bar for the current bindings and language.
pub fn build<R: Runtime>(app: &AppHandle<R>, snapshot: &Snapshot) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    let l = |key: &str, fallback: &'static str| snapshot.label(key, fallback).to_string();

    // The app's commands, per placement, in registry order.
    let mut taken = Vec::new();
    let mut items = |placement: MenuPlacement| -> tauri::Result<Vec<MenuItem<R>>> {
        snapshot
            .commands
            .iter()
            .filter(|c| c.menu == Some(placement))
            .map(|c| {
                let accel = accelerator_for(&c.chord, &mut taken);
                MenuItem::with_id(
                    app,
                    format!("{COMMAND_PREFIX}{}", c.id),
                    &c.label,
                    true,
                    accel.as_deref(),
                )
            })
            .collect()
    };
    let app_commands = items(MenuPlacement::App)?;
    let file_commands = items(MenuPlacement::File)?;
    let view_commands = items(MenuPlacement::View)?;

    // One separator item per place it appears: a menu item is one native item.
    let seps = (0..7)
        .map(|_| PredefinedMenuItem::separator(app))
        .collect::<tauri::Result<Vec<_>>>()?;
    let quit = MenuItem::with_id(app, QUIT_ID, l("quit", "Quit"), true, Some("CmdOrCtrl+Q"))?;
    let close_window = MenuItem::with_id(
        app,
        CLOSE_WINDOW_ID,
        l("closeWindow", "Close Window"),
        true,
        Some(CLOSE_WINDOW_ACCELERATOR),
    )?;

    let about = PredefinedMenuItem::about(app, Some(&l("about", "About")), Some(about))?;
    let services = PredefinedMenuItem::services(app, Some(&l("services", "Services")))?;
    let hide = PredefinedMenuItem::hide(app, Some(&l("hide", "Hide")))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some(&l("hideOthers", "Hide Others")))?;
    let show_all = PredefinedMenuItem::show_all(app, Some(&l("showAll", "Show All")))?;
    let mut app_menu: Vec<&dyn IsMenuItem<R>> = vec![&about, &seps[0]];
    app_menu.extend(app_commands.iter().map(|i| i as &dyn IsMenuItem<R>));
    if !app_commands.is_empty() {
        app_menu.push(&seps[1]);
    }
    app_menu.extend([
        &services as &dyn IsMenuItem<R>,
        &seps[2],
        &hide,
        &hide_others,
        &show_all,
        &seps[3],
        &quit,
    ]);

    let mut file_menu: Vec<&dyn IsMenuItem<R>> = file_commands
        .iter()
        .map(|i| i as &dyn IsMenuItem<R>)
        .collect();
    if !file_commands.is_empty() {
        file_menu.push(&seps[4]);
    }
    file_menu.push(&close_window);

    let undo = PredefinedMenuItem::undo(app, Some(&l("undo", "Undo")))?;
    let redo = PredefinedMenuItem::redo(app, Some(&l("redo", "Redo")))?;
    let cut = PredefinedMenuItem::cut(app, Some(&l("cut", "Cut")))?;
    let copy = PredefinedMenuItem::copy(app, Some(&l("copy", "Copy")))?;
    let paste = PredefinedMenuItem::paste(app, Some(&l("paste", "Paste")))?;
    let select_all = PredefinedMenuItem::select_all(app, Some(&l("selectAll", "Select All")))?;

    let fullscreen =
        PredefinedMenuItem::fullscreen(app, Some(&l("fullscreen", "Enter Full Screen")))?;
    let mut view_menu: Vec<&dyn IsMenuItem<R>> = view_commands
        .iter()
        .map(|i| i as &dyn IsMenuItem<R>)
        .collect();
    if !view_commands.is_empty() {
        view_menu.push(&seps[5]);
    }
    view_menu.push(&fullscreen);

    let minimize = PredefinedMenuItem::minimize(app, Some(&l("minimize", "Minimize")))?;
    let zoom = PredefinedMenuItem::maximize(app, Some(&l("zoom", "Zoom")))?;

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(app, pkg.name.clone(), true, &app_menu)?,
            &Submenu::with_items(app, l("file", "File"), true, &file_menu)?,
            &Submenu::with_items(
                app,
                l("edit", "Edit"),
                true,
                &[&undo, &redo, &seps[6], &cut, &copy, &paste, &select_all],
            )?,
            &Submenu::with_items(app, l("view", "View"), true, &view_menu)?,
            &Submenu::with_items(app, l("window", "Window"), true, &[&minimize, &zoom])?,
        ],
    )
}

/// Build the menu bar and make it the app's.
pub fn install<R: Runtime>(app: &AppHandle<R>, snapshot: &Snapshot) -> tauri::Result<()> {
    app.set_menu(build(app, snapshot)?)?;
    Ok(())
}

/// Run a menu item the app owns (the predefined ones run themselves).
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(action) = id.strip_prefix(COMMAND_PREFIX) {
        emit_action(app, action);
        return;
    }
    let window = match id {
        // The focused window, else the main one — the key window, as the
        // standard item would. Closing goes through `CloseRequested`.
        CLOSE_WINDOW_ID => app
            .windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false))
            .or_else(|| app.get_window("main")),
        // Quitting is closing the main window: the app exits when it closes,
        // after the same checks and flush as its close button.
        QUIT_ID => app.get_window("main"),
        _ => None,
    };
    if let Some(window) = window {
        let _ = window.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_window_is_not_on_command_w() {
        // ⌘W belongs to the app's "close tab" shortcut.
        assert_eq!(CLOSE_WINDOW_ACCELERATOR, "CmdOrCtrl+Shift+W");
        assert!(RESERVED.contains(&"Mod+Shift+W"));
        assert!(!RESERVED.contains(&"Mod+W"));
    }

    #[test]
    fn a_command_keeps_its_shortcut_unless_a_standard_item_or_another_command_has_it() {
        let mut taken = Vec::new();
        assert_eq!(
            accelerator_for("Mod+Shift+P", &mut taken).as_deref(),
            Some("CmdOrCtrl+Shift+P")
        );
        // A second command on the same chord is listed without it.
        assert_eq!(accelerator_for("Mod+Shift+P", &mut taken), None);
        // Undo keeps ⌘Z; an unbound command has none.
        assert_eq!(accelerator_for("Mod+Z", &mut taken), None);
        assert_eq!(accelerator_for("", &mut taken), None);
    }
}
