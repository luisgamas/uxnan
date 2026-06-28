fn main() {
    // Rebuild when the full release version changes so `option_env!("UXNAN_VERSION")`
    // in `updater::app_version` re-embeds the new value (CI sets it from the tag;
    // see `release-desktop.yml`). Without this, a cached build could keep a stale
    // version string.
    println!("cargo:rerun-if-env-changed=UXNAN_VERSION");
    tauri_build::build()
}
