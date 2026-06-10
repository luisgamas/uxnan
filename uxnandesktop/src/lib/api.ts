// Thin, typed wrappers over the Tauri command surface. One function per Rust
// `#[tauri::command]`; keep the names and payloads in lockstep with
// `src-tauri/src/commands.rs`.

import { invoke } from "@tauri-apps/api/core";
import type { AppData, AppSettings } from "./types";

/** Load the full persisted application state (called once at boot). */
export function getAppState(): Promise<AppData> {
  return invoke<AppData>("get_app_state");
}

/** Persist updated settings; resolves to the new full state. */
export function updateSettings(settings: AppSettings): Promise<AppData> {
  return invoke<AppData>("update_settings", { settings });
}

/** Backend liveness probe; resolves to `"pong"`. */
export function ping(): Promise<string> {
  return invoke<string>("ping");
}
