//! The bridge runtime Uxnan Desktop carries, and putting it on this machine.
//!
//! Every installer ships a private bridge (`scripts/build-bridge-runtime.mjs`,
//! bundled as the `bridge-runtime/` resource): the official Node.js binary for
//! its platform and the production tree of `uxnan-bridge` from the same
//! commit, with a manifest (`uxnan-runtime.json`) that hashes every file. So
//! the app gets chats and the phone working on a machine with no Node at all
//! (architecture/02a §5.8.18, desktop `02e` §3.5).
//!
//! The bridge's service never runs it from inside the app: an AppImage is
//! mounted in `/tmp` only while the app runs, and an app update replaces the
//! bundle under a live process. So the runtime is **copied out** — every file
//! hashed as it is written and compared with the manifest — to a per-user
//! folder outside `~/.uxnan` ([`runtime_root`]), one complete folder per
//! version under `versions/`, and only a folder that verified is ever renamed
//! into place. The service definition itself is the bridge's own
//! (`install-service`, run with that copy's `node` and `cli.js`), so it names
//! absolute paths to a folder that is never written again.
//!
//! This module only reads the bundle and writes `versions/`; which bridge
//! runs, and switching it, is `BridgeClient`'s (`mod.rs`). It never touches
//! `~/.uxnan`: the identity, the trusted phones and the conversations are the
//! bridge's and outlive any runtime.

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::Digest as _;

/// The manifest at the root of a runtime (`RUNTIME_MANIFEST` in
/// `bridge/src/install-kind.ts`).
pub const MANIFEST: &str = "uxnan-runtime.json";

/// The resource folder the installer carries the runtime in.
pub const RESOURCE_DIR: &str = "bridge-runtime";

/// A manifest is a few hundred KB (one line per file); anything past this is not one.
const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;

/// One file of a runtime, as its manifest lists it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub executable: bool,
}

/// What a runtime is, from its manifest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub kind: String,
    pub bridge_version: String,
    pub node_version: String,
    pub triple: String,
    /// The Node executable, relative to the runtime root.
    pub node: String,
    /// The bridge CLI (`cli.js`), relative to the runtime root.
    pub cli: String,
    pub files: Vec<FileEntry>,
}

/// A runtime on disk: where it is and the two paths the service runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    pub dir: PathBuf,
    pub bridge_version: String,
    pub node: PathBuf,
    pub cli: PathBuf,
}

/// The per-user folder runtimes are copied to: `~/Library/Application
/// Support/Uxnan/bridge-runtime` on macOS, `$XDG_DATA_HOME/uxnan/bridge-runtime`
/// (else `~/.local/share/…`) on Linux, `%LOCALAPPDATA%\uxnan\bridge-runtime`
/// on Windows — next to the `uxnan-cli` shim's `uxnan\bin`. One per user, not
/// per app profile: there is one bridge per machine.
pub fn runtime_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| home().map(|h| h.join("AppData").join("Local")))
            .map(|d| d.join("uxnan").join("bridge-runtime"))
    }
    #[cfg(target_os = "macos")]
    {
        home().map(|h| {
            h.join("Library")
                .join("Application Support")
                .join("Uxnan")
                .join("bridge-runtime")
        })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| home().map(|h| h.join(".local").join("share")))
            .map(|d| d.join("uxnan").join("bridge-runtime"))
    }
}

fn home() -> Option<PathBuf> {
    crate::agent_hooks::home_dir()
}

/// A relative path from a manifest, refused unless it stays inside the
/// runtime: no root, no `..`, no prefix.
pub fn safe_relative(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.len() > 1024 {
        return None;
    }
    let relative = Path::new(path);
    relative
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
        .then(|| relative.to_path_buf())
}

/// A version, refused unless it is safe as a folder name.
fn safe_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'+')
        && !version.starts_with('.')
}

