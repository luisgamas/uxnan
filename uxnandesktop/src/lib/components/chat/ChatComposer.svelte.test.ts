/**
 * The chat composer's keys: Enter sends, and on an empty composer ↑ / ↓ walk
 * the thread's earlier messages (the recall the phone and a terminal offer).
 * `/` completes the agent's commands (sent as a command), `@` the project's
 * files, and "+" attaches files for any agent (images for one that takes them).
 * A file dropped on it is mentioned when it is the project's, attached if not;
 * a folder from elsewhere is written as its path, and one path that cannot be
 * attached costs only itself.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/svelte";
import { mountWithProviders, until } from "../../../test/render";
import { failsWith } from "../../../test/tauri";
import type { AgentCommand } from "$shared/agents/agent-capabilities";
import { dropPathsAt } from "$lib/fileDrop";
import ChatComposer from "./ChatComposer.svelte";
import { serialize, setCaret } from "$lib/components/ui/input-group/chip-editor";

/** What the composer's editor holds, as the string it sends (a chip is a marker). */
const valueOf = (box: HTMLElement) => serialize(box).text;

// jsdom lays nothing out, so it has no `elementFromPoint`; each test says
// what is under the pointer.
document.elementFromPoint ??= () => null;

// The toasts the composer raises, so a test can read them.
const toasts = vi.hoisted(() => ({ error: [] as string[] }));
vi.mock("$lib/toast", async (importOriginal) => {
  const real = await importOriginal<typeof import("$lib/toast")>();
  const toast = Object.assign(() => undefined, {
    error: (message: string) => void toasts.error.push(message),
  });
  return { ...real, toast, toastError: (e: unknown) => toast.error(real.errorMessage(e)) };
});

afterEach(() => {
  vi.restoreAllMocks();
  toasts.error.length = 0;
});

