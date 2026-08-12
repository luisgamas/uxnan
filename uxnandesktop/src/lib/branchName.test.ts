import { describe, expect, it } from "vitest";
import { branchSlug, randomBranchName, taskBranchName, uniqueBranchName } from "./branchName";

// The worktree FOLDER layout is not tested here any more: it is owned by the
// backend (`src-tauri/src/worktreeloc.rs`, whose tests cover the sanitizing,
// the managed root, WSL mirroring and the collision suffixes), and the dialogs
// only render the preview it returns.

describe("branchSlug", () => {
  it("lowercases and joins words with single dashes", () => {
    expect(branchSlug("Fix the login")).toBe("fix-the-login");
  });

  it("collapses punctuation runs and trims the edges", () => {
    expect(branchSlug("  Fix: the login!!  ")).toBe("fix-the-login");
  });

  it("folds accents rather than dropping the whole word", () => {
    expect(branchSlug("Añadir sesión")).toBe("anadir-sesion");
  });

  it("caps the length without leaving a trailing dash", () => {
    expect(branchSlug("a".repeat(80))).toHaveLength(50);
    expect(branchSlug("aaaa bbbb cccc dddd", 10)).toBe("aaaa-bbbb");
  });

  it("returns empty for a title with nothing sluggable", () => {
    expect(branchSlug("!!! ???")).toBe("");
  });

});

// The launcher feeds this a whole sentence typed by a human, not a title pulled
// from an API — longer, accented, punctuated, sometimes with emoji.
describe("taskBranchName", () => {
  it("turns a Spanish sentence into a usable branch name", () => {
    expect(taskBranchName("Agregar un backoff de reconexión al adaptador de Zero")).toBe(
      "agregar-un-backoff-de-reconexion-al-adaptador-de",
    );
  });

  it("trims back to a whole word instead of cutting one in half", () => {
    // `branchSlug` alone yields "…-al-adaptador-de-z", which reads like a bug and
    // whose folder inherits it.
    expect(
      branchSlug("Agregar un backoff de reconexión al adaptador de Zero"),
    ).toMatch(/-de-z$/);
    expect(taskBranchName("Agregar un backoff de reconexión al adaptador de Zero")).not.toMatch(
      /-z$/,
    );
  });

  it("leaves a short task exactly as slugged", () => {
    expect(taskBranchName("Arreglar el login")).toBe("arreglar-el-login");
  });

  it("survives emoji and stray symbols mid-sentence", () => {
    expect(taskBranchName("Arreglar el login 🔐 (urgente!)")).toBe("arreglar-el-login-urgente");
  });

  it("uniquifies against the branches already there", () => {
    expect(taskBranchName("Arreglar el login", ["arreglar-el-login"])).toBe(
      "arreglar-el-login-2",
    );
  });

  it("yields nothing for a task that is only punctuation, so the field clears", () => {
    expect(taskBranchName("¿¿¿ !!! ---")).toBe("");
    expect(taskBranchName("   ")).toBe("");
  });

  it("never ends on a dash", () => {
    for (const task of [
      "Revisar el flujo de pago de la tienda online completo",
      "a".repeat(80),
      "Un texto con - guiones - sueltos -",
    ]) {
      expect(taskBranchName(task)).not.toMatch(/-$/);
    }
  });
});

describe("uniqueBranchName", () => {
  it("returns the base untouched when it's free", () => {
    expect(uniqueBranchName("wt/brave-otter", ["other"])).toBe("wt/brave-otter");
  });

  it("appends the first free numeric suffix when taken", () => {
    expect(uniqueBranchName("feature", ["feature"])).toBe("feature-2");
    expect(uniqueBranchName("feature", ["feature", "feature-2", "feature-3"])).toBe(
      "feature-4",
    );
  });
});

describe("randomBranchName", () => {
  it("produces a wt/<adjective>-<noun> name", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(randomBranchName()).toMatch(/^wt\/[a-z]+-[a-z]+$/);
    }
  });

  it("never returns a name already taken", () => {
    // Feed back the last result as taken; the suffix guarantees a fresh name.
    const taken = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      const name = randomBranchName(taken);
      expect(taken.has(name)).toBe(false);
      taken.add(name);
    }
  });
});
