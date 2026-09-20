fn main() {
    // Rebuild when the full release version changes so `option_env!("UXNAN_VERSION")`
    // in `updater::app_version` re-embeds the new value (CI sets it from the tag;
    // see `release-desktop.yml`). Without this, a cached build could keep a stale
    // version string.
    println!("cargo:rerun-if-env-changed=UXNAN_VERSION");

    // Windows (MSVC): embed the Common Controls 6.0 manifest through the linker
    // into **every** artifact this package links — the app, and the test
    // binaries. tauri-build embeds the same manifest as a compiled resource,
    // which reaches the app executable only; the control surface's end-to-end
    // tests build a Tauri mock app, which links comctl32 v6-only symbols, and
    // without the manifest the test process cannot even be loaded
    // (STATUS_ENTRYPOINT_NOT_FOUND). The resource manifest is switched off so
    // the app does not carry two. `rustc-link-arg-tests` would not do: it
    // reaches integration tests only, never a library's unit-test harness.
    // See `windows-test-manifest.xml`.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-test-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("tauri build");
        return;
    }

    tauri_build::build()
}
