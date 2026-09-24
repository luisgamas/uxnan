//! The native half of the keyboard layer (`src/lib/keyboard/`, `docs/keyboard.md`).
//!
//! The app's UI hears its own keys. A focused **browser page** does not: it is a
//! separate native webview (`browser/host.rs`) whose keys never reach the UI's
//! JavaScript — and a page must never be able to call the app. So the global
//! shortcuts (the actions the registry marks `global`) are also heard here:
//!
//! - **macOS** — they are the app's commands in the menu bar (`menu.rs`), which
//!   is where a Mac app keeps them anyway. A key the focused webview leaves
//!   unhandled goes on to the menu, so a page gets its own keys first and the
//!   app's still work from inside it.
//! - **Windows** — each page's WebView2 controller reports accelerator keys
//!   (anything with Ctrl or Alt, the function keys) before the page sees them.
//! - **Linux** — each page's GTK widget reports its key presses.
//!
//! Either way the app runs the action by emitting [`ACTION_EVENT`] to its UI,
//! which runs it through the same dispatcher as any other key. The UI keeps
//! this module in step with the person's bindings (`keyboard_set_commands`).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::error::CommandError;

/// The event the UI listens to for a global action heard natively.
pub const ACTION_EVENT: &str = "keyboard:action";

/// Where a global command sits in the macOS menu bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MenuPlacement {
    App,
    File,
    View,
}

/// A global command, as the UI sends it: its action id, its chord in the UI's
/// canonical form (`Mod+Shift+P`, `""` = unbound), its label in the app's
/// language and its menu placement.
#[derive(Debug, Clone, Deserialize)]
pub struct NativeCommand {
    pub id: String,
    pub chord: String,
    pub label: String,
    pub menu: Option<MenuPlacement>,
}

/// What the native layer knows: the global commands and the menu bar's words.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub commands: Vec<NativeCommand>,
    pub labels: HashMap<String, String>,
}

impl Snapshot {
    /// A menu word in the app's language, else the English fallback.
    pub fn label<'a>(&'a self, key: &str, fallback: &'a str) -> &'a str {
        self.labels
            .get(key)
            .map(String::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(fallback)
    }
}

/// The native layer's state, shared by the command, the menu and the page hooks.
#[derive(Default)]
pub struct KeyboardState {
    inner: Mutex<Snapshot>,
}

impl KeyboardState {
    pub fn set(&self, snapshot: Snapshot) {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = snapshot;
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.inner.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// The global command bound to a key press, if any. (macOS hears keys
    /// through the menu bar, so only Windows and Linux ask.)
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub fn command_for(&self, pressed: &Chord) -> Option<String> {
        let inner = self.inner.lock().ok()?;
        inner
            .commands
            .iter()
            .find(|c| Chord::parse(&c.chord).as_ref() == Some(pressed))
            .map(|c| c.id.clone())
    }
}

/// A key combination. `primary` is the platform's primary modifier — ⌘ on
/// macOS, Ctrl elsewhere — and `ctrl` the literal Control key, which is its own
/// modifier only on macOS (the UI already folds it into `primary` elsewhere).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Chord {
    pub primary: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    /// A single uppercase character or a key name (`Tab`, `ArrowRight`, `F5`).
    pub key: String,
}

impl Chord {
    /// Read a chord in the UI's canonical form, or `None` for an empty one.
    pub fn parse(chord: &str) -> Option<Self> {
        if chord.is_empty() {
            return None;
        }
        // A trailing "++" is the plus key itself.
        let (mods, key) = match chord.strip_suffix("++") {
            Some(rest) => (rest, "+"),
            None => match chord.rsplit_once('+') {
                Some((mods, key)) => (mods, key),
                None => ("", chord),
            },
        };
        if key.is_empty() {
            return None;
        }
        let mut out = Chord {
            key: if key.chars().count() == 1 {
                key.to_uppercase()
            } else {
                key.to_string()
            },
            ..Chord::default()
        };
        for m in mods.split('+').filter(|m| !m.is_empty()) {
            match m {
                "Mod" => out.primary = true,
                "Ctrl" => out.ctrl = true,
                "Alt" => out.alt = true,
                "Shift" => out.shift = true,
                _ => return None,
            }
        }
        Some(out)
    }