/// Parse and check a manifest: its kind, versions, the two entry points, and
/// that every path stays inside the runtime.
pub fn parse_manifest(raw: &str) -> Result<Manifest, String> {
    let manifest: Manifest =
        serde_json::from_str(raw).map_err(|_| "not a runtime manifest".to_string())?;
    if manifest.kind != "bundled" {
        return Err("not a bundled runtime".into());
    }
    if !safe_version(&manifest.bridge_version) || !safe_version(&manifest.node_version) {
        return Err("bad version in the manifest".into());
    }
    if manifest.files.is_empty() {
        return Err("the manifest lists no files".into());
    }
    for entry in &manifest.files {
        if safe_relative(&entry.path).is_none() {
            return Err(format!("unsafe path in the manifest: {}", entry.path));
        }
        if entry.sha256.len() != 64 || !entry.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("bad hash for {}", entry.path));
        }
    }
    for needed in [&manifest.node, &manifest.cli] {
        if safe_relative(needed).is_none() || !manifest.files.iter().any(|f| &f.path == needed) {
            return Err(format!("the manifest does not list {needed}"));
        }
    }
    Ok(manifest)
}

/// Read the manifest of the runtime at `dir`.
pub fn read_manifest(dir: &Path) -> Result<Manifest, String> {
    let file = dir.join(MANIFEST);
    let meta = std::fs::metadata(&file).map_err(|_| format!("no {MANIFEST}"))?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err("manifest too large".into());
    }
    let raw = std::fs::read_to_string(&file).map_err(|e| e.kind().to_string())?;
    parse_manifest(&raw)
}

/// The runtime the installer carries at `bundle` (the resource folder), or
/// why there is none. A development build has the folder but no manifest.
pub fn bundled(bundle: &Path) -> Result<Runtime, String> {
    let manifest = read_manifest(bundle)?;
    Ok(runtime_at(bundle, &manifest))
}

fn runtime_at(dir: &Path, manifest: &Manifest) -> Runtime {
    // Both are checked by `parse_manifest`.
    let node = dir.join(safe_relative(&manifest.node).unwrap_or_default());
    let cli = dir.join(safe_relative(&manifest.cli).unwrap_or_default());
    Runtime {
        dir: dir.to_path_buf(),
        bridge_version: manifest.bridge_version.clone(),
        node,
        cli,
    }
}

/// The folder a version is installed in: `versions/<bridge>+node<node>`.
pub fn version_dir(root: &Path, manifest: &Manifest) -> PathBuf {
    root.join("versions").join(format!(
        "{}+node{}",
        manifest.bridge_version, manifest.node_version
    ))
}

/// Every runtime installed under `root` whose manifest reads (cheap: nothing
/// is hashed), newest version first.
pub fn installed(root: &Path) -> Vec<Runtime> {
    let Ok(entries) = std::fs::read_dir(root.join("versions")) else {
        return Vec::new();
    };
    let mut found: Vec<Runtime> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let dir = e.path();
            let manifest = read_manifest(&dir).ok()?;
            let runtime = runtime_at(&dir, &manifest);
            (runtime.node.is_file() && runtime.cli.is_file()).then_some(runtime)
        })
        .collect();
    found.sort_by(|a, b| compare_versions(&b.bridge_version, &a.bridge_version));
    found
}

/// Whether `path` is inside a runtime installed under `root`.
pub fn is_inside(root: &Path, path: &Path) -> bool {
    path.starts_with(root.join("versions"))
}

/// Hash every file of the runtime at `dir` against `manifest`; the first
/// problem, if any.
pub fn verify(dir: &Path, manifest: &Manifest) -> Result<(), String> {
    for entry in &manifest.files {
        let rel = safe_relative(&entry.path).ok_or("unsafe path")?;
        let path = dir.join(rel);
        let mut file = std::fs::File::open(&path).map_err(|_| format!("missing {}", entry.path))?;
        let mut hasher = sha2::Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        let mut size = 0u64;
        loop {
            let n = file.read(&mut buf).map_err(|e| e.kind().to_string())?;
            if n == 0 {
                break;
            }
            size += n as u64;
            hasher.update(&buf[..n]);
        }
        if size != entry.size || hex::encode(hasher.finalize()) != entry.sha256 {
            return Err(format!("changed {}", entry.path));
        }
    }
    Ok(())
}

