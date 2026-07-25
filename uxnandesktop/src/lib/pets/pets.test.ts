import { describe, it, expect } from "vitest";
import {
  dedupeById,
  defaultAnimations,
  DEFAULT_ANIMATION_NAMES,
  STATE_REPEATS,
  parsePet,
  resolveAnimation,
  framePosition,
  DEFAULT_FRAME,
  DEFAULT_FRAME_MS,
  type PetAnimation,
} from "./manifest";
import { frameAt, msUntilNextFrame, durationMs } from "./animator";
import {
  animationFor,
  aggregateState,
  hasDecayed,
  STATE_LIFETIME_MS,
} from "./status";
import { planFlavour, hasFlavour, FLAVOUR_SLOWDOWN } from "./personality";
import {
  hasLookPoses,
  lookAngle,
  lookFrameIndex,
  LOOK_DOWN_DEG,
  LOOK_POSES,
} from "./look";

/** Sprite indices of an animation, ignoring timing. */
const idx = (anim: PetAnimation) => anim.frames.map((f) => f.index);

/** A hand-rolled animation, for the timing tests. */
const anim = (frames: [number, number][], loopStart = 0): PetAnimation => ({
  frames: frames.map(([index, ms]) => ({ index, ms })),
  loopStart,
  fallback: "",
});

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
    expect(pet.spritesheetPath).toBe("spritesheet.webp");
    expect(pet.frame).toEqual({ width: 192, height: 208, columns: 8, rows: 9 });
    expect(idx(pet.animations.running)).toEqual([8, 9, 10, 11]);
    expect(pet.animations.running.frames[0].ms).toBeCloseTo(1000 / 12);
    expect(pet.origin).toBe("Codex");
  });

  it("turns `loop: false` into an animation that plays once", () => {
    const pet = parsePet(CODEX_MANIFEST, "stacky");
    // Nothing to return to: the loop point sits past the end.
    expect(pet.animations.waving.loopStart).toBe(pet.animations.waving.frames.length);
    expect(pet.animations.running.loopStart).toBe(0);
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
    expect(idx(pet.animations.idle)).toEqual([0, 1]);
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
    expect(idx(pet.animations.idle)).toEqual([0, 80, 87]);
  });

  it("clamps an absurd grid instead of trusting it", () => {
    const pet = parsePet({ frame: { width: 99999, height: -4, columns: 100000, rows: 0 } }, "x");
    expect(pet.frame.width).toBeLessThanOrEqual(2048);
    expect(pet.frame.columns).toBeLessThanOrEqual(256);
    expect(pet.frame.height).toBe(DEFAULT_FRAME.height);
    expect(pet.frame.rows).toBe(DEFAULT_FRAME.rows);
  });

  it("defaults the frame duration when a pack leaves it out", () => {
    const pet = parsePet({ animations: { idle: { frames: [0, 1] } } }, "x");
    expect(pet.animations.idle.frames[0].ms).toBe(DEFAULT_FRAME_MS);
    expect(pet.animations.idle.loopStart).toBe(0);
  });

  it("survives junk input without throwing", () => {
    expect(() => parsePet(null, "a")).not.toThrow();
    expect(() => parsePet("nonsense", "b")).not.toThrow();
    expect(parsePet({ animations: "not-an-object" }, "c").animations).toEqual({});
    expect(parsePet({ animations: { idle: { frames: "nope" } } }, "d").animations).toEqual({});
  });
});