    /// The accelerator the macOS menu bar takes for this chord.
    pub fn menu_accelerator(&self) -> String {
        let mut parts: Vec<&str> = Vec::new();
        if self.primary {
            parts.push("CmdOrCtrl");
        }
        if self.ctrl {
            parts.push("Ctrl");
        }
        if self.alt {
            parts.push("Alt");
        }
        if self.shift {
            parts.push("Shift");
        }
        parts.push(&self.key);
        parts.join("+")
    }
}

/// The key name of a Windows virtual-key code, in the UI's chord vocabulary.
/// Punctuation follows the US layout (the codes name positions, not
/// characters); `None` for keys no shortcut uses.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn key_from_windows_vk(vk: u32) -> Option<String> {
    let named = match vk {
        0x08 => "Backspace",
        0x09 => "Tab",
        0x0D => "Enter",
        0x1B => "Escape",
        0x20 => "Space",
        0x21 => "PageUp",
        0x22 => "PageDown",
        0x23 => "End",
        0x24 => "Home",
        0x25 => "ArrowLeft",
        0x26 => "ArrowUp",
        0x27 => "ArrowRight",
        0x28 => "ArrowDown",
        0x2E => "Delete",
        0xBA => ";",
        0xBB => "=",
        0xBC => ",",
        0xBD => "-",
        0xBE => ".",
        0xBF => "/",
        0xC0 => "`",
        0xDB => "[",
        0xDC => "\\",
        0xDD => "]",
        0xDE => "'",
        0x30..=0x39 | 0x41..=0x5A => return char::from_u32(vk).map(|c| c.to_string()),
        0x70..=0x87 => return Some(format!("F{}", vk - 0x6F)),
        _ => return None,
    };
    Some(named.to_string())
}

/// The key name of a GDK key name (`gdk_keyval_name` of the lower-cased
/// keyval), in the UI's chord vocabulary; `None` for keys no shortcut uses.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn key_from_gdk_name(name: &str) -> Option<String> {
    let named = match name {
        "BackSpace" => "Backspace",
        "Tab" | "ISO_Left_Tab" => "Tab",
        "Return" | "KP_Enter" => "Enter",
        "Escape" => "Escape",
        "space" => "Space",
        "Page_Up" => "PageUp",
        "Page_Down" => "PageDown",
        "End" => "End",
        "Home" => "Home",
        "Left" => "ArrowLeft",
        "Up" => "ArrowUp",
        "Right" => "ArrowRight",
        "Down" => "ArrowDown",
        "Delete" => "Delete",
        "semicolon" => ";",
        "equal" => "=",
        "comma" => ",",
        "minus" => "-",
        "period" => ".",
        "slash" => "/",
        "grave" => "`",
        "bracketleft" => "[",
        "backslash" => "\\",
        "bracketright" => "]",
        "apostrophe" => "'",
        _ => {
            let mut chars = name.chars();
            return match (chars.next(), chars.next()) {
                (Some(c), None) if c.is_ascii_alphanumeric() => {
                    Some(c.to_ascii_uppercase().to_string())
                }
                _ => name
                    .strip_prefix('F')
                    .and_then(|n| n.parse::<u8>().ok())
                    .filter(|n| (1..=24).contains(n))
                    .map(|n| format!("F{n}")),
            };
        }
    };
    Some(named.to_string())
}

/// Run a global action in the UI.
pub fn emit_action<R: Runtime>(app: &AppHandle<R>, id: &str) {
    #[derive(Serialize, Clone)]
    struct Payload<'a> {
        id: &'a str,
    }
    let _ = app.emit(ACTION_EVENT, Payload { id });
}

