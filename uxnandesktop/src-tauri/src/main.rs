// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // First thing, before any thread exists: drop the terminal identity this
    // process may have inherited. Launched from inside a uxnan terminal (which is
    // what `npm run tauri dev` is), the app would otherwise hand every CLI it
    // spawns that terminal's `UXNAN_AGENT_ID` + the other app's hook coordinates,
    // and those runs would report as an agent the user never launched. See
    // `launchenv`.
    uxnan_desktop_lib::launchenv::scrub_process();

    // Automations must fire while the app is closed, so the binary has a second
    // life as a headless runner: with `--automation-run <id>` it executes that
    // automation on a plain Tokio runtime and exits, never building a window or a
    // webview. The OS scheduler and the app's "Run now" both take this path, so
    // scheduled and manual runs can't drift apart. Anything else starts the ADE.
    if let Some(args) = uxnan_desktop_lib::automations::runner::parse_args(std::env::args().skip(1))
    {
        std::process::exit(uxnan_desktop_lib::automations::runner::run_blocking(args));
    }
    uxnan_desktop_lib::run()
}