describe("defaultAnimations", () => {
  /** The real v2 layout: 8 columns, 11 rows. */
  const ANIMS = defaultAnimations(8, 11);

  it("puts the busy state on the in-place row, not the travelling run", () => {
    // Rows 1 and 2 are a run that travels; the working state is row 7, in place.
    // Wiring `running` to row 1 is what makes a pet sprint for a whole task.
    expect(idx(ANIMS.running)[0]).toBe(56); // row 7
    expect(idx(ANIMS["running-right"])[0]).toBe(8); // row 1
    expect(idx(ANIMS["running-left"])[0]).toBe(16); // row 2
  });

  it("names each row of the conventional layout, aliases included", () => {
    expect(idx(ANIMS.idle)[0]).toBe(0);
    expect(idx(ANIMS.waving)[0]).toBe(24); // row 3
    expect(idx(ANIMS.jumping)[0]).toBe(32); // row 4
    expect(idx(ANIMS.failed)[0]).toBe(40); // row 5
    expect(idx(ANIMS.waiting)[0]).toBe(48); // row 6
    expect(idx(ANIMS.review)[0]).toBe(64); // row 8
    expect(idx(ANIMS.sad)).toEqual(idx(ANIMS.failed));
    expect(idx(ANIMS.bounce)).toEqual(idx(ANIMS.jumping));
    expect(idx(ANIMS.wave)).toEqual(idx(ANIMS.waving));
  });

  it("plays a state a few times and then settles into idle", () => {
    // The heart of it: a state is not performed for as long as it lasts. Its row
    // runs three times, then the timeline continues into idle — and that is
    // where the loop returns to.
    const waving = ANIMS.waving;
    const row = [24, 25, 26, 27];
    expect(waving.loopStart).toBe(row.length * STATE_REPEATS);
    expect(idx(waving).slice(0, row.length)).toEqual(row);
    expect(idx(waving).slice(waving.loopStart)).toEqual(idx(ANIMS.idle));
  });

  it("holds resting poses far longer than the in-betweens", () => {
    // A flat frame rate is what makes a pet twitch; one breath is over 6 seconds.
    const ms = ANIMS.idle.frames.map((f) => f.ms);
    expect(ms).toEqual([1680, 660, 660, 840, 840, 1920]);
    expect(durationMs(ANIMS.idle)).toBe(6600);
  });

  it("closes each state's row on a longer frame, at the reference pace", () => {
    const running = ANIMS.running.frames;
    expect(running[0].ms).toBe(120);
    expect(running[5].ms).toBe(220); // row 7 has 6 frames; the last is held
    expect(ANIMS.waiting.frames[0].ms).toBe(150);
  });

  it("skips rows the grid does not have", () => {
    // An older 8x9 sheet still has every state; a 3-row one clearly does not.
    const short = defaultAnimations(8, 3);
    expect(idx(short.idle)[0]).toBe(0);
    expect(short["running-left"]).toBeDefined(); // row 2 exists
    expect(short.review).toBeUndefined(); // row 8 does not
    expect(Object.keys(short).length).toBeLessThanOrEqual(DEFAULT_ANIMATION_NAMES.length);
  });

  it("never reaches past the rows the reference layout defines", () => {
    // Rows 9 and 10 are not part of the conventional set; playing them is the
    // signature of having fallen back to walking the whole sheet.
    const every = Object.values(ANIMS).flatMap(idx);
    expect(Math.max(...every)).toBeLessThan(9 * 8);
  });

  it("uses only the frames each row actually paints", () => {
    // Row 3 (waving) is 4 frames of an 8-wide grid; playing the blank tail would
    // make the pet vanish for part of the loop.
    expect(idx(ANIMS.waving).slice(0, 4)).toEqual([24, 25, 26, 27]);
    expect(idx(ANIMS.jumping).slice(0, 5)).toEqual([32, 33, 34, 35, 36]);
    expect(idx(ANIMS.idle)).toHaveLength(6);
  });
});

