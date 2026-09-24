import { describe, expect, it } from "vitest";
import {
  displayAddress,
  isSearchTemplate,
  isSecureAddress,
  resolveAddress,
  SEARCH_ENGINES,
  searchTemplate,
  stepZoom,
  ZOOM_STEPS,
} from "./browserAddress";

describe("resolveAddress", () => {
  it("returns null for nothing", () => {
    expect(resolveAddress("   ")).toBeNull();
  });
  it("keeps explicit schemes and the empty page", () => {
    expect(resolveAddress("https://example.com/x")).toBe("https://example.com/x");
    expect(resolveAddress("http://10.0.0.2:8080")).toBe("http://10.0.0.2:8080");
    expect(resolveAddress("ABOUT:BLANK")).toBe("about:blank");
  });
  it("uses http for this machine and the local network", () => {
    expect(resolveAddress("localhost:5173")).toBe("http://localhost:5173");
    expect(resolveAddress("localhost")).toBe("http://localhost");
    expect(resolveAddress("127.0.0.1:3000/app")).toBe("http://127.0.0.1:3000/app");
    expect(resolveAddress("[::1]:4000")).toBe("http://[::1]:4000");
    expect(resolveAddress("app.localhost:3000")).toBe("http://app.localhost:3000");
    expect(resolveAddress("192.168.1.20:8080")).toBe("http://192.168.1.20:8080");
    expect(resolveAddress("devbox:8080/health")).toBe("http://devbox:8080/health");
  });
  it("uses https for a domain name", () => {
    expect(resolveAddress("example.com")).toBe("https://example.com");
    expect(resolveAddress("docs.rs/serde?search=x")).toBe("https://docs.rs/serde?search=x");
    expect(resolveAddress("localhostify.dev")).toBe("https://localhostify.dev");
  });
  it("searches anything else", () => {
    const g = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    expect(resolveAddress("google")).toBe(g("google"));
    expect(resolveAddress("svelte runes")).toBe(g("svelte runes"));
    expect(resolveAddress("what is example.com")).toBe(g("what is example.com"));
    expect(resolveAddress("c++ & rust?")).toBe(g("c++ & rust?"));
  });
  it("searches with the chosen engine", () => {
    expect(resolveAddress("tauri", searchTemplate("duckduckgo"))).toBe("https://duckduckgo.com/?q=tauri");
    expect(resolveAddress("tauri", searchTemplate("custom", "https://kagi.com/search?q=%s"))).toBe(
      "https://kagi.com/search?q=tauri",
    );
  });
});

describe("searchTemplate", () => {
  it("falls back to Google for an unusable custom template", () => {
    expect(searchTemplate("custom", "no-placeholder.com")).toBe(SEARCH_ENGINES.google.template);
    expect(searchTemplate("custom", "ftp://x/%s")).toBe(SEARCH_ENGINES.google.template);
    expect(searchTemplate(undefined)).toBe(SEARCH_ENGINES.google.template);
    expect(isSearchTemplate("https://s.example/?q=%s")).toBe(true);
  });
});

describe("displayAddress / isSecureAddress", () => {
  it("hides the empty page and spots TLS", () => {
    expect(displayAddress("about:blank")).toBe("");
    expect(displayAddress("http://localhost:1")).toBe("http://localhost:1");
    expect(isSecureAddress("https://a.b")).toBe(true);
    expect(isSecureAddress("http://a.b")).toBe(false);
  });
});

describe("stepZoom", () => {
  it("steps through the levels and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1], 1)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    expect(stepZoom(ZOOM_STEPS[0], -1)).toBe(ZOOM_STEPS[0]);
  });
  it("moves a level between steps to the nearest one that way", () => {
    expect(stepZoom(1.2, 1)).toBe(1.25);
    expect(stepZoom(1.2, -1)).toBe(1.1);
  });
});
