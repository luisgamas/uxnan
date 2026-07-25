import { describe, it, expect } from "vitest";
import {
  dedupeById,
  parsePet,
  resolveAnimation,
  framePosition,
  DEFAULT_FRAME,
  DEFAULT_FPS,
} from "./manifest";
import { frameAt, msUntilNextFrame, durationMs } from "./animator";
import { animationFor, aggregateState, wantsAttention } from "./status";

/** A manifest in the exact shape the ecosystem's packs ship. */
const CODEX_MANIFEST = {
  id: "stacky",
  displayName: "Stacky",
  description: "A balanced stack for deep work",
  spritesheetPath: "spritesheet.webp",
  frame: { width: 192, height: 208, columns: 8, rows: 9 },
  animations: {
    idle: { frames: [0, 1, 2, 3], fps: 8, loop: true, fallback: "idle" },
    running: { frames: [8, 9, 10, 11], fps: 12, loop: true, fallback: "idle" },
    waving: { frames: [40, 41], fps: 10, loop: false, fallback: "idle" },
  },
};

describe("parsePet", () => {
  it("reads a Codex-format manifest unchanged", () => {
    const pet = parsePet(CODEX_MANIFEST, "folder-name", { source: "imported", origin: "Codex" });
    expect(pet.id).toBe("stacky");
    expect(pet.displayName).toBe("Stacky");
    expect(pet.description).toBe("A balanced stack for deep work");
    expect(pet.spritesheetPath).toBe("spritesheet.webp");
    expect(pet.frame).toEqual({ width: 192, height: 208, columns: 8, rows: 9 });
    expect(pet.animations.running.frames).toEqual([8, 9, 10, 11]);
    expect(pet.animations.running.fps).toBe(12);
    expect(pet.animations.waving.loop).toBe(false);
    expect(pet.origin).toBe("Codex");
  });

  it("falls back to the folder name when the manifest declares no id", () => {
    const pet = parsePet({ displayName: "Nameless" }, "from-folder");
    expect(pet.id).toBe("from-folder");
    expect(pet.displayName).toBe("Nameless");
  });

  it("applies the conventional grid when the pack omits one", () => {
    const pet = parsePet({}, "bare");
    expect(pet.frame).toEqual(DEFAULT_FRAME);
    expect(pet.displayName).toBe("bare");
  });

  it("drops frame indices that fall outside the declared grid", () => {
    const pet = parsePet(
      {
        frame: { width: 8, height: 8, columns: 1, rows: 2 }, // 2 frames total
        animations: { idle: { frames: [0, 1, 9, -3] }, broken: { frames: [42] } },
      },
      "small",
    );
    expect(pet.animations.idle.frames).toEqual([0, 1]);
    // An animation left with nothing valid is dropped rather than kept empty.
    expect(pet.animations.broken).toBeUndefined();
  });

  it("flags whether the pack declared its own grid", () => {
    // A `hatch-pet` pack is typically just an id and a sheet — its real grid is
    // measured from the image later, so it must not be reported as explicit.
    const minimal = parsePet(
      { id: "uxni", displayName: "Uxni", spritesheetPath: "spritesheet.webp" },
      "uxni",
    );
    expect(minimal.frameExplicit).toBe(false);
    expect(minimal.frame).toEqual(DEFAULT_FRAME);

    expect(parsePet(CODEX_MANIFEST, "stacky").frameExplicit).toBe(true);
  });

  it("keeps frame indices when the grid is unknown", () => {
    // 11-row sheets exist; clipping against the assumed 8x9 would silently drop
    // every frame past 71 before the real size is known.
    const pet = parsePet({ animations: { idle: { frames: [0, 80, 87] } } }, "tall");
    expect(pet.frameExplicit).toBe(false);
    expect(pet.animations.idle.frames).toEqual([0, 80, 87]);
  });

  it("clamps an absurd grid instead of trusting it", () => {
    const pet = parsePet(
      { frame: { width: 99999, height: -4, columns: 100000, rows: 0 } },
      "hostile",
    );
    expect(pet.frame.width).toBeLessThanOrEqual(2048);
    expect(pet.frame.columns).toBeLessThanOrEqual(256);
    // Non-positive values fall back to the defaults rather than breaking layout.
    expect(pet.frame.height).toBe(DEFAULT_FRAME.height);
    expect(pet.frame.rows).toBe(DEFAULT_FRAME.rows);
  });

  it("defaults fps and loop when a pack leaves them out", () => {
    const pet = parsePet({ animations: { idle: { frames: [0, 1] } } }, "x");
    expect(pet.animations.idle.fps).toBe(DEFAULT_FPS);
    expect(pet.animations.idle.loop).toBe(true);
  });

  it("survives junk input without throwing", () => {
    expect(() => parsePet(null, "a")).not.toThrow();
    expect(() => parsePet("nonsense", "b")).not.toThrow();
    expect(parsePet({ animations: "not-an-object" }, "c").animations).toEqual({});
    expect(parsePet({ animations: { idle: { frames: "nope" } } }, "d").animations).toEqual({});
  });
});

