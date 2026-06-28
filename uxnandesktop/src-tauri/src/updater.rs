//! In-app auto-updater (Settings → Updates).
//!
//! Wraps `tauri-plugin-updater` with two design choices specific to this ADE:
//!
//! 1. **Per-channel endpoint.** The plugin has no `{{channel}}` URL variable, so
//!    we build the endpoint at runtime from the user's chosen channel and point
//!    it at a rolling per-channel manifest published on the GitHub Releases:
//!    `…/releases/download/desktop-updater-<channel>/latest.json` (the CI keeps
//!    that release's `latest.json` pointing at the newest signed installer for
//!    the channel — see `docs/updates.md`).
//!
//! 2. **Download and install are separate commands.** Downloading is harmless
//!    and runs in the background; installing restarts the app and therefore
//!    **stops every running agent** (each agent is a PTY child of this process —
//!    a restart cannot keep it alive). So `updater_download` stages the installer
//!    bytes in [`AppState::staged_update`] and `updater_install` applies them
//!    later, when the frontend decides it's safe (no agent working, or the user
//!    confirmed). We deliberately store only the bytes + version (both trivially
//!    `Send`) and re-run the lightweight manifest `check()` at install time to
//!    obtain a fresh [`Update`] handle, rather than parking the handle itself.
//!
//! Signature verification uses the `pubkey` in `tauri.conf.json` (a free
//! minisign key, unrelated to OS code-signing). Until a real keypair + signed
//! releases exist, `check()` simply finds nothing / fails to verify and the app
//! runs normally (see `FOR-HUMAN.md`).

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, CommandError};
use crate::model::UpdateChannel;
use crate::state::AppState;

/// GitHub owner/repo that hosts the desktop releases + rolling update manifests.
const UPDATER_OWNER: &str = "luisgamas";
const UPDATER_REPO: &str = "uxnan";

/// A downloaded-but-not-yet-installed update held in memory between the
/// `updater_download` and `updater_install` commands.
pub struct StagedUpdate {
    /// The version the staged bytes install (guards against installing a stale
    /// download if a newer release appeared meanwhile).
    pub version: String,
    /// The raw installer bytes returned by `Update::download`.
    pub bytes: Vec<u8>,
}

/// Metadata about an available update, sent to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// The new version offered by the manifest.
    pub version: String,
    /// The version currently running.
    pub current_version: String,
    /// Release notes (manifest `notes`), if any.
    pub notes: Option<String>,
    /// Publish date (RFC 3339), if the manifest provided one.
    pub date: Option<String>,
}

/// Progress of an in-flight download, emitted on `updater:download-progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    /// Bytes downloaded so far.
    downloaded: u64,
    /// Total bytes, when the server reported a content length.
    content_length: Option<u64>,
}

/// The rolling per-channel manifest URL the updater polls. One stable location
/// per channel, overwritten by CI when a release of that channel is published.
pub fn endpoint_for(channel: UpdateChannel) -> String {
    format!(
        "https://github.com/{UPDATER_OWNER}/{UPDATER_REPO}/releases/download/desktop-updater-{}/latest.json",
        channel.slug()
    )
}

/// Read the configured release channel from persisted settings.
async fn current_channel(state: &AppState) -> UpdateChannel {
    state.data.read().await.settings.updater.channel
}

/// Run the plugin's `check()` against the channel's manifest, returning the
/// `Update` handle when a newer version is offered (or `None`).
async fn check_channel(
    app: &AppHandle,
    channel: UpdateChannel,
) -> Result<Option<tauri_plugin_updater::Update>, AppError> {
    let endpoint: tauri::Url = endpoint_for(channel)
        .parse()
        .map_err(|e| AppError::Updater(format!("bad updater endpoint: {e}")))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| AppError::Updater(e.to_string()))?
        .build()
        .map_err(|e| AppError::Updater(e.to_string()))?;
    updater
        .check()
        .await
        .map_err(|e| AppError::Updater(e.to_string()))
}

/// Build the serializable [`UpdateInfo`] from a plugin [`Update`].
fn info_of(update: &tauri_plugin_updater::Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
    }
}

/// The full human-facing app version for display (e.g. `0.0.5-alpha.20260628`).
///
/// The bundled version in `tauri.conf.json` is the **numeric base** only
/// (`0.0.5`) because the Windows MSI target rejects a non-numeric pre-release
/// id — that base is what `@tauri-apps/api/app`'s `getVersion()` and the updater
/// use for comparison. CI injects the full release name as the `UXNAN_VERSION`
/// build-time env (see `release-desktop.yml`); this surfaces it for the UI.
/// Falls back to the crate version for local/dev builds where it isn't set.
#[tauri::command]
pub fn app_version() -> String {
    option_env!("UXNAN_VERSION")
        .filter(|v| !v.is_empty())
        .unwrap_or(env!("CARGO_PKG_VERSION"))
        .to_string()
}