/// Copy the runtime at `bundle` to `root`, verified, and return it. Reuses a
/// folder of the same version that still verifies; replaces one that does
/// not. Nothing is renamed into `versions/` before every file matched.
pub fn install(bundle: &Path, root: &Path) -> Result<Runtime, String> {
    let manifest = read_manifest(bundle)?;
    let dest = version_dir(root, &manifest);
    if dest.join(MANIFEST).is_file()
        && read_manifest(&dest).ok().as_ref() == Some(&manifest)
        && verify(&dest, &manifest).is_ok()
    {
        return Ok(runtime_at(&dest, &manifest));
    }
    std::fs::create_dir_all(root.join("versions")).map_err(|e| format!("{root:?}: {e}"))?;
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    let result = copy_verified(bundle, &staging, &manifest).and_then(|()| {
        if dest.exists() {
            std::fs::remove_dir_all(&dest).map_err(|e| format!("{dest:?}: {e}"))?;
        }
        std::fs::rename(&staging, &dest).map_err(|e| format!("{dest:?}: {e}"))
    });
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result.map(|()| runtime_at(&dest, &manifest))
}

/// Copy each listed file, hashing it as it is written (contents only — no
/// extended attributes, so nothing like a download quarantine follows it).
fn copy_verified(from: &Path, to: &Path, manifest: &Manifest) -> Result<(), String> {
    for entry in &manifest.files {
        let rel = safe_relative(&entry.path).ok_or("unsafe path")?;
        let (src, dst) = (from.join(&rel), to.join(&rel));
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{parent:?}: {e}"))?;
        }
        let mut input =
            std::fs::File::open(&src).map_err(|_| format!("the app is missing {}", entry.path))?;
        let mut output = std::fs::File::create(&dst).map_err(|e| format!("{dst:?}: {e}"))?;
        let mut hasher = sha2::Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        let mut size = 0u64;
        loop {
            let n = input.read(&mut buf).map_err(|e| e.kind().to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            output
                .write_all(&buf[..n])
                .map_err(|e| format!("{dst:?}: {e}"))?;
            size += n as u64;
        }
        output.flush().map_err(|e| format!("{dst:?}: {e}"))?;
        if size != entry.size || hex::encode(hasher.finalize()) != entry.sha256 {
            return Err(format!("{} does not match the app's manifest", entry.path));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = if entry.executable { 0o755 } else { 0o644 };
            std::fs::set_permissions(&dst, std::fs::Permissions::from_mode(mode))
                .map_err(|e| format!("{dst:?}: {e}"))?;
        }
    }
    let raw = std::fs::read(from.join(MANIFEST)).map_err(|e| e.kind().to_string())?;
    std::fs::write(to.join(MANIFEST), raw).map_err(|e| format!("{to:?}: {e}"))?;
    Ok(())
}

