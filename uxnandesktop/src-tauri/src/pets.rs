//! Pets — sprite-animated companions that mirror agent state.
//!
//! A pet is a folder holding a manifest (`pet.json`, or `avatar.json`) and one
//! spritesheet image. The manifest schema is deliberately **the same one the
//! Codex CLI uses**, so packs made for it — including the community galleries —
//! load here unmodified:
//!
//! ```json
//! {
//!   "id": "…", "displayName": "…", "description": "…",
//!   "spritesheetPath": "spritesheet.webp",
//!   "frame": { "width": 192, "height": 208, "columns": 8, "rows": 9 },
//!   "animations": { "idle": { "frames": [0,1], "fps": 8, "loop": true, "fallback": "idle" } }
//! }
//! ```
//!
//! uxnan ships **none** of that third-party artwork: the only bundled pet is our
//! own (`static/pets/`, resolved frontend-side), and everything else arrives by
//! the user importing a folder they already have — typically `~/.codex/pets/`.
//!
//! This module owns the *installed* pets under `<app-data>/pets/`: listing,
//! importing (a validating copy — never a blind directory clone), reading a
//! sheet as a data URL, and deleting. Rendering and animation live in the
//! frontend (`src/lib/pets/`).
//!
//! Everything crossing this boundary is treated as hostile input: ids are
//! validated against traversal, the sheet path must be a bare file name, the
//! declared grid is bounded, and the bytes must actually sniff as an image.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Directory under `<app-data>/` holding imported pets, one folder per pet.
const PETS_DIR: &str = "pets";

/// Manifest file names we accept, in priority order (Codex accepts both).
const MANIFEST_NAMES: [&str; 2] = ["pet.json", "avatar.json"];

/// Hard ceiling for a spritesheet. The public Codex upload limit is 20 MiB; we
/// allow a little headroom and refuse anything beyond, so a hostile or corrupt
/// pack can't be base64-inlined into the webview as a huge blob.
const MAX_SHEET_BYTES: u64 = 24 * 1024 * 1024;

/// Bounds on the declared frame grid. Generous enough for any real pack, tight
/// enough that a bogus manifest can't make the frontend allocate absurd frames.
const MAX_FRAME_DIM: u32 = 2048;
const MAX_GRID: u32 = 256;

/// The frame grid: one sheet holds `columns * rows` frames of `width * height`,
/// laid out row-major.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSpec {
    pub width: u32,
    pub height: u32,
    pub columns: u32,
    pub rows: u32,
}

/// One named animation: which frames, how fast, and what to fall back to when a
/// pack doesn't define the animation a given state asks for.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationSpec {
    #[serde(default)]
    pub frames: Vec<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    /// `loop` is a Rust keyword, so the field is renamed explicitly rather than
    /// left to the struct-wide camelCase rule.
    #[serde(rename = "loop", default, skip_serializing_if = "Option::is_none")]
    pub loop_animation: Option<bool>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub fallback: String,
}

/// A pet manifest exactly as it appears on disk. Every field is optional so a
/// minimal third-party pack (just a sheet) still loads; the frontend applies the
/// documented defaults.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetManifest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spritesheet_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<FrameSpec>,
    #[serde(default)]
    pub animations: HashMap<String, AnimationSpec>,
}

/// An installed pet, as handed to the frontend. The sheet itself is *not*
/// included — it is fetched lazily by [`read_sheet`] so listing stays cheap
/// however many pets are installed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPet {
    /// Folder name; also the stable id the frontend selects a pet by.
    pub id: String,
    pub manifest: PetManifest,
    /// Absolute directory, so the UI can reveal it in the file manager.
    pub dir: String,
    /// Where this pet came from, for the provenance notice in the import UI.
    pub origin: String,
}

/// A pet found in an external folder that could be imported (not installed yet).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportablePet {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub dir: String,
    /// True when a pet with this id is already installed (the UI offers to
    /// replace rather than silently clobbering).
    pub installed: bool,
}

// ------------------------------------------------------------------ paths

/// `<app-data>/pets`, created on demand.
pub fn pets_root(data_dir: &Path) -> PathBuf {
    data_dir.join(PETS_DIR)
}

