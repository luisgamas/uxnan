import { describe, expect, it } from "vitest";
import { KeyboardProtocol } from "./keyboardProtocol";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("KeyboardProtocol", () => {
  it("stays dormant until an application enables it", () => {
    const kbd = new KeyboardProtocol(false);
    expect(kbd.active).toBe(false);
    expect(kbd.encodeKeyDown(key("a", { ctrlKey: true }))).toBeNull();
    expect(kbd.queryReply()).toBe("\x1b[?0u");
  });

  it("encodes modified text keys once disambiguation is on", () => {
    const kbd = new KeyboardProtocol(false);
    kbd.push(1);
    expect(kbd.encodeKeyDown(key("a", { ctrlKey: true }))).toBe("\x1b[97;5u");
    expect(kbd.encodeKeyDown(key("q", { altKey: true }))).toBe("\x1b[113;3u");
    expect(kbd.encodeKeyDown(key("Escape"))).toBe("\x1b[27u");
    // Plain text is left to xterm.
    expect(kbd.encodeKeyDown(key("a"))).toBeNull();
  });

  it("sends a macOS Option-composed character as text, not as an Alt chord", () => {
    const kbd = new KeyboardProtocol(true);
    kbd.push(1);
    // ⌥Q on a Latin American layout, ⌥2 on a Spanish one.
    expect(kbd.encodeKeyDown(key("@", { altKey: true }))).toBeNull();
    expect(kbd.encodeKeyDown(key("ß", { altKey: true }))).toBeNull();
    // Option with ⌘ or ⌃ is still a shortcut, and Option+Enter keeps its modifier.
    expect(kbd.encodeKeyDown(key("a", { altKey: true, ctrlKey: true }))).toBe("\x1b[97;7u");
    expect(kbd.encodeKeyDown(key("Enter", { altKey: true }))).toBe("\x1b[13;3u");
  });

  it("reports an Option-composed character without Alt when every key is reported", () => {
    const kbd = new KeyboardProtocol(true);
    kbd.push(0b1000);
    expect(kbd.encodeKeyDown(key("@", { altKey: true }))).toBe("\x1b[64u");
  });

  it("negotiates the flag stack and ignores unsupported bits", () => {
    const kbd = new KeyboardProtocol(false);
    kbd.push(0b11111);
    expect(kbd.flags).toBe(0b1011);
    kbd.set(0b10, 3);
    expect(kbd.flags).toBe(0b1001);
    kbd.pop(5);
    expect(kbd.active).toBe(false);
  });

  it("reports release only when event types are on", () => {
    const kbd = new KeyboardProtocol(false);
    kbd.push(1);
    expect(kbd.encodeKeyUp(key("a", { ctrlKey: true }))).toBeNull();
    kbd.push(0b11);
    expect(kbd.encodeKeyUp(key("a", { ctrlKey: true }))).toBe("\x1b[97;5:3u");
  });
});