/// Check the configured channel for a newer version. Returns `None` when the app
/// is up to date. Does not download anything.
#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<UpdateInfo>, CommandError> {
    let channel = current_channel(&state).await;
    let update = check_channel(&app, channel).await?;
    Ok(update.as_ref().map(info_of))
}

/// Download the available update in the background, staging its bytes for a later
/// install. Emits `updater:download-progress` while running and `updater:downloaded`
/// on success. Re-checks first so this is safe to call on its own.
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<UpdateInfo, CommandError> {
    let channel = current_channel(&state).await;
    let update = check_channel(&app, channel)
        .await?
        .ok_or_else(|| AppError::Updater("no update available to download".into()))?;
    let info = info_of(&update);

    // Stream the installer, reporting progress so the UI can show a bar. An atomic
    // accumulator keeps the progress closure a plain `Fn` (no captured mutation).
    let progress_app = app.clone();
    let downloaded = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let counter = downloaded.clone();
    let bytes = update
        .download(
            move |chunk, content_length| {
                let total = counter.fetch_add(chunk as u64, std::sync::atomic::Ordering::Relaxed)
                    + chunk as u64;
                let _ = progress_app.emit(
                    "updater:download-progress",
                    DownloadProgress {
                        downloaded: total,
                        content_length,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| AppError::Updater(e.to_string()))?;

    *state.staged_update.write().await = Some(StagedUpdate {
        version: info.version.clone(),
        bytes,
    });
    let _ = app.emit("updater:downloaded", &info);
    Ok(info)
}

/// Whether an update has been downloaded and is staged for install — returns the
/// staged version, or `None`. Lets the frontend restore the banner state.
#[tauri::command]
pub async fn updater_staged(
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, CommandError> {
    Ok(state
        .staged_update
        .read()
        .await
        .as_ref()
        .map(|s| s.version.clone()))
}

/// Apply the staged update and restart into the new version. **This stops every
/// running agent**: each is a PTY child of this process, so we close them
/// cleanly first (rather than letting the installer kill them mid-write). The
/// frontend is responsible for only calling this when it's safe (no agent
/// working, or the user confirmed). Re-checks to obtain a fresh install handle;
/// if the staged download is stale (a newer release appeared), it is dropped and
/// the caller is asked to download again.
#[tauri::command]
pub async fn updater_install(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let staged = state
        .staged_update
        .write()
        .await
        .take()
        .ok_or_else(|| AppError::Updater("no downloaded update to install".into()))?;

    let channel = current_channel(&state).await;
    let update = check_channel(&app, channel)
        .await?
        .ok_or_else(|| AppError::Updater("update no longer available".into()))?;
    if update.version != staged.version {
        // A newer release landed since the download — don't install stale bytes.
        return Err(AppError::Updater(format!(
            "staged update {} is stale (latest is {}); please download again",
            staged.version, update.version
        ))
        .into());
    }

    // Stop agents/terminals cleanly before the installer replaces the binary, and
    // release any keep-awake lock (mirrors the app-exit handler in `lib.rs`).
    if let Some(state) = app.try_state::<AppState>() {
        state.pty.close_all();
        state.power.set(false);
    }

    update
        .install(staged.bytes)
        .map_err(|e| AppError::Updater(e.to_string()))?;

    // On platforms where `install` doesn't replace-and-exit on its own, restart
    // into the freshly-installed version. `restart()` diverges (returns `!`).
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_is_per_channel() {
        assert_eq!(
            endpoint_for(UpdateChannel::Stable),
            "https://github.com/luisgamas/uxnan/releases/download/desktop-updater-stable/latest.json"
        );
        assert_eq!(
            endpoint_for(UpdateChannel::Nightly),
            "https://github.com/luisgamas/uxnan/releases/download/desktop-updater-nightly/latest.json"
        );
    }

    #[test]
    fn every_channel_endpoint_is_a_distinct_https_manifest() {
        let urls: Vec<String> = [UpdateChannel::Stable, UpdateChannel::Nightly]
            .iter()
            .map(|c| endpoint_for(*c))
            .collect();
        for url in &urls {
            assert!(url.starts_with("https://"), "must be https: {url}");
            assert!(
                url.ends_with("/latest.json"),
                "must end at the manifest: {url}"
            );
        }
        // Each channel resolves to its own manifest (no accidental aliasing).
        assert_eq!(
            urls.iter().collect::<std::collections::HashSet<_>>().len(),
            2
        );
    }
}