/// `~/.codex/pets` — where the Codex CLI (and `codex-pet-cli`) install pets.
/// The single most useful import source, since a user who wants pets here
/// usually already has some there.
pub fn codex_pets_dir() -> Option<PathBuf> {
    Some(crate::agent_hooks::home_dir()?.join(".codex").join("pets"))
}

/// Validate a pet id / folder name. Rejects traversal, separators, hidden
/// entries and anything that isn't a plain slug, so an id from a manifest can
/// never escape the pets root.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id != "."
        && id != ".."
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Resolve an installed pet's directory, refusing an invalid id outright.
fn pet_dir(data_dir: &Path, id: &str) -> Result<PathBuf, AppError> {
    if !valid_id(id) {
        return Err(AppError::Invalid(format!("invalid pet id: {id}")));
    }
    Ok(pets_root(data_dir).join(id))
}

/// The manifest inside `dir`, whichever accepted name it uses.
fn manifest_path(dir: &Path) -> Option<PathBuf> {
    MANIFEST_NAMES
        .iter()
        .map(|n| dir.join(n))
        .find(|p| p.is_file())
}

// --------------------------------------------------------------- manifest

/// Parse and sanity-check a manifest. Unknown fields are ignored (forward
/// compatibility with newer packs); the grid is bounded; frame indices that
/// point outside the sheet are dropped rather than failing the whole pack, so
/// one bad animation never costs the user the pet.
fn load_manifest(dir: &Path) -> Result<PetManifest, AppError> {
    let path = manifest_path(dir).ok_or_else(|| {
        AppError::Invalid(format!(
            "missing pet.json or avatar.json in {}",
            dir.display()
        ))
    })?;
    let raw = std::fs::read_to_string(&path)?;
    let mut manifest: PetManifest = serde_json::from_str(&raw)?;

    if let Some(frame) = manifest.frame {
        let bad = frame.width == 0
            || frame.height == 0
            || frame.columns == 0
            || frame.rows == 0
            || frame.width > MAX_FRAME_DIM
            || frame.height > MAX_FRAME_DIM
            || frame.columns > MAX_GRID
            || frame.rows > MAX_GRID;
        if bad {
            return Err(AppError::Invalid(
                "the pet's frame grid is missing or out of range".into(),
            ));
        }
        let total = (frame.columns * frame.rows) as usize;
        for anim in manifest.animations.values_mut() {
            anim.frames.retain(|&i| i < total);
        }
    }
    manifest.animations.retain(|_, a| !a.frames.is_empty());
    Ok(manifest)
}

/// The sheet file a manifest points at. Must be a bare file name living beside
/// the manifest — a path with separators or `..` is refused, never resolved.
fn sheet_path(dir: &Path, manifest: &PetManifest) -> Result<PathBuf, AppError> {
    if let Some(name) = manifest.spritesheet_path.as_deref() {
        let name = name.trim();
        if name.is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name.contains("..")
            || Path::new(name).is_absolute()
        {
            return Err(AppError::Invalid(format!(
                "the pet's spritesheetPath must be a file name beside the manifest: {name}"
            )));
        }
        let p = dir.join(name);
        if p.is_file() {
            return Ok(p);
        }
        return Err(AppError::NotFound(format!(
            "spritesheet {name} is missing from the pet folder"
        )));
    }
    // No declared path: fall back to the conventional names, in the order the
    // ecosystem uses them.
    for name in ["spritesheet.webp", "spritesheet.png", "spritesheet.gif"] {
        let p = dir.join(name);
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(AppError::NotFound(
        "the pet folder has no spritesheet".into(),
    ))
}

// ------------------------------------------------------------------ public

/// Every installed pet, sorted by display name. A folder that fails to parse is
/// skipped rather than failing the whole listing — one broken pack must not hide
/// the rest of the library.
pub fn list(data_dir: &Path) -> Result<Vec<InstalledPet>, AppError> {
    let root = pets_root(data_dir);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(id) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !valid_id(id) {
            continue;
        }
        let Ok(manifest) = load_manifest(&path) else {
            continue;
        };
        if sheet_path(&path, &manifest).is_err() {
            continue;
        }
        let origin = std::fs::read_to_string(path.join("ORIGIN"))
            .ok()
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        out.push(InstalledPet {
            id: id.to_string(),
            manifest,
            dir: path.to_string_lossy().replace('\\', "/"),
            origin,
        });
    }
    out.sort_by(|a, b| {
        let an = a.manifest.display_name.as_deref().unwrap_or(&a.id);
        let bn = b.manifest.display_name.as_deref().unwrap_or(&b.id);
        an.to_lowercase().cmp(&bn.to_lowercase())
    });
    Ok(out)
}

