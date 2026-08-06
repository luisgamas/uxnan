/**
 * Version file adapters: pure `read` / `write` over a file's *text*.
 *
 * Every one of them exists because a real release shipped wrong when a file was
 * missed. `uxnandesktop/package-lock.json` sat at `0.0.2` while the app shipped
 * `0.0.4`, because the release workflow re-applies the version at build time
 * with `--allow-same-version` — which hides an un-bumped committed lock. So the
 * bump writes every file and then reads them all back, and a mismatch is an
 * error rather than a surprise three releases later.
 *
 * Text in, text out: no file I/O here, so every rule is testable on a string.
 */

/** `package.json`, `tauri.conf.json` — a top-level `"version"`. */
export const json = {
  read: (text) => JSON.parse(text).version ?? null,
  write: (text, version) => {
    const data = JSON.parse(text);
    data.version = version;
    // Keep the file's own trailing newline habit.
    return JSON.stringify(data, null, 2) + (text.endsWith('\n') ? '\n' : '');
  },
};

/** A component's entry inside the **root** `package-lock.json`. */
export const lockWorkspace = {
  read: (text, { pkgPath }) => JSON.parse(text).packages?.[pkgPath]?.version ?? null,
  write: (text, version, { pkgPath }) => {
    const data = JSON.parse(text);
    if (!data.packages?.[pkgPath]) {
      throw new Error(`package-lock.json has no entry for "${pkgPath}"`);
    }
    data.packages[pkgPath].version = version;
    return JSON.stringify(data, null, 2) + (text.endsWith('\n') ? '\n' : '');
  },
};

/** A standalone `package-lock.json` (the desktop's own): root + `packages[""]`. */
export const lockRoot = {
  read: (text) => JSON.parse(text).version ?? null,
  write: (text, version) => {
    const data = JSON.parse(text);
    data.version = version;
    if (data.packages?.['']) data.packages[''].version = version;
    return JSON.stringify(data, null, 2) + (text.endsWith('\n') ? '\n' : '');
  },
};

/** `[package] version = "…"` — the first one, which is the crate's own. */
export const cargoToml = {
  read: (text) => /^\s*version\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null,
  write: (text, version) => {
    let replaced = false;
    return text.replace(/^(\s*version\s*=\s*")([^"]+)(")/m, (match, head, _old, tail) => {
      if (replaced) return match;
      replaced = true;
      return `${head}${version}${tail}`;
    });
  },
};

/** The named crate's entry in `Cargo.lock`. */
export const cargoLock = {
  read: (text, { crate }) => blockOf(text, crate)?.version ?? null,
  write: (text, version, { crate }) => {
    const block = blockOf(text, crate);
    if (!block) throw new Error(`Cargo.lock has no [[package]] named "${crate}"`);
    const updated = block.raw.replace(/^(version\s*=\s*")([^"]+)(")/m, `$1${version}$3`);
    return text.slice(0, block.start) + updated + text.slice(block.end);
  },
};

function blockOf(text, crate) {
  const blocks = [...text.matchAll(/\[\[package\]\]\n(?:[^\n]*\n)*?(?:\n|$)/g)];
  for (const match of blocks) {
    const raw = match[0];
    if (new RegExp(`^name\\s*=\\s*"${crate}"$`, 'm').test(raw)) {
      return {
        raw,
        start: match.index,
        end: match.index + raw.length,
        version: /^version\s*=\s*"([^"]+)"/m.exec(raw)?.[1] ?? null,
      };
    }
  }
  return null;
}

/** Flutter's `pubspec.yaml`: `version: 0.0.18-alpha.20260805+20260805`. */
export const pubspec = {
  read: (text) => /^version:\s*(\S+)/m.exec(text)?.[1] ?? null,
  write: (text, version) => text.replace(/^(version:\s*)(\S+)/m, `$1${version}`),
};

export const ADAPTERS = {
  json,
  'lock-workspace': lockWorkspace,
  'lock-root': lockRoot,
  'cargo-toml': cargoToml,
  'cargo-lock': cargoLock,
  pubspec,
};

export function adapterFor(name) {
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`unknown version-file adapter: ${name}`);
  return adapter;
}