/// The UI's bindings and menu words for the native layer.
#[tauri::command]
pub fn keyboard_set_commands<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, KeyboardState>,
    commands: Vec<NativeCommand>,
    labels: HashMap<String, String>,
) -> Result<(), CommandError> {
    state.set(Snapshot { commands, labels });
    #[cfg(target_os = "macos")]
    crate::menu::install(&app, &state.snapshot())
        .map_err(|e| CommandError::new("KEYBOARD_MENU_FAILED", e.to_string()))?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

/// Keep the engine's own browser shortcuts off the app's UI. WebView2 treats
/// the window like a web browser — F5 / Ctrl+R reload the whole UI (losing an
/// unsaved edit), Ctrl+F opens a find bar, Ctrl+P prints, Alt+← navigates the
/// app's history. With them off those keys reach the app like any other.
/// WebKit has no such keys, and a browser *page* keeps them — it is a browser.
/// Development builds keep them too, for reloading and DevTools.
pub fn quiet_engine_keys<R: Runtime>(webview: &tauri::WebviewWindow<R>) {
    #[cfg(all(windows, not(debug_assertions)))]
    let _ = webview.with_webview(|platform| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;
        // SAFETY: WebView2 settings calls on the UI thread `with_webview` runs on.
        unsafe {
            if let Ok(settings) = platform
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
                .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
            {
                let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
            }
        }
    });
    #[cfg(not(all(windows, not(debug_assertions))))]
    let _ = webview;
}

/// Hear the global shortcuts inside a browser page (Windows and Linux; macOS
/// hears them through the menu bar).
pub fn watch_page<R: Runtime>(webview: &tauri::Webview<R>) {
    #[cfg(windows)]
    windows_page::watch(webview);
    #[cfg(target_os = "linux")]
    linux_page::watch(webview);
    #[cfg(target_os = "macos")]
    let _ = webview;
}