/// Read an installed pet's spritesheet as a `data:<mime>;base64,…` URL.
///
/// Inlining in Rust (rather than pointing the webview at the file) keeps this
/// working regardless of the asset-protocol scope, exactly like the image
/// preview in [`crate::fs::read_data_url`]. Callers fetch this lazily, per pet.
pub fn read_sheet(data_dir: &Path, id: &str) -> Result<String, AppError> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    let dir = pet_dir(data_dir, id)?;
    let manifest = load_manifest(&dir)?;
    let sheet = sheet_path(&dir, &manifest)?;
    let meta = std::fs::metadata(&sheet)?;
    if meta.len() > MAX_SHEET_BYTES {
        return Err(AppError::Invalid(
            "the pet's spritesheet is too large".into(),
        ));
    }
    let bytes = std::fs::read(&sheet)?;
    let mime = crate::fs::sniff_image_mime(&bytes).ok_or_else(|| {
        AppError::Invalid("the pet's spritesheet is not a recognized image".into())
    })?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(&bytes)))
}

/// Scan a folder for importable pets. Accepts either a directory *of* pets
/// (e.g. `~/.codex/pets`) or a single pet folder, so the user can point the
/// picker at whichever they have.
pub fn scan(data_dir: &Path, source: &Path) -> Result<Vec<ImportablePet>, AppError> {
    if !source.is_dir() {
        return Err(AppError::NotFound(format!(
            "{} is not a folder",
            source.display()
        )));
    }
    let installed = pets_root(data_dir);
    let describe = |dir: &Path| -> Option<ImportablePet> {
        let manifest = load_manifest(dir).ok()?;
        sheet_path(dir, &manifest).ok()?;
        let folder = dir.file_name()?.to_str()?.to_string();
        let id = manifest
            .id
            .as_deref()
            .map(str::trim)
            .filter(|s| valid_id(s))
            .map(str::to_string)
            .unwrap_or(folder);
        if !valid_id(&id) {
            return None;
        }
        Some(ImportablePet {
            display_name: manifest.display_name.clone().unwrap_or_else(|| id.clone()),
            description: manifest.description.clone(),
            installed: installed.join(&id).is_dir(),
            dir: dir.to_string_lossy().replace('\\', "/"),
            id,
        })
    };

    // A single pet folder: return just that one.
    if manifest_path(source).is_some() {
        return Ok(describe(source).into_iter().collect());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(source)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.is_dir() {
            if let Some(pet) = describe(&path) {
                out.push(pet);
            }
        }
    }
    out.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(out)
}

/// Import one pet folder into `<app-data>/pets/<id>`.
///
/// This is a **validating copy, not a directory clone**: only the manifest and
/// the single spritesheet it references are copied, so importing an untrusted
/// pack can never drop scripts or arbitrary files into app data. `origin` is
/// recorded beside them purely so the UI can tell the user where a pet came
/// from (and that its artwork belongs to its author).
///
// FOR-DEV: generating a pet from a text description ("hatch") would sit here as
// a `pets_generate` sibling of `import`. Deferred: a usable pack needs ~72
// *consistent* frames on one sheet, which needs a CLI with real image-generation
// output plus a prompt pipeline that keeps the character stable — the one-shot
// runner in `aicommit.rs` can't do it. Import already covers owning several pets,
// so this is additive. See FOR-DEV.md → "Pets — follow-ups".
pub fn import(
    data_dir: &Path,
    source: &Path,
    origin: &str,
    overwrite: bool,
) -> Result<InstalledPet, AppError> {
    let manifest = load_manifest(source)?;
    let sheet = sheet_path(source, &manifest)?;

    let folder = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let id = manifest
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| valid_id(s))
        .map(str::to_string)
        .unwrap_or(folder);
    let dest = pet_dir(data_dir, &id)?;

    if dest.exists() {
        if !overwrite {
            return Err(AppError::Invalid(format!(
                "a pet named {id} is already installed"
            )));
        }
        std::fs::remove_dir_all(&dest)?;
    }

    let meta = std::fs::metadata(&sheet)?;
    if meta.len() > MAX_SHEET_BYTES {
        return Err(AppError::Invalid(
            "the pet's spritesheet is too large".into(),
        ));
    }
    let bytes = std::fs::read(&sheet)?;
    if crate::fs::sniff_image_mime(&bytes).is_none() {
        return Err(AppError::Invalid(
            "the pet's spritesheet is not a recognized image".into(),
        ));
    }

    std::fs::create_dir_all(&dest)?;
    // Normalize on `pet.json` + the sheet's original file name, and write the
    // manifest we actually parsed (so the stored copy is always the sanitized,
    // frame-checked one rather than whatever arbitrary JSON came in).
    let sheet_name = sheet
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("spritesheet")
        .to_string();
    let mut stored = manifest.clone();
    stored.id = Some(id.clone());
    stored.spritesheet_path = Some(sheet_name.clone());
    std::fs::write(
        dest.join("pet.json"),
        serde_json::to_string_pretty(&stored)?,
    )?;
    std::fs::write(dest.join(&sheet_name), &bytes)?;
    if !origin.trim().is_empty() {
        let _ = std::fs::write(dest.join("ORIGIN"), origin.trim());
    }

    Ok(InstalledPet {
        id,
        manifest: stored,
        dir: dest.to_string_lossy().replace('\\', "/"),
        origin: origin.trim().to_string(),
    })
}