/// Remove every installed version but `keep`, and any staging folder a crash
/// left. Best-effort.
pub fn prune(root: &Path, keep: &[&Path]) {
    if let Ok(entries) = std::fs::read_dir(root.join("versions")) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if !keep.iter().any(|k| *k == path) {
                let _ = std::fs::remove_dir_all(&path);
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.filter_map(Result::ok) {
            if entry.file_name().to_string_lossy().starts_with(".staging-") {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// Remove every runtime (uninstall). Never anything outside `root`.
pub fn remove_all(root: &Path) -> Result<(), String> {
    if !root.ends_with(RESOURCE_DIR) {
        return Err("refusing to remove a folder that is not a bridge runtime root".into());
    }
    match std::fs::remove_dir_all(root) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{root:?}: {e}")),
    }
}

/// Compare two bridge versions (`0.0.53-alpha.20261022`): the numeric core
/// first, then a release above its own pre-release, then the pre-release
/// identifiers numerically where both are numbers.
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let split = |v: &str| -> (Vec<u64>, Option<String>) {
        let v = v.trim().trim_start_matches('v');
        let v = v.split('+').next().unwrap_or(v);
        let (core, pre) = match v.split_once('-') {
            Some((c, p)) => (c, Some(p.to_string())),
            None => (v, None),
        };
        (
            core.split('.').map(|n| n.parse().unwrap_or(0)).collect(),
            pre,
        )
    };
    let (ac, ap) = split(a);
    let (bc, bp) = split(b);
    for i in 0..ac.len().max(bc.len()) {
        let (x, y) = (
            ac.get(i).copied().unwrap_or(0),
            bc.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x.cmp(&y);
        }
    }
    match (ap, bp) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => {
            let xs: Vec<&str> = x.split('.').collect();
            let ys: Vec<&str> = y.split('.').collect();
            for i in 0..xs.len().max(ys.len()) {
                match (xs.get(i), ys.get(i)) {
                    (None, Some(_)) => return Ordering::Less,
                    (Some(_), None) => return Ordering::Greater,
                    (Some(p), Some(q)) => {
                        let order = match (p.parse::<u64>(), q.parse::<u64>()) {
                            (Ok(m), Ok(n)) => m.cmp(&n),
                            _ => p.cmp(q),
                        };
                        if order != Ordering::Equal {
                            return order;
                        }
                    }
                    (None, None) => break,
                }
            }
            Ordering::Equal
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny runtime folder with a manifest that hashes it.
    fn fake_runtime(dir: &Path, version: &str) -> Manifest {
        let files = [
            ("node/bin/node", b"#!/bin/sh\necho node\n".as_slice(), true),
            (
                "app/node_modules/uxnan-bridge/dist/src/cli.js",
                b"console.log('bridge')\n".as_slice(),
                false,
            ),
        ];
        let mut entries = Vec::new();
        for (path, body, executable) in files {
            let abs = dir.join(path);
            std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
            std::fs::write(&abs, body).unwrap();
            entries.push(FileEntry {
                path: path.into(),
                size: body.len() as u64,
                sha256: hex::encode(sha2::Sha256::digest(body)),
                executable,
            });
        }
        let manifest = Manifest {
            kind: "bundled".into(),
            bridge_version: version.into(),
            node_version: "24.22.2".into(),
            triple: "aarch64-apple-darwin".into(),
            node: "node/bin/node".into(),
            cli: "app/node_modules/uxnan-bridge/dist/src/cli.js".into(),
            files: entries,
        };
        std::fs::write(
            dir.join(MANIFEST),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();
        manifest
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("uxnan-rt-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn paths_from_a_manifest_must_stay_inside_the_runtime() {
        assert!(safe_relative("app/node_modules/x.js").is_some());
        assert!(safe_relative("../etc/passwd").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        assert!(safe_relative("a/../../b").is_none());
        assert!(safe_relative("").is_none());
    }

    #[test]
    fn a_manifest_is_checked_before_anything_is_trusted() {
        let bundle = temp("parse");
        let manifest = fake_runtime(&bundle, "0.0.54");
        assert_eq!(read_manifest(&bundle).unwrap(), manifest);
        let raw = std::fs::read_to_string(bundle.join(MANIFEST)).unwrap();
        assert!(parse_manifest(&raw.replace("\"bundled\"", "\"npm\"")).is_err());
        assert!(
            parse_manifest(&raw.replace("node/bin/node\",\"size", "../node\",\"size")).is_err()
        );
        assert!(parse_manifest(&raw.replace("0.0.54", "../x")).is_err());
        assert!(parse_manifest("{}").is_err());
        let _ = std::fs::remove_dir_all(bundle);
    }

    #[test]
    fn installing_copies_and_verifies_every_file_and_reuses_a_good_copy() {
        let (bundle, root) = (temp("bundle"), temp("root"));
        fake_runtime(&bundle, "0.0.54");
        let runtime = install(&bundle, &root).unwrap();
        assert_eq!(runtime.bridge_version, "0.0.54");
        assert!(runtime.dir.ends_with("versions/0.0.54+node24.22.2"));
        assert!(runtime.node.is_file() && runtime.cli.is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&runtime.node)
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o755);
        }
        // Installed again: the same folder, untouched.
        let again = install(&bundle, &root).unwrap();
        assert_eq!(again, runtime);
        assert_eq!(installed(&root), vec![runtime.clone()]);
        // A damaged copy is replaced, not reused.
        std::fs::write(&runtime.cli, "tampered").unwrap();
        let repaired = install(&bundle, &root).unwrap();
        assert_eq!(
            std::fs::read_to_string(&repaired.cli).unwrap(),
            "console.log('bridge')\n"
        );
        let _ = std::fs::remove_dir_all(bundle);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_bundle_that_does_not_match_its_manifest_installs_nothing() {
        let (bundle, root) = (temp("bad"), temp("badroot"));
        fake_runtime(&bundle, "0.0.54");
        std::fs::write(bundle.join("node/bin/node"), "something else").unwrap();
        assert!(install(&bundle, &root).is_err());
        assert!(installed(&root).is_empty());
        // No staging folder is left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with(".staging-"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = std::fs::remove_dir_all(bundle);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn pruning_keeps_what_it_is_told_and_removing_refuses_a_foreign_folder() {
        let root = temp("prune").join(RESOURCE_DIR);
        for v in ["0.0.52", "0.0.53", "0.0.54"] {
            let bundle = temp(v);
            fake_runtime(&bundle, v);
            install(&bundle, &root).unwrap();
            let _ = std::fs::remove_dir_all(bundle);
        }
        let all = installed(&root);
        assert_eq!(
            all.iter()
                .map(|r| r.bridge_version.as_str())
                .collect::<Vec<_>>(),
            ["0.0.54", "0.0.53", "0.0.52"]
        );
        prune(&root, &[&all[0].dir, &all[1].dir]);
        assert_eq!(installed(&root).len(), 2);
        assert!(is_inside(&root, &all[0].cli));
        assert!(!is_inside(
            &root,
            Path::new("/usr/local/lib/node_modules/uxnan-bridge/dist/src/cli.js")
        ));
        assert!(remove_all(Path::new("/tmp/not-a-runtime")).is_err());
        remove_all(&root).unwrap();
        assert!(!root.exists());
        remove_all(&root).unwrap();
    }

    #[test]
    fn versions_order_like_the_bridge_releases_them() {
        use std::cmp::Ordering::*;
        assert_eq!(compare_versions("0.0.54", "0.0.53"), Greater);
        assert_eq!(
            compare_versions("0.0.53-alpha.20261022", "0.0.53-alpha.20261001"),
            Greater
        );
        assert_eq!(compare_versions("0.0.53", "0.0.53-alpha.20261022"), Greater);
        assert_eq!(compare_versions("0.0.53-alpha.9", "0.0.53-alpha.10"), Less);
        assert_eq!(compare_versions("v1.2.3", "1.2.3"), Equal);
        assert_eq!(compare_versions("0.1.0", "0.0.99"), Greater);
    }

    /// The runtime `scripts/build-bridge-runtime.mjs --build` assembled, copied
    /// to a scratch folder and run from there (`version`, `service-status`
    /// with a scratch HOME — nothing is registered). Needs the runtime built.
    #[tokio::test]
    #[ignore = "needs src-tauri/bridge-runtime built (scripts/build-bridge-runtime.mjs --build)"]
    async fn live_the_built_runtime_installs_verified_and_runs_from_its_copy() {
        let bundle = Path::new(env!("CARGO_MANIFEST_DIR")).join(RESOURCE_DIR);
        let carried = bundled(&bundle).expect("a built runtime");
        let root = temp("live").join(RESOURCE_DIR);
        let started = std::time::Instant::now();
        let runtime = install(&bundle, &root).expect("installs");
        eprintln!(
            "installed {} in {:?}",
            runtime.bridge_version,
            started.elapsed()
        );
        assert_eq!(runtime.bridge_version, carried.bridge_version);
        let cli = super::super::service::BridgeCli::runtime(&runtime);
        assert_eq!(
            super::super::service::version(&cli).await.as_deref(),
            Some(carried.bridge_version.as_str())
        );
        remove_all(&root).unwrap();
    }

    #[test]
    fn the_runtime_folder_is_per_user_and_outside_the_bridge_state() {
        let root = runtime_root().expect("a home directory");
        assert!(root.ends_with(RESOURCE_DIR));
        assert!(!root.to_string_lossy().contains(".uxnan"));
    }
}