describe("ChatComposer", () => {
  it("recalls earlier messages with ↑ and walks back with ↓", async () => {
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { history: ["first", "second"], onsend: () => undefined },
    });
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.keyboard("{ArrowUp}");
    expect(valueOf(box)).toBe("second");
    await user.keyboard("{ArrowUp}");
    expect(valueOf(box)).toBe("first");
    await user.keyboard("{ArrowDown}");
    expect(valueOf(box)).toBe("second");
    await user.keyboard("{ArrowDown}");
    expect(valueOf(box)).toBe("");
  });

  it("never replaces text being written, and sends it on Enter", async () => {
    const sent: string[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { history: ["old"], onsend: (t: string) => void sent.push(t) },
    });
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.keyboard("new idea{ArrowUp}");
    expect(valueOf(box)).toBe("new idea");
    await user.keyboard("{Enter}");
    expect(sent).toEqual(["new idea"]);
    expect(valueOf(box)).toBe("");
  });

  it("completes an agent command with / and sends it as a command", async () => {
    const commands: AgentCommand[] = [
      { name: "compact", description: "Free up context", source: "builtin" },
      { name: "review", description: "Review the diff", argumentHint: "<file>", source: "custom" },
    ];
    const sent: { text: string; extras: unknown }[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: {
        loadCommands: async () => commands,
        onsend: (text: string, extras: unknown) => void sent.push({ text, extras }),
      },
    });
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.keyboard("/rev");
    await until(() => screen.queryByRole("option", { name: /\/review/ }) !== null);
    expect(screen.getByText("Your commands")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /\/compact/ })).toBeNull();
    await user.keyboard("{Enter}");
    expect(valueOf(box)).toBe("/review ");
    await user.keyboard("src/app.ts{Enter}");
    expect(sent).toEqual([
      { text: "/review src/app.ts", extras: { command: { name: "review", args: "src/app.ts" } } },
    ]);
  });

  it("Esc closes the panel and an unknown /word goes as text", async () => {
    const sent: unknown[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: {
        loadCommands: async () => [{ name: "compact", source: "builtin" } as AgentCommand],
        onsend: (text: string, extras: unknown) => void sent.push([text, extras]),
      },
    });
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.keyboard("/");
    await until(() => screen.queryByRole("listbox") !== null);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.keyboard("nope{Enter}");
    expect(sent).toEqual([["/nope", {}]]);
  });

  it("completes a project file with @, asking the bridge", async () => {
    const asked: { method: string; params: unknown }[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { mentionRoot: "/repo", onsend: () => undefined },
      commands: {
        bridge_call: (args) => {
          asked.push({ method: String(args.method), params: args.params });
          return { cwd: ".", matches: [{ path: "src/app.ts", type: "file" }], truncated: false };
        },
      },
    });
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.keyboard("look at @ap");
    await until(() => screen.queryByRole("option", { name: "src/app.ts" }) !== null);
    expect(asked.at(-1)).toEqual({
      method: "workspace/searchFiles",
      params: { cwd: "/repo", query: "ap", limit: 40 },
    });
    await user.keyboard("{Tab}");
    expect(valueOf(box)).toBe("look at @src/app.ts ");
  });

  it("lists the project on a bare @ and drills into a picked folder", async () => {
    const listed: unknown[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { mentionRoot: "/repo", onsend: () => undefined },
      commands: {
        bridge_call: (args) => {
          listed.push(args.params);
          const inSrc = (args.params as { cwd: string }).cwd === "/repo/src";
          return {
            cwd: ".",
            entries: inSrc ? [{ name: "main.ts", type: "file" }] : [{ name: "src", type: "dir" }],
          };
        },
      },
    });
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.keyboard("@");
    await until(() => screen.queryByRole("option", { name: "src/" }) !== null);
    await user.keyboard("{Enter}");
    expect(valueOf(box)).toBe("@src/");
    await until(() => screen.queryByRole("option", { name: "src/main.ts" }) !== null);
    expect(listed).toContainEqual({ cwd: "/repo/src" });
  });

  it("sends a /command that was never typed at the caret as a command", async () => {
    const sent: unknown[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: {
        value: "/compact now",
        loadCommands: async () => [{ name: "compact", source: "builtin" } as AgentCommand],
        onsend: (text: string, extras: unknown) => void sent.push([text, extras]),
      },
    });
    const box = screen.getByRole("textbox");
    box.focus();
    setCaret(box, valueOf(box).length);
    await user.keyboard("{Enter}");
    await until(() => sent.length > 0);
    expect(sent).toEqual([["/compact now", { command: { name: "compact", args: "now" } }]]);
  });

  it("offers attaching to every agent, and a pasted file travels by its name", async () => {
    const sent: { text: string; extras: unknown }[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { onsend: (text: string, extras: unknown) => void sent.push({ text, extras }) },
    });
    expect(screen.getByRole("button", { name: "Attach images or files" })).toBeTruthy();
    const box = screen.getByRole("textbox");
    const file = new File(["id\n1\n"], "people.csv", { type: "text/csv" });
    await fireEvent.paste(box, { clipboardData: { files: [file] } });
    await until(() => box.querySelector("[data-chip]") !== null);
    expect(box.querySelector("[data-chip]")?.textContent).toContain("people.csv");
    // The caret is right after the chip: the words follow it.
    await user.keyboard("is the list{Enter}");
    await until(() => sent.length > 0);
    expect(sent[0]).toEqual({
      text: "\uFFFC is the list",
      extras: {
        attachments: [{ type: "file", name: "people.csv", mimeType: "text/csv", base64Data: "aWQKMQo=" }],
      },
    });
  });

  it("mentions a dropped file of the project and attaches one from elsewhere", async () => {
    const read: unknown[] = [];
    const { screen } = mountWithProviders(ChatComposer, {
      props: { value: "look at", mentionRoot: "/repo", onsend: () => undefined },
      commands: {
        fs_is_dir: () => false,
        fs_read_attachment: (args) => {
          read.push(args.path);
          return { name: "notes.txt", mimeType: "text/plain", base64Data: "aGk=", bytes: 2 };
        },
      },
    });
    const box = screen.getByRole("textbox");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(box);
    expect(dropPathsAt(["/repo/src/app.ts", "/tmp/notes.txt"], 10, 10, "os")).toBe(true);
    // The mention is written where the caret was, and the file from elsewhere
    // becomes a chip right after it.
    await until(() => valueOf(box) === "look at @src/app.ts \uFFFC ");
    expect(box.querySelector("[data-chip]")?.textContent).toContain("notes.txt");
    expect(read).toEqual(["/tmp/notes.txt"]);
  });

  it("writes a dropped outside folder as its path and keeps every file a failing one sits beside", async () => {
    const failing = failsWith("INVALID", "the file is larger than 20 MB");
    const { screen } = mountWithProviders(ChatComposer, {
      props: { value: "look at", mentionRoot: "/repo", onsend: () => undefined },
      commands: {
        fs_is_dir: (args) => args.path === "/tmp/My Folder" || args.path === "/repo",
        fs_read_attachment: (args) =>
          args.path === "/tmp/notes.txt"
            ? { name: "notes.txt", mimeType: "text/plain", base64Data: "aGk=", bytes: 2 }
            : failing(args),
      },
    });
    const box = screen.getByRole("textbox");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(box);
    const dropped = ["/tmp/notes.txt", "/tmp/My Folder", "/tmp/huge.bin", "/repo"];
    expect(dropPathsAt(dropped, 10, 10, "os")).toBe(true);
    await until(() => valueOf(box) === 'look at "/tmp/My Folder" /repo \uFFFC ');
    expect(box.querySelectorAll("[data-chip]")).toHaveLength(1);
    expect(box.querySelector("[data-chip]")?.textContent).toContain("notes.txt");
    await until(() => toasts.error.length > 0);
    expect(toasts.error).toEqual(["Couldn't attach huge.bin: the file is larger than 20 MB"]);
  });

  it("says a message sent while the agent works reaches it at its next pause, and keeps Stop at hand", async () => {
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { running: true, atNextPause: true, onstop: () => undefined, onsend: () => undefined },
    });
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.keyboard("also check the docs");
    expect(screen.getByText(/reaches it at its next pause/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Queue" })).toBeTruthy();
  });

  it("says a message waits in the queue when the agent cannot take it now", async () => {
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { running: true, atNextPause: false, onstop: () => undefined, onsend: () => undefined },
    });
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("later");
    expect(screen.getByText(/waits in the queue/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Queue" })).toBeTruthy();
  });

  it("puts an attachment at the caret, inside the sentence, and sends it there", async () => {
    const sent: { text: string; extras: unknown }[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: {
        value: "in this you see a cat",
        onsend: (text: string, extras: unknown) => void sent.push({ text, extras }),
      },
    });
    const box = screen.getByRole("textbox");
    box.focus();
    setCaret(box, "in this".length);
    const file = new File(["x"], "cat.txt", { type: "text/plain" });
    await fireEvent.paste(box, { clipboardData: { files: [file] } });
    await until(() => valueOf(box) === "in this ￼ you see a cat");
    await user.keyboard("{Enter}");
    await until(() => sent.length > 0);
    expect(sent[0]?.text).toBe("in this ￼ you see a cat");
    expect((sent[0]?.extras as { attachments: { name: string }[] }).attachments.map((a) => a.name)).toEqual([
      "cat.txt",
    ]);
  });

  it("takes a chip out with its ✕, whole, and sends without it", async () => {
    const sent: { text: string; extras: unknown }[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { onsend: (text: string, extras: unknown) => void sent.push({ text, extras }) },
    });
    const box = screen.getByRole("textbox");
    box.focus();
    await fireEvent.paste(box, {
      clipboardData: { files: [new File(["a"], "a.txt", { type: "text/plain" }), new File(["b"], "b.txt")] },
    });
    await until(() => box.querySelectorAll("[data-chip]").length === 2);
    const remove = box.querySelectorAll<HTMLElement>("[data-chip-action='remove']")[0]!;
    expect(remove.getAttribute("aria-label")).toBe("Remove a.txt");
    await fireEvent.click(remove);
    expect(box.querySelectorAll("[data-chip]")).toHaveLength(1);
    expect(valueOf(box)).toBe("￼ ￼ ".replace("￼ ", ""));
    await user.keyboard("only b{Enter}");
    await until(() => sent.length > 0);
    expect((sent[0]?.extras as { attachments: { name: string }[] }).attachments.map((a) => a.name)).toEqual([
      "b.txt",
    ]);
  });

  it("copies a selection with each chip as its name, never a marker", async () => {
    const { screen } = mountWithProviders(ChatComposer, { props: { onsend: () => undefined } });
    const box = screen.getByRole("textbox");
    box.focus();
    await fireEvent.paste(box, { clipboardData: { files: [new File(["x"], "plan.pdf")] } });
    await until(() => box.querySelector("[data-chip]") !== null);
    const range = document.createRange();
    range.selectNodeContents(box);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const data = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (type: string, value: string) => data.set(type, value) },
    });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data.get("text/plain")).toBe("[plan.pdf] ");
  });

  it("pastes text without markers or formatting", async () => {
    const { screen } = mountWithProviders(ChatComposer, { props: { onsend: () => undefined } });
    const box = screen.getByRole("textbox");
    box.focus();
    await fireEvent.paste(box, {
      clipboardData: { files: [], getData: (type: string) => (type === "text/plain" ? "a￼b" : "<b>x</b>") },
    });
    expect(valueOf(box)).toBe("ab");
  });

  it("keeps a draft's chips when the composer is built again, and drops markers it cannot fill", async () => {
    const first = mountWithProviders(ChatComposer, { props: { draftKey: "tab-chips", onsend: () => undefined } });
    const box = first.screen.getByRole("textbox");
    box.focus();
    await fireEvent.paste(box, { clipboardData: { files: [new File(["x"], "kept.csv")] } });
    await until(() => box.querySelector("[data-chip]") !== null);
    const draft = valueOf(box);
    first.screen.unmount();

    const again = mountWithProviders(ChatComposer, {
      props: { value: draft, draftKey: "tab-chips", onsend: () => undefined },
    });
    const rebuilt = again.screen.getByRole("textbox");
    await until(() => rebuilt.querySelector("[data-chip]") !== null);
    expect(rebuilt.querySelector("[data-chip]")?.textContent).toContain("kept.csv");
    again.screen.unmount();

    // A restart: the words come back, the bytes do not — so neither do the markers.
    const restarted = mountWithProviders(ChatComposer, {
      props: { value: "see ￼", draftKey: "tab-other", onsend: () => undefined },
    });
    const box3 = restarted.screen.getByRole("textbox");
    await until(() => valueOf(box3) === "see ");
    expect(box3.querySelector("[data-chip]")).toBeNull();
  });

  it("never sends while an input method is composing", async () => {
    const sent: string[] = [];
    const { screen } = mountWithProviders(ChatComposer, {
      props: { value: "にほん", onsend: (t: string) => void sent.push(t) },
    });
    const box = screen.getByRole("textbox");
    await fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(sent).toEqual([]);
  });
});

