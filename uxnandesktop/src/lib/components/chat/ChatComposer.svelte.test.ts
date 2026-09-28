/**
 * The chat composer's keys: Enter sends, and on an empty composer ↑ / ↓ walk
 * the thread's earlier messages (the recall the phone and a terminal offer).
 * `/` completes the agent's commands (sent as a command), `@` the project's
 * files, and "+" attaches files for any agent (images for one that takes them).
 * A file dropped on it is mentioned when it is the project's, attached if not.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/svelte";
import { mountWithProviders, until } from "../../../test/render";
import type { AgentCommand } from "$shared/agents/agent-capabilities";
import { dropPathsAt } from "$lib/fileDrop";
import ChatComposer from "./ChatComposer.svelte";

// jsdom lays nothing out, so it has no `elementFromPoint`; each test says
// what is under the pointer.
document.elementFromPoint ??= () => null;

afterEach(() => vi.restoreAllMocks());

describe("ChatComposer", () => {
  it("recalls earlier messages with ↑ and walks back with ↓", async () => {
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { history: ["first", "second"], onsend: () => undefined },
    });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("{ArrowUp}");
    expect(box.value).toBe("second");
    await user.keyboard("{ArrowUp}");
    expect(box.value).toBe("first");
    await user.keyboard("{ArrowDown}");
    expect(box.value).toBe("second");
    await user.keyboard("{ArrowDown}");
    expect(box.value).toBe("");
  });

  it("never replaces text being written, and sends it on Enter", async () => {
    const sent: string[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { history: ["old"], onsend: (t: string) => void sent.push(t) },
    });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("new idea{ArrowUp}");
    expect(box.value).toBe("new idea");
    await user.keyboard("{Enter}");
    expect(sent).toEqual(["new idea"]);
    expect(box.value).toBe("");
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
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("/rev");
    await until(() => screen.queryByRole("option", { name: /\/review/ }) !== null);
    expect(screen.getByText("Your commands")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /\/compact/ })).toBeNull();
    await user.keyboard("{Enter}");
    expect(box.value).toBe("/review ");
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
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
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
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("look at @ap");
    await until(() => screen.queryByRole("option", { name: "src/app.ts" }) !== null);
    expect(asked.at(-1)).toEqual({
      method: "workspace/searchFiles",
      params: { cwd: "/repo", query: "ap", limit: 40 },
    });
    await user.keyboard("{Tab}");
    expect(box.value).toBe("look at @src/app.ts ");
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
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("@");
    await until(() => screen.queryByRole("option", { name: "src/" }) !== null);
    await user.keyboard("{Enter}");
    expect(box.value).toBe("@src/");
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
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
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
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    const file = new File(["id\n1\n"], "people.csv", { type: "text/csv" });
    await fireEvent.paste(box, { clipboardData: { files: [file] } });
    expect(await screen.findByText("people.csv")).toBeTruthy();
    expect(screen.getByText("5 B")).toBeTruthy();
    await user.click(box);
    await user.keyboard("read it{Enter}");
    await until(() => sent.length > 0);
    expect(sent[0]).toEqual({
      text: "read it",
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
        fs_read_attachment: (args) => {
          read.push(args.path);
          return { name: "notes.txt", mimeType: "text/plain", base64Data: "aGk=", bytes: 2 };
        },
      },
    });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(box);
    expect(dropPathsAt(["/repo/src/app.ts", "/tmp/notes.txt"], 10, 10, "os")).toBe(true);
    await until(() => box.value === "look at @src/app.ts ");
    expect(await screen.findByText("notes.txt")).toBeTruthy();
    expect(read).toEqual(["/tmp/notes.txt"]);
  });

  it("says whether a message sent while the agent works goes in now or waits, and keeps Stop at hand", async () => {
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { running: true, deliversNow: true, onstop: () => undefined, onsend: () => undefined },
    });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("also check the docs");
    expect(screen.getByText(/takes this message now/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("says a message waits in the queue when the agent cannot take it now", async () => {
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { running: true, deliversNow: false, onstop: () => undefined, onsend: () => undefined },
    });
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("later");
    expect(screen.getByText(/waits in the queue/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Queue" })).toBeTruthy();
  });
});