#[cfg(windows)]
mod windows_page {
    use tauri::{Manager, Runtime, Webview};
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
    };

    use super::{emit_action, key_from_windows_vk, Chord, KeyboardState};

    fn held(vk: u16) -> bool {
        // SAFETY: a plain query of the calling thread's keyboard state.
        unsafe { GetKeyState(i32::from(vk)) < 0 }
    }

    pub fn watch<R: Runtime>(webview: &Webview<R>) {
        let app = webview.app_handle().clone();
        let _ = webview.with_webview(move |platform| {
            let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                // SAFETY: WebView2 calls this on the UI thread with live args.
                unsafe {
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    args.KeyEventKind(&mut kind)?;
                    if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                        && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                    {
                        return Ok(());
                    }
                    let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                    args.PhysicalKeyStatus(&mut status)?;
                    if status.WasKeyDown.as_bool() {
                        return Ok(()); // auto-repeat
                    }
                    let mut vk = 0u32;
                    args.VirtualKey(&mut vk)?;
                    let Some(key) = key_from_windows_vk(vk) else {
                        return Ok(());
                    };
                    let pressed = Chord {
                        primary: held(VK_CONTROL),
                        ctrl: false,
                        alt: held(VK_MENU),
                        shift: held(VK_SHIFT),
                        key,
                    };
                    if let Some(id) = app.state::<KeyboardState>().command_for(&pressed) {
                        args.SetHandled(true)?;
                        emit_action(&app, &id);
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            // SAFETY: registering an event handler on the page's own controller,
            // on the UI thread `with_webview` runs this closure on.
            unsafe {
                let _ = platform
                    .controller()
                    .add_AcceleratorKeyPressed(&handler, &mut token);
            }
        });
    }
}

#[cfg(target_os = "linux")]
mod linux_page {
    use gtk::prelude::WidgetExt;
    use tauri::{Manager, Runtime, Webview};

    use super::{emit_action, key_from_gdk_name, Chord, KeyboardState};

    pub fn watch<R: Runtime>(webview: &Webview<R>) {
        let app = webview.app_handle().clone();
        let _ = webview.with_webview(move |platform| {
            platform.inner().connect_key_press_event(move |_, event| {
                let state = event.state();
                let name = event.keyval().to_lower().name();
                let Some(key) = name.as_deref().and_then(key_from_gdk_name) else {
                    return gtk::glib::Propagation::Proceed;
                };
                let pressed = Chord {
                    primary: state.contains(gtk::gdk::ModifierType::CONTROL_MASK),
                    ctrl: false,
                    alt: state.contains(gtk::gdk::ModifierType::MOD1_MASK),
                    shift: state.contains(gtk::gdk::ModifierType::SHIFT_MASK),
                    key,
                };
                match app.state::<KeyboardState>().command_for(&pressed) {
                    Some(id) => {
                        emit_action(&app, &id);
                        gtk::glib::Propagation::Stop
                    }
                    None => gtk::glib::Propagation::Proceed,
                }
            });
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord(s: &str) -> Chord {
        Chord::parse(s).expect("a chord")
    }

    #[test]
    fn reads_the_ui_chords() {
        assert_eq!(
            chord("Mod+Shift+P"),
            Chord {
                primary: true,
                shift: true,
                key: "P".into(),
                ..Chord::default()
            }
        );
        assert!(chord("Ctrl+Tab").ctrl);
        assert_eq!(chord("Mod++").key, "+");
        assert_eq!(chord("Alt+ArrowRight").key, "ArrowRight");
        assert_eq!(Chord::parse(""), None);
        assert_eq!(Chord::parse("Mod+"), None);
        assert_eq!(Chord::parse("Hyper+K"), None);
    }

    #[test]
    fn writes_menu_accelerators() {
        assert_eq!(chord("Mod+Shift+P").menu_accelerator(), "CmdOrCtrl+Shift+P");
        assert_eq!(chord("Ctrl+Shift+Tab").menu_accelerator(), "Ctrl+Shift+Tab");
        assert_eq!(chord("Mod+,").menu_accelerator(), "CmdOrCtrl+,");
    }

    #[test]
    fn names_windows_keys() {
        assert_eq!(key_from_windows_vk(0x4A).as_deref(), Some("J"));
        assert_eq!(key_from_windows_vk(0x35).as_deref(), Some("5"));
        assert_eq!(key_from_windows_vk(0x74).as_deref(), Some("F5"));
        assert_eq!(key_from_windows_vk(0xBC).as_deref(), Some(","));
        assert_eq!(key_from_windows_vk(0x27).as_deref(), Some("ArrowRight"));
        assert_eq!(key_from_windows_vk(0x11), None); // Ctrl itself
    }

    #[test]
    fn names_gdk_keys() {
        assert_eq!(key_from_gdk_name("j").as_deref(), Some("J"));
        assert_eq!(key_from_gdk_name("comma").as_deref(), Some(","));
        assert_eq!(key_from_gdk_name("ISO_Left_Tab").as_deref(), Some("Tab"));
        assert_eq!(key_from_gdk_name("F12").as_deref(), Some("F12"));
        assert_eq!(key_from_gdk_name("Control_L"), None);
        assert_eq!(key_from_gdk_name("Fish"), None);
    }

    #[test]
    fn finds_the_command_bound_to_a_press() {
        let state = KeyboardState::default();
        state.set(Snapshot {
            commands: vec![
                NativeCommand {
                    id: "toggleRightSidebar".into(),
                    chord: "Mod+J".into(),
                    label: "Toggle dock".into(),
                    menu: Some(MenuPlacement::View),
                },
                NativeCommand {
                    id: "worktreePalette".into(),
                    chord: String::new(),
                    label: "Palette".into(),
                    menu: Some(MenuPlacement::View),
                },
            ],
            labels: HashMap::new(),
        });
        assert_eq!(
            state.command_for(&chord("Mod+J")).as_deref(),
            Some("toggleRightSidebar")
        );
        assert_eq!(state.command_for(&chord("Mod+Shift+J")), None);
    }

    #[test]
    fn falls_back_to_english_menu_words() {
        let mut snapshot = Snapshot::default();
        assert_eq!(snapshot.label("file", "File"), "File");
        snapshot.labels.insert("file".into(), "Archivo".into());
        assert_eq!(snapshot.label("file", "File"), "Archivo");
    }
}
