import { describe, expect, it } from "vitest";
import { displayAddress, isSecureAddress, normalizeAddress, stepZoom, ZOOM_STEPS } from "./browserAddress";

describe("normalizeAddress", () => {
  it("returns null for nothing", () => {
    expect(normalizeAddress("   ")).toBeNull();
  });
  it("keeps explicit schemes and the empty page", () => {
    expect(normalizeAddress("https://example.com/x")).toBe("https://example.com/x");
    expect(normalizeAddress("http://10.0.0.2:8080")).toBe("http://10.0.0.2:8080");
    expect(normalizeAddress("ABOUT:BLANK")).toBe("about:blank");
  });
  it("uses http for loopback dev servers", () => {
    expect(normalizeAddress("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeAddress("127.0.0.1:3000/app")).toBe("http://127.0.0.1:3000/app");
    expect(normalizeAddress("[::1]:4000")).toBe("http://[::1]:4000");
    expect(normalizeAddress("app.localhost:3000")).toBe("http://app.localhost:3000");
  });
  it("uses https for everything else", () => {
    expect(normalizeAddress("example.com")).toBe("https://example.com");
    expect(normalizeAddress("localhostify.dev")).toBe("https://localhostify.dev");
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
