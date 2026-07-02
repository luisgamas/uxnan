//! System font-family enumeration for the appearance settings font pickers.
//!
//! Each OS already ships a tool that lists installed font families — PowerShell's
//! `InstalledFontCollection` on Windows, `fc-list` on Linux, `system_profiler`
//! on macOS. We shell out to the right one so the picker offers the user's real
//! fonts. Every child runs through [`winproc::command`] so no console window
//! flashes on Windows. On any failure we fall back to a small curated list so the
//! picker is never empty. The app's own bundled faces (Geist / DM Sans) are added
//! by the frontend, not here — this command returns only system fonts.

use crate::winproc;

/// Curated cross-platform families used only when system enumeration fails or
/// returns nothing, so the picker always has something to show.
fn fallback_families() -> Vec<String> {
    [
        "Inter",
        "Segoe UI",
        "Roboto",
        "Arial",
        "Helvetica",
        "SF Mono",
        "Cascadia Mono",
        "Cascadia Code",
        "Consolas",
        "JetBrains Mono",
        "Fira Code",
        "Menlo",
        "Monaco",
    ]
    .iter()
    .map(|s| (*s).to_string())
    .collect()
}

/// Trim, drop blanks and Windows' `@Family` vertical-writing duplicates, then
/// sort + dedupe case-insensitively so the list reads cleanly.
fn clean(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut v: Vec<String> = names
        .into_iter()
        .map(|n| n.trim().to_string())
        .filter(|t| !t.is_empty() && !t.starts_with('@'))
        .collect();
    v.sort_by_key(|s| s.to_lowercase());
    v.dedup_by_key(|s| s.to_lowercase());
    v
}

/// Run a child and return its stdout as a string, or `None` on spawn failure /
/// non-zero exit.
#[allow(dead_code)] // every arm is platform-gated; one is unused per target.
async fn run(program: &str, args: &[&str]) -> Option<String> {
    let out = winproc::command(program).args(args).output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(windows)]
async fn enumerate() -> Vec<String> {
    // Add-Type guarantees System.Drawing is loaded; emit one family per line.
    const SCRIPT: &str = "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";
    match run(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
    )
    .await
    {
        Some(s) => s.lines().map(|l| l.to_string()).collect(),
        None => Vec::new(),
    }
}

#[cfg(target_os = "macos")]
async fn enumerate() -> Vec<String> {
    // system_profiler prints `Family: <name>` lines (indented) per typeface.
    match run("system_profiler", &["SPFontsDataType"]).await {
        Some(s) => s
            .lines()
            .filter_map(|l| l.trim().strip_prefix("Family: "))
            .map(|l| l.to_string())
            .collect(),
        None => Vec::new(),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
async fn enumerate() -> Vec<String> {
    // `fc-list : family` prints comma-separated localized names per line; keep
    // the first (canonical) name of each.
    match run("fc-list", &[":", "family"]).await {
        Some(s) => s
            .lines()
            .filter_map(|l| l.split(',').next())
            .map(|l| l.trim().to_string())
            .collect(),
        None => Vec::new(),
    }
}

/// List the installed system font families (sorted, deduped). Returns a curated
/// fallback list if enumeration fails, so the picker is never empty.
#[tauri::command]
pub async fn list_system_fonts() -> Vec<String> {
    let families = clean(enumerate().await);
    if families.is_empty() {
        clean(fallback_families())
    } else {
        families
    }
}
