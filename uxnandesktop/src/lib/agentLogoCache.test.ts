import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRemoteLogoCache,
  isRemoteLogo,
  peekRemoteLogo,
  resolveRemoteLogo,
} from "./agentLogoCache";

const URL_A = "https://www.google.com/s2/favicons?domain=opencode.ai&sz=64";
const DATA = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => clearRemoteLogoCache());

describe("isRemoteLogo", () => {
  it("separates what the webview can load from what the backend must fetch", () => {
    expect(isRemoteLogo(URL_A)).toBe(true);
    expect(isRemoteLogo("http://example.test/i.png")).toBe(true);
    // Bundled assets and inline data are rendered directly — the CSP allows both.
    expect(isRemoteLogo("/agents/codex.svg")).toBe(false);
    expect(isRemoteLogo(DATA)).toBe(false);
  });
});

describe("resolveRemoteLogo", () => {
  it("fetches once and serves the rest from memory", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return DATA;
    };
    expect(await resolveRemoteLogo(URL_A, fetcher)).toBe(DATA);
    expect(await resolveRemoteLogo(URL_A, fetcher)).toBe(DATA);
    expect(calls).toBe(1);
    expect(peekRemoteLogo(URL_A)).toBe(DATA);
  });

  it("collapses concurrent asks for the same logo into one fetch", async () => {
    // Every catalog row renders its own <AgentLogo>, so the same favicon is asked
    // for many times in the same frame.
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return DATA;
    };
    const all = await Promise.all([
      resolveRemoteLogo(URL_A, fetcher),
      resolveRemoteLogo(URL_A, fetcher),
      resolveRemoteLogo(URL_A, fetcher),
    ]);
    expect(all).toEqual([DATA, DATA, DATA]);
    expect(calls).toBe(1);
  });

  it("remembers a failure so a dead URL isn't retried on every render", async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("offline");
    };
    expect(await resolveRemoteLogo(URL_A, failing)).toBeNull();
    expect(await resolveRemoteLogo(URL_A, failing)).toBeNull();
    expect(calls).toBe(1);
    // `null` is a resolved answer, not "unknown" — the caller shows its glyph.
    expect(peekRemoteLogo(URL_A)).toBeNull();
  });

  it("rejects a response that isn't inline data", async () => {
    // The backend contract is a `data:` URL; anything else would be put straight
    // into <img src> and blocked by the CSP all over again.
    expect(await resolveRemoteLogo(URL_A, async () => "https://elsewhere.test/i.png")).toBeNull();
  });

  it("forgets everything on clear, so a refresh can retry", async () => {
    await resolveRemoteLogo(URL_A, async () => {
      throw new Error("offline");
    });
    expect(peekRemoteLogo(URL_A)).toBeNull();
    clearRemoteLogoCache();
    expect(peekRemoteLogo(URL_A)).toBeUndefined();
    expect(await resolveRemoteLogo(URL_A, async () => DATA)).toBe(DATA);
  });
});
