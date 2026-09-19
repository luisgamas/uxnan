fn main() {
    // Rebuild when the full release version changes so `option_env!("UXNAN_VERSION")`
    // in `updater::app_version` re-embeds the new value (CI sets it from the tag;
    // see `release-desktop.yml`). Without this, a cached build could keep a stale
    // version string.
    println!("cargo:rerun-if-env-changed=UXNAN_VERSION");

    // Windows (MSVC): give every **test** binary the Common Controls 6.0
    // manifest tauri-build embeds only into the app executable. The control
    // surface's end-to-end tests build a Tauri mock app, which links comctl32
    // v6-only symbols; without the manifest the test process cannot even be
    // loaded (STATUS_ENTRYPOINT_NOT_FOUND). See `windows-test-manifest.xml`.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-test-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }

    tauri_build::build()
}
