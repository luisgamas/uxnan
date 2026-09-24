//! The macOS menu bar.
//!
//! macOS always has a menu bar, and the one Tauri installs by default binds
//! **Close Window to ⌘W**. A menu key equivalent is handled before the key ever
//! reaches the webview, so ⌘W closed the whole window — quitting the app, with
//! every terminal in it — instead of reaching the app's own "close tab"
//! shortcut. This menu is that default one with a single change: Close Window
//! moves to **⌘⇧W**, the convention of every tabbed Mac app (⌘W closes the tab,
//! ⌘⇧W the window), so ⌘W goes to the app.
//!
//! Windows and Linux get no menu bar: the window is frameless and draws its own
//! controls (`WindowControls.svelte`), exactly as before.

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime};

/// The id of our Close Window item (the predefined one is bound to ⌘W).
pub const CLOSE_WINDOW_ID: &str = "uxnan.close-window";

/// The accelerator Close Window takes instead of ⌘W.
pub const CLOSE_WINDOW_ACCELERATOR: &str = "CmdOrCtrl+Shift+W";

/// Build the menu bar: the platform default, with Close Window on ⌘⇧W.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    let close_window = MenuItem::with_id(
        app,
        CLOSE_WINDOW_ID,
        "Close Window",
        true,
        Some(CLOSE_WINDOW_ACCELERATOR),
    )?;
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                pkg.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&close_window])?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
        ],
    )
}

/// Run a menu item the app owns (the predefined ones run themselves).
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == CLOSE_WINDOW_ID {
        // The focused window, else the main one: closing goes through the
        // normal close path (`CloseRequested`), so state is flushed as usual.
        let focused = app
            .windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false))
            .or_else(|| app.get_window("main"));
        if let Some(window) = focused {
            let _ = window.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_window_is_not_on_command_w() {
        // ⌘W belongs to the app's "close tab" shortcut.
        assert_ne!(CLOSE_WINDOW_ACCELERATOR, "CmdOrCtrl+W");
        assert!(CLOSE_WINDOW_ACCELERATOR.contains("Shift"));
        assert!(CLOSE_WINDOW_ACCELERATOR.ends_with('W'));
    }
}