describe("look poses (v2 rows 9–10)", () => {
  /** A v2 pack the way `/hatch` writes it: version declared, layout derived. */
  const v2 = () => {
    const pet = parsePet({ id: "uxni", spriteVersionNumber: 2 }, "uxni");
    pet.frame = { ...pet.frame, columns: 8, rows: 11 }; // as measured from the sheet
    return pet;
  };

  it("reads the declared sprite version, defaulting to none", () => {
    expect(parsePet({ spriteVersionNumber: 2 }, "x").spriteVersion).toBe(2);
    expect(parsePet(CODEX_MANIFEST, "x").spriteVersion).toBe(0);
  });

  it("offers look poses only for sheets that actually have the rows", () => {
    expect(hasLookPoses(v2())).toBe(true);
    // A v1 sheet (9 rows) has no look rows, declared version or not.
    expect(hasLookPoses(parsePet({ spriteVersionNumber: 2 }, "x"))).toBe(false);
    // A pack that declared its own 11-row layout and animations knows better
    // than the convention — no look rows unless it declares the version.
    const explicit = parsePet(
      {
        frame: { width: 192, height: 208, columns: 8, rows: 11 },
        animations: { idle: { frames: [0, 1] } },
      },
      "x",
    );
    expect(hasLookPoses(explicit)).toBe(false);
    // A stripped pack (version lost by an older import) still qualifies once
    // the sheet measures 11 rows.
    const stripped = parsePet({ id: "uxni" }, "uxni");
    stripped.frame = { ...stripped.frame, rows: 11 };
    expect(hasLookPoses(stripped)).toBe(true);
  });

  it("measures angles clockwise from 12 o'clock", () => {
    expect(lookAngle(0, -1)).toBe(0); // up
    expect(lookAngle(1, 0)).toBe(90); // right
    expect(lookAngle(0, 1)).toBe(180); // down
    expect(lookAngle(-1, 0)).toBe(270); // left
  });

  it("maps each of the 16 directions onto rows 9 and 10", () => {
    const pet = v2();
    // Row 9 starts at index 72 (9 * 8): 0° is its first cell.
    expect(lookFrameIndex(pet, 0)).toBe(72);
    expect(lookFrameIndex(pet, 90)).toBe(76);
    // Row 10 continues the loop: 180° (looking down) is its first cell.
    expect(lookFrameIndex(pet, LOOK_DOWN_DEG)).toBe(80);
    expect(lookFrameIndex(pet, 270)).toBe(84);
    expect(lookFrameIndex(pet, 337.5)).toBe(87);
  });

  it("snaps to the nearest pose and wraps past the last one", () => {
    const pet = v2();
    expect(lookFrameIndex(pet, 10)).toBe(72); // closer to 0° than 22.5°
    expect(lookFrameIndex(pet, 12)).toBe(73); // closer to 22.5°
    expect(lookFrameIndex(pet, 355)).toBe(72); // wraps back to pose 0
    expect(lookFrameIndex(pet, -90)).toBe(84); // negative = 270°
  });

  it("covers every pose exactly once across a full turn", () => {
    const pet = v2();
    const seen = new Set<number>();
    for (let i = 0; i < LOOK_POSES; i++) seen.add(lookFrameIndex(pet, i * 22.5) ?? -1);
    expect(seen.size).toBe(LOOK_POSES);
    expect(Math.min(...seen)).toBe(72);
    expect(Math.max(...seen)).toBe(87);
  });

  it("declines packs without look rows", () => {
    expect(lookFrameIndex(parsePet(CODEX_MANIFEST, "x"), 90)).toBeNull();
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
    expect(idx(resolveAnimation(pet, "running"))).toEqual([8, 9, 10, 11]);
  });

  it("falls back to idle for a state the pack never defined", () => {
    expect(idx(resolveAnimation(pet, "failed"))).toEqual([0, 1, 2, 3]);
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
    expect(idx(resolveAnimation(chained, "failed"))).toEqual([6]);
  });

  it("terminates on a circular fallback chain", () => {
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
    expect(resolveAnimation(looped, "a").frames.length).toBeGreaterThan(0);
  });

  it("synthesizes a walk of the whole sheet for a pack with no animations", () => {
    const bare = parsePet({ frame: { width: 8, height: 8, columns: 2, rows: 2 } }, "bare");
    expect(idx(resolveAnimation(bare, "idle"))).toEqual([0, 1, 2, 3]);
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
  it("holds each frame for its own duration", () => {
    const a = anim([
      [0, 1000],
      [1, 200],
      [2, 200],
    ]);
    expect(frameAt(a, 0)).toBe(0);
    expect(frameAt(a, 999)).toBe(0); // the long resting pose
    expect(frameAt(a, 1000)).toBe(1);
    expect(frameAt(a, 1199)).toBe(1);
    expect(frameAt(a, 1200)).toBe(2);
  });

  it("loops from the loop point, not from the beginning", () => {
    // Two lead-in frames that play once, then a two-frame loop.
    const a = anim(
      [
        [0, 100],
        [1, 100],
        [8, 100],
        [9, 100],
      ],
      2,
    );
    expect(frameAt(a, 0)).toBe(0);
    expect(frameAt(a, 150)).toBe(1);
    expect(frameAt(a, 250)).toBe(8);
    expect(frameAt(a, 350)).toBe(9);
    // Past the end it returns to the loop point — never to the lead-in.
    expect(frameAt(a, 450)).toBe(8);
    expect(frameAt(a, 550)).toBe(9);
    expect(frameAt(a, 10_000)).not.toBe(0);
    expect(frameAt(a, 10_050)).not.toBe(1);
  });

  it("holds the last frame when there is nothing to loop", () => {
    const once = anim(
      [
        [4, 100],
        [5, 100],
      ],
      2,
    );
    expect(frameAt(once, 150)).toBe(5);
    expect(frameAt(once, 10_000)).toBe(5);
  });

  it("is safe on empty and negative input", () => {
    expect(frameAt(anim([]), 500)).toBe(0);
    expect(frameAt(anim([[7, 100]]), -50)).toBe(7);
  });
});

describe("msUntilNextFrame", () => {
  it("reports the time left on the current frame", () => {
    const a = anim([
      [0, 1000],
      [1, 200],
    ]);
    expect(msUntilNextFrame(a, 0)).toBe(1000);
    expect(msUntilNextFrame(a, 400)).toBe(600);
    expect(msUntilNextFrame(a, 1000)).toBe(200);
  });

  it("keeps scheduling across the loop point", () => {
    const a = anim(
      [
        [0, 100],
        [8, 100],
        [9, 100],
      ],
      1,
    );
    expect(msUntilNextFrame(a, 350)).toBe(50); // well past the lead-in
  });

  it("returns null when nothing more will change", () => {
    expect(msUntilNextFrame(anim([[3, 125]]), 0)).toBeNull();
    const once = anim(
      [
        [0, 100],
        [1, 100],
      ],
      2,
    );
    expect(msUntilNextFrame(once, 500)).toBeNull();
    expect(msUntilNextFrame(once, 50)).toBe(50);
  });

  it("computes a full pass duration", () => {
    expect(
      durationMs(
        anim([
          [0, 100],
          [1, 250],
        ]),
      ),
    ).toBe(350);
  });
});

describe("state decay", () => {
  const MIN = 60_000;

  it("stops showing 'working' once it stops being news", () => {
    expect(hasDecayed("working", 0, 2 * MIN)).toBe(false);
    expect(hasDecayed("working", 0, 3 * MIN)).toBe(true);
  });

  it("keeps states that are waiting on the user alive far longer", () => {
    for (const state of ["waiting", "blocked", "done"] as const) {
      expect(hasDecayed(state, 0, 29 * MIN)).toBe(false);
      expect(hasDecayed(state, 0, 30 * MIN)).toBe(true);
    }
    expect(STATE_LIFETIME_MS.working).toBeLessThan(STATE_LIFETIME_MS.waiting);
  });

  it("never decays resting", () => {
    expect(hasDecayed("idle", 0, 10 * 24 * 60 * MIN)).toBe(false);
  });
});

describe("planFlavour", () => {
  /** Deterministic `random` that walks a fixed sequence. */
  const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it("keeps a resting pet alive with occasional one-shots", () => {
    const plan = planFlavour("idle", seq(0, 0));
    expect(plan).not.toBeNull();
    expect(plan!.animation).toBe("waving");
    expect(plan!.delayMs).toBe(14_000);
  });

  it("picks across the whole candidate list", () => {
    expect(planFlavour("idle", seq(0.5, 0.99))!.animation).toBe("jumping");
  });

  it("offers each resting flavour a distinct animation", () => {
    // `bounce` is an alias of `jumping` (both row 4); listing both would quietly
    // make the hop twice as likely as the wave.
    const picks = [0, 0.5, 0.99].map((r) => planFlavour("idle", seq(0.5, r))!.animation);
    expect(new Set(picks)).toEqual(new Set(["waving", "jumping"]));
  });

  it("plays decoration slower than the same animation would when a state fires it", () => {
    // A wave is 140 ms a frame beside a resting pose of 660–1920 ms; unprompted,
    // that reads as a twitch. Anything at or below 1 would defeat the point.
    expect(FLAVOUR_SLOWDOWN).toBeGreaterThan(2);
    expect(140 * FLAVOUR_SLOWDOWN).toBeGreaterThan(300);
  });

  it("nags sooner when the agent needs you than when it is resting", () => {
    const waiting = planFlavour("waiting", seq(1, 0))!;
    const idle = planFlavour("idle", seq(1, 0))!;
    expect(waiting.animation).toBe("waving");
    expect(waiting.delayMs).toBeLessThan(idle.delayMs);
  });

  it("has nothing to add for an animation it doesn't know", () => {
    expect(planFlavour("waving")).toBeNull();
    expect(hasFlavour("idle")).toBe(true);
    expect(hasFlavour("nonsense")).toBe(false);
  });

  it("stays inside its declared delay window", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const plan = planFlavour("idle", seq(r, 0))!;
      expect(plan.delayMs).toBeGreaterThanOrEqual(14_000);
      expect(plan.delayMs).toBeLessThanOrEqual(34_000);
    }
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
    expect(aggregateState(["working", "waiting"])).toBe("waiting");
    expect(aggregateState(["working", "blocked", "done"])).toBe("blocked");
    expect(aggregateState(["working", "done"])).toBe("done");
    expect(aggregateState(["working", "idle"])).toBe("working");
    expect(aggregateState(["done", "blocked", "waiting", "working"])).toBe("waiting");
  });
});
