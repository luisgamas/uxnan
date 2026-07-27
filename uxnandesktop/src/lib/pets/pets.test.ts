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
  STATE_PACE,
  CARRY_PACE,
  type PetAnimation,
} from "./manifest";
import { frameAt, msUntilNextFrame, durationMs } from "./animator";
import {
  animationFor,
  aggregateState,
  decayVerdict,
  hasDecayed,
  petStateOf,
  pickDriver,
  STATE_LIFETIME_MS,
} from "./status";
import { planFlavour, hasFlavour } from "./personality";
import { carryAnimation, carryDirection, CARRY_TURN_PX } from "./interactions";
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

  it("closes each state's row on a longer frame, at the ambient pace", () => {
    // The reference's raw 120–150 ms a frame is a terminal-glance pace; beside
    // an idle that breathes every 6.6 s it reads as a twitch. Rows play at the
    // reference timings times STATE_PACE — one ambient pace for every gesture.
    const running = ANIMS.running.frames;
    expect(running[0].ms).toBe(Math.round(120 * STATE_PACE)); // 240
    expect(running[5].ms).toBe(Math.round(220 * STATE_PACE)); // row 7's held close
    expect(ANIMS.waiting.frames[0].ms).toBe(Math.round(150 * STATE_PACE));
    expect(STATE_PACE).toBeGreaterThan(1); // anything at or below 1 defeats it
    // Bounded on the other side as well: past ~a quarter second a held frame
    // stops reading as a pose and starts reading as a pause between stills.
    expect(ANIMS.waiting.frames[0].ms).toBeLessThanOrEqual(300);
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

  it("lets a state come round again while the agent is still reporting", () => {
    const REARM = 90_000;
    // Three minutes in, `working` has used up its lifetime — but a hook that
    // fired seconds ago means the task is genuinely still running. Dropping it
    // would rest the pet on top of live work (and lose the click target).
    expect(decayVerdict("working", 0, 3 * MIN - 5_000, 3 * MIN, REARM)).toBe("rearm");
    // Silent long enough and it really is over: finished, crashed, closed.
    expect(decayVerdict("working", 0, 0, 3 * MIN, REARM)).toBe("drop");
    // Inside its lifetime nothing is decided at all.
    expect(decayVerdict("working", 0, 0, 2 * MIN, REARM)).toBe("show");
    // A finished turn stops reporting, so it expires on schedule as before.
    expect(decayVerdict("done", 0, 0, 30 * MIN, REARM)).toBe("drop");
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

  it("plays decoration at the same pace a state would play the row", () => {
    // The pace lives in the animation set itself (STATE_PACE), so a wave looks
    // identical whether it decorates the idle or answers a state — no separate
    // flavour stretching that would make the two drift apart again.
    const anims = defaultAnimations(8, 11);
    expect(anims.waving.frames[0].ms).toBe(Math.round(140 * STATE_PACE));
  });

  it("nags sooner when the agent needs you than when it is resting", () => {
    const waiting = planFlavour("waiting", seq(1, 0))!;
    const idle = planFlavour("idle", seq(1, 0))!;
    expect(waiting.animation).toBe("waving");
    expect(waiting.delayMs).toBeLessThan(idle.delayMs);
  });

  it("never decorates a state with the state's own row", () => {
    // Ending a flavour hands the renderer the base animation again, which
    // restarts it — so the state replays its row anyway, for free. A flavour
    // that *is* the base stacks the one-shot on top of that replay, and the pet
    // performs twice over every cycle (a `done` pet celebrated for half an hour).
    for (const base of ["idle", "waiting", "running", "review", "failed"] as const) {
      for (const r of [0, 0.5, 0.99]) {
        expect(planFlavour(base, seq(0.5, r))!.animation).not.toBe(base);
      }
    }
  });

  it("rests longest in the states that last longest", () => {
    // Cadence is set against how long a state sticks around: needs-you nags,
    // resting stirs, and the long-lived states (busy while the agent keeps
    // reporting; ready and blocked for up to 30 min) are the calmest.
    const delayOf = (base: string) => planFlavour(base, seq(0, 0))!.delayMs;
    expect(delayOf("waiting")).toBeLessThan(delayOf("idle"));
    expect(delayOf("idle")).toBeLessThan(delayOf("running"));
    expect(delayOf("idle")).toBeLessThan(delayOf("review"));
  });

  it("holds a one-shot long enough for a couple of passes of its row", () => {
    // A hold shorter than one pass would cut the gesture off mid-move.
    const anims = defaultAnimations(8, 11);
    const pass = (name: string) =>
      anims[name].frames
        .slice(0, anims[name].loopStart / STATE_REPEATS)
        .reduce((t, f) => t + f.ms, 0);
    for (const base of ["idle", "waiting", "running", "review", "failed"] as const) {
      const plan = planFlavour(base, seq(0, 0))!;
      expect(plan.holdMs).toBeGreaterThan(pass(plan.animation));
    }
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

  it("attaches to the agent that spoke last, not to an arbitrary one", () => {
    // The state can be true of several agents at once; the pet points at exactly
    // one — its tooltip, and the terminal a click reveals. The freshest report is
    // in practice the agent being driven right now.
    const reports = [
      { tabId: "a", state: "working" as const, lastUpdate: 1_000 },
      { tabId: "b", state: "waiting" as const, lastUpdate: 5_000 },
      { tabId: "c", state: "working" as const, lastUpdate: 9_000 },
    ];
    expect(pickDriver(reports, "working")?.tabId).toBe("c");
    expect(pickDriver(reports, "waiting")?.tabId).toBe("b");
    // Nothing in that state — the pet has nowhere to point, and says so.
    expect(pickDriver(reports, "blocked")).toBeUndefined();
    expect(pickDriver([], "idle")).toBeUndefined();
  });

  it("reads an interrupted turn as blocked, not as a pleased result", () => {
    // Esc / Ctrl-C reports `done` + `interrupted` (the turn did end, as far as
    // every other consumer is concerned). Answering that with the "ready"
    // gesture says the opposite of what happened.
    expect(petStateOf({ status: "done", interrupted: true })).toBe("blocked");
    expect(petStateOf({ status: "done", interrupted: false })).toBe("done");
    expect(petStateOf({ status: "done" })).toBe("done");
    // The flag only means anything on a finished turn.
    expect(petStateOf({ status: "working", interrupted: true })).toBe("working");
    expect(petStateOf({ status: "waiting", interrupted: true })).toBe("waiting");
  });
});

describe("carrying a pet", () => {
  /** A v2 pack with the conventional set, i.e. with the travelling runs. */
  const carried = parsePet({ spriteVersionNumber: 2 }, "uxni");
  carried.animations = defaultAnimations(8, 11);
  /** A pack that has no travelling rows at all. */
  const bare = parsePet({ animations: { idle: { frames: [0, 1] } } }, "bare");

  it("faces the way it is being taken, and ignores a shaky hand", () => {
    expect(carryDirection(CARRY_TURN_PX, null)).toBe("right");
    expect(carryDirection(-CARRY_TURN_PX, "right")).toBe("left");
    // Below the threshold the direction is kept, not dropped: it is the caller's
    // settle timer that ends a carry, so jitter can't flip the pet back and forth.
    expect(carryDirection(1, "left")).toBe("left");
    expect(carryDirection(-1, null)).toBe(null);
    expect(carryDirection(0, "right")).toBe("right");
  });

  it("uses the travelling run rows, which nothing else plays", () => {
    expect(carryAnimation(carried, "right")).toBe("running-right");
    expect(carryAnimation(carried, "left")).toBe("running-left");
    expect(carryAnimation(carried, null)).toBe(null);
  });

  it("has no travelling run to offer for a pack without those rows", () => {
    // Deliberately null rather than falling through to `idle`: the caller then
    // keeps the look-down pose, instead of standing still mid-drag.
    expect(carryAnimation(bare, "right")).toBe(null);
  });

  it("loops the run for as long as the carry lasts", () => {
    const run = defaultAnimations(8, 11)["running-right"];
    // Not the row-three-times-then-idle shape of a state: its own row, on repeat.
    expect(run.loopStart).toBe(0);
    expect(idx(run)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("runs at its own pace, evenly — a run is not a gesture", () => {
    const run = defaultAnimations(8, 11)["running-right"];
    const times = run.frames.map((f) => f.ms);
    // Every frame the same: a gesture's longer closing frame would land a limp
    // in the middle of the run, once per lap.
    expect(new Set(times).size).toBe(1);
    expect(times[0]).toBe(Math.round(120 * CARRY_PACE));
    // And quicker than a gesture, or the carry looks like slow motion.
    expect(CARRY_PACE).toBeLessThan(STATE_PACE);
    expect(times[0]).toBeLessThan(defaultAnimations(8, 11).running.frames[0].ms);
  });
});