describe("dedupeById", () => {
  it("keeps one entry per id, with the later (imported) pet winning", () => {
    // Importing a pack called `uxni` is how you replace the bundled mascot.
    const bundled = parsePet({ displayName: "Bundled" }, "uxni", { source: "builtin" });
    const imported = parsePet({ displayName: "Mine" }, "uxni", { source: "imported" });
    const other = parsePet({ displayName: "Other" }, "stacky", { source: "imported" });

    const merged = dedupeById([bundled, imported, other]);
    expect(merged).toHaveLength(2);
    expect(merged[0].displayName).toBe("Mine");
    expect(merged[0].source).toBe("imported");
    expect(merged[1].id).toBe("stacky");
  });

  it("never yields a duplicate key, which would break the keyed each block", () => {
    const dup = ["a", "b", "a", "c", "b"].map((id) => parsePet({}, id));
    const ids = dedupeById(dup).map((p) => p.id);
    expect(ids).toEqual(["a", "b", "c"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resolveAnimation", () => {
  const pet = parsePet(CODEX_MANIFEST, "stacky");

  it("returns the requested animation when the pack has it", () => {
    expect(resolveAnimation(pet, "running").frames).toEqual([8, 9, 10, 11]);
  });

  it("falls back to idle for a state the pack never defined", () => {
    // No "failed" animation in this pack — the pet still renders.
    expect(resolveAnimation(pet, "failed").frames).toEqual([0, 1, 2, 3]);
  });

  it("follows an explicit fallback chain", () => {
    const chained = parsePet(
      {
        animations: {
          idle: { frames: [0] },
          review: { frames: [5] },
          failed: { frames: [6], fallback: "review" },
        },
      },
      "chain",
    );
    expect(resolveAnimation(chained, "failed").frames).toEqual([6]);
  });

  it("terminates on a circular fallback chain", () => {
    // `a → b → a` must resolve, not hang.
    const looped = parsePet(
      {
        frame: { width: 8, height: 8, columns: 2, rows: 1 },
        animations: {
          a: { frames: [9], fallback: "b" }, // invalid index → empty → dropped
          b: { frames: [9], fallback: "a" },
        },
      },
      "loop",
    );
    const anim = resolveAnimation(looped, "a");
    expect(anim.frames.length).toBeGreaterThan(0);
  });

  it("synthesizes a walk of the whole sheet for a pack with no animations", () => {
    const bare = parsePet({ frame: { width: 8, height: 8, columns: 2, rows: 2 } }, "bare");
    expect(resolveAnimation(bare, "idle").frames).toEqual([0, 1, 2, 3]);
  });
});

describe("framePosition", () => {
  it("maps a frame index to its row-major pixel offset", () => {
    expect(framePosition(DEFAULT_FRAME, 0)).toEqual({ x: 0, y: 0 });
    expect(framePosition(DEFAULT_FRAME, 7)).toEqual({ x: 7 * 192, y: 0 });
    expect(framePosition(DEFAULT_FRAME, 8)).toEqual({ x: 0, y: 208 });
    expect(framePosition(DEFAULT_FRAME, 71)).toEqual({ x: 7 * 192, y: 8 * 208 });
  });

  it("wraps an out-of-range index instead of reading past the sheet", () => {
    expect(framePosition(DEFAULT_FRAME, 72)).toEqual({ x: 0, y: 0 });
    expect(framePosition(DEFAULT_FRAME, -1)).toEqual(framePosition(DEFAULT_FRAME, 71));
  });
});

describe("frameAt", () => {
  const looping = { frames: [4, 5, 6, 7], fps: 10, loop: true, fallback: "" };
  const once = { frames: [4, 5, 6], fps: 10, loop: false, fallback: "" };

  it("advances one frame per 1/fps and cycles when looping", () => {
    expect(frameAt(looping, 0)).toBe(4);
    expect(frameAt(looping, 99)).toBe(4);
    expect(frameAt(looping, 100)).toBe(5);
    expect(frameAt(looping, 350)).toBe(7);
    expect(frameAt(looping, 400)).toBe(4); // wrapped
    // Several cycles in: 920ms = 9 steps, 9 % 4 = 1 → the second frame.
    expect(frameAt(looping, 920)).toBe(5);
  });

  it("holds the last frame of a one-shot", () => {
    expect(frameAt(once, 200)).toBe(6);
    expect(frameAt(once, 10_000)).toBe(6);
  });

  it("is safe on empty and negative input", () => {
    expect(frameAt({ frames: [], fps: 8, loop: true, fallback: "" }, 500)).toBe(0);
    expect(frameAt(looping, -50)).toBe(4);
  });
});

describe("msUntilNextFrame", () => {
  const looping = { frames: [0, 1, 2], fps: 10, loop: true, fallback: "" };

  it("reports the time left on the current frame", () => {
    expect(msUntilNextFrame(looping, 0)).toBe(100);
    expect(msUntilNextFrame(looping, 40)).toBeCloseTo(60);
  });

  it("returns null when nothing more will change", () => {
    // Single frame: never changes.
    expect(msUntilNextFrame({ frames: [3], fps: 8, loop: true, fallback: "" }, 0)).toBeNull();
    // Finished one-shot: settled on its last frame.
    const once = { frames: [0, 1], fps: 10, loop: false, fallback: "" };
    expect(msUntilNextFrame(once, 500)).toBeNull();
    expect(msUntilNextFrame(once, 50)).toBe(50);
  });

  it("computes a full pass duration", () => {
    expect(durationMs(looping)).toBe(300);
  });
});

describe("agent state → pet animation", () => {
  it("maps each agent state to its animation", () => {
    expect(animationFor("working")).toBe("running");
    expect(animationFor("waiting")).toBe("waiting");
    expect(animationFor("done")).toBe("review");
    expect(animationFor("blocked")).toBe("failed");
    expect(animationFor("idle")).toBe("idle");
  });

  it("rests when no agent is reporting", () => {
    expect(aggregateState([])).toBe("idle");
    expect(aggregateState(["idle", "idle"])).toBe("idle");
  });

  it("prefers whatever needs the human first", () => {
    // needs input > blocked > ready > working
    expect(aggregateState(["working", "waiting"])).toBe("waiting");
    expect(aggregateState(["working", "blocked", "done"])).toBe("blocked");
    expect(aggregateState(["working", "done"])).toBe("done");
    expect(aggregateState(["working", "idle"])).toBe("working");
    expect(aggregateState(["done", "blocked", "waiting", "working"])).toBe("waiting");
  });

  it("knows which states should draw the eye", () => {
    expect(wantsAttention("waiting")).toBe(true);
    expect(wantsAttention("blocked")).toBe(true);
    expect(wantsAttention("done")).toBe(true);
    expect(wantsAttention("working")).toBe(false);
    expect(wantsAttention("idle")).toBe(false);
  });
});