/// Delete an installed pet. Idempotent: removing one that's already gone is not
/// an error, so a stale UI can't produce a spurious failure.
pub fn delete(data_dir: &Path, id: &str) -> Result<(), AppError> {
    let dir = pet_dir(data_dir, id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal valid PNG bytes (1x1) — enough for the MIME sniff.
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52,
    ];

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("uxnan-pets-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_pet(dir: &Path, id: &str, json: &str) -> PathBuf {
        let pet = dir.join(id);
        std::fs::create_dir_all(&pet).unwrap();
        std::fs::write(pet.join("pet.json"), json).unwrap();
        std::fs::write(pet.join("spritesheet.png"), PNG).unwrap();
        pet
    }

    const MANIFEST: &str = r#"{
        "id": "tester",
        "displayName": "Tester",
        "description": "a test pet",
        "spritesheetPath": "spritesheet.png",
        "frame": { "width": 192, "height": 208, "columns": 8, "rows": 9 },
        "animations": { "idle": { "frames": [0, 1], "fps": 8, "loop": true, "fallback": "idle" } }
    }"#;

    #[test]
    fn rejects_ids_that_could_escape_the_pets_root() {
        assert!(valid_id("stacky"));
        assert!(valid_id("null-signal"));
        assert!(!valid_id(""));
        assert!(!valid_id("."));
        assert!(!valid_id(".."));
        assert!(!valid_id(".hidden"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("a\\b"));
        assert!(!valid_id("../escape"));
        assert!(!valid_id(&"x".repeat(65)));
    }

    #[test]
    fn parses_a_codex_style_manifest() {
        let root = tmp();
        let pet = write_pet(&root, "tester", MANIFEST);
        let m = load_manifest(&pet).unwrap();
        assert_eq!(m.id.as_deref(), Some("tester"));
        assert_eq!(m.display_name.as_deref(), Some("Tester"));
        let frame = m.frame.unwrap();
        assert_eq!((frame.width, frame.columns, frame.rows), (192, 8, 9));
        let idle = &m.animations["idle"];
        assert_eq!(idle.frames, vec![0, 1]);
        assert_eq!(idle.loop_animation, Some(true));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn drops_frame_indices_outside_the_grid() {
        let root = tmp();
        // A 1x2 grid = 2 frames; index 9 cannot exist.
        let pet = write_pet(
            &root,
            "small",
            r#"{"frame":{"width":8,"height":8,"columns":1,"rows":2},
                "animations":{"idle":{"frames":[0,9]},"broken":{"frames":[42]}}}"#,
        );
        let m = load_manifest(&pet).unwrap();
        assert_eq!(m.animations["idle"].frames, vec![0]);
        // An animation left with no valid frames is dropped entirely.
        assert!(!m.animations.contains_key("broken"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_a_spritesheet_path_that_escapes_the_folder() {
        let root = tmp();
        let pet = write_pet(
            &root,
            "evil",
            r#"{"spritesheetPath":"../../secret.png","frame":{"width":8,"height":8,"columns":1,"rows":1}}"#,
        );
        let m = load_manifest(&pet).unwrap();
        assert!(sheet_path(&pet, &m).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn imports_only_the_manifest_and_sheet() {
        let root = tmp();
        let src = write_pet(&root, "tester", MANIFEST);
        // A hostile extra file that must NOT be copied.
        std::fs::write(src.join("evil.cmd"), "format c:").unwrap();
        let data = root.join("appdata");

        let pet = import(&data, &src, "Codex (~/.codex/pets)", false).unwrap();
        assert_eq!(pet.id, "tester");
        let dest = pets_root(&data).join("tester");
        assert!(dest.join("pet.json").is_file());
        assert!(dest.join("spritesheet.png").is_file());
        assert!(!dest.join("evil.cmd").exists());
        assert_eq!(
            std::fs::read_to_string(dest.join("ORIGIN")).unwrap(),
            "Codex (~/.codex/pets)"
        );

        // Listing sees it, and the sheet inlines as a PNG data URL.
        let listed = list(&data).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "tester");
        assert!(read_sheet(&data, "tester")
            .unwrap()
            .starts_with("data:image/png;base64,"));

        // A second import refuses unless told to overwrite.
        assert!(import(&data, &src, "", false).is_err());
        assert!(import(&data, &src, "", true).is_ok());

        delete(&data, "tester").unwrap();
        assert!(list(&data).unwrap().is_empty());
        // Deleting again is a no-op, not an error.
        delete(&data, "tester").unwrap();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scans_a_directory_of_pets_and_a_single_pet_folder() {
        let root = tmp();
        let src = root.join("src");
        std::fs::create_dir_all(&src).unwrap();
        write_pet(&src, "tester", MANIFEST);
        write_pet(&src, "second", r#"{"displayName":"Second"}"#);
        // Not a pet: no manifest. Must be ignored, not fail the scan.
        std::fs::create_dir_all(src.join("junk")).unwrap();
        let data = root.join("appdata");

        let found = scan(&data, &src).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].display_name, "Second");
        assert!(!found[0].installed);

        // Pointing at a single pet folder works too.
        let one = scan(&data, &src.join("tester")).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].id, "tester");
        std::fs::remove_dir_all(&root).ok();
    }

    /// The shape every real community pack ships: an `avatar.json` manifest and
    /// a **WebP** spritesheet. If either were rejected, none of the ecosystem's
    /// pets would import — so this pins the compatibility promise.
    #[test]
    fn imports_a_webp_pack_with_an_avatar_manifest() {
        // Minimal WebP header: "RIFF" + size + "WEBP".
        let webp = b"RIFF\x24\x00\x00\x00WEBPVP8 ";
        let root = tmp();
        let src = root.join("stacky");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("avatar.json"),
            r#"{"id":"stacky","displayName":"Stacky","spritesheetPath":"spritesheet.webp",
                "frame":{"width":192,"height":208,"columns":8,"rows":9},
                "animations":{"idle":{"frames":[0,1,2,3],"fps":8,"loop":true,"fallback":"idle"}}}"#,
        )
        .unwrap();
        std::fs::write(src.join("spritesheet.webp"), webp).unwrap();
        let data = root.join("appdata");

        let found = scan(&data, &src).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].display_name, "Stacky");

        let pet = import(&data, &src, "Codex", false).unwrap();
        assert_eq!(pet.id, "stacky");
        // The sheet keeps its own extension, and inlines with the right MIME.
        assert!(pets_root(&data)
            .join("stacky")
            .join("spritesheet.webp")
            .is_file());
        assert!(read_sheet(&data, "stacky")
            .unwrap()
            .starts_with("data:image/webp;base64,"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn skips_broken_packs_when_listing() {
        let root = tmp();
        let data = root.join("appdata");
        let pets = pets_root(&data);
        std::fs::create_dir_all(&pets).unwrap();
        write_pet(&pets, "good", MANIFEST);
        // Manifest present but no sheet → skipped.
        let bad = pets.join("bad");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join("pet.json"), MANIFEST).unwrap();

        let listed = list(&data).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "good");
        std::fs::remove_dir_all(&root).ok();
    }
}
