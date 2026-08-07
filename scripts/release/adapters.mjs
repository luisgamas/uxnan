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

/**
 * Replaces a JSON string value **in place**, leaving every other byte alone.
 *
 * Re-serialising with `JSON.stringify` is the obvious implementation, and it is
 * wrong: it reformats whatever the author wrote. The first real use of this
 * tooling turned `"dangerousDisableAssetCspModification": ["style-src"]` in
 * `tauri.conf.json` into a three-line array — churn inside a security block, in
 * a release commit. A version bump reformats nothing.
 *
 * `indent` anchors the key to its nesting level, so a top-level `"version"` is
 * never confused with one belonging to a dependency. When the pattern does not
 * match — a minified file, say — the caller falls back to re-serialising, and
 * `applyVersion` reads the value back either way.
 */
function replaceValue(text, key, version, { indent = '  ' } = {}) {
  const pattern = new RegExp(`^(${indent}"${key}"\\s*:\\s*")([^"]*)(")`, 'm');
  return pattern.test(text) ? text.replace(pattern, `$1${version}$3`) : null;
}

function reserialise(text, mutate) {
  const data = JSON.parse(text);
  mutate(data);
  return JSON.stringify(data, null, 2) + (text.endsWith('\n') ? '\n' : '');
}

/** `package.json`, `tauri.conf.json` — a top-level `"version"`. */
export const json = {
  read: (text) => JSON.parse(text).version ?? null,
  write: (text, version) =>
    replaceValue(text, 'version', version) ??
    reserialise(text, (data) => {
      data.version = version;
    }),
};

/** A component's entry inside the **root** `package-lock.json`. */
export const lockWorkspace = {
  read: (text, { pkgPath }) => JSON.parse(text).packages?.[pkgPath]?.version ?? null,
  write: (text, version, { pkgPath }) => {
    if (!JSON.parse(text).packages?.[pkgPath]) {
      throw new Error(`package-lock.json has no entry for "${pkgPath}"`);
    }
    // The entry sits one level inside `packages`, so its keys are indented by 6.
    const block = new RegExp(`("${pkgPath}"\\s*:\\s*\\{)([\\s\\S]*?)(\\n    \\})`);
    const found = block.exec(text);
    const bumped = found && replaceValue(found[2], 'version', version, { indent: '      ' });
    if (bumped) return text.replace(block, `$1${bumped}$3`);

    return reserialise(text, (data) => {
      data.packages[pkgPath].version = version;
    });
  },
};

/** A standalone `package-lock.json` (the desktop's own): root + `packages[""]`. */
export const lockRoot = {
  read: (text) => JSON.parse(text).version ?? null,
  write: (text, version) => {
    // Both copies, or the next install re-resolves the root package.
    const top = replaceValue(text, 'version', version);
    const block = /("" *: *\{)([\s\S]*?)(\n    \})/;
    const found = top && block.exec(top);
    const bumped = found && replaceValue(found[2], 'version', version, { indent: '      ' });
    if (top && bumped) return top.replace(block, `$1${bumped}$3`);

    return reserialise(text, (data) => {
      data.version = version;
      if (data.packages?.['']) data.packages[''].version = version;
    });
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
