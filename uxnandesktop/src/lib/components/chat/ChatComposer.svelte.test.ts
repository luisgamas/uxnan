/**
 * The chat composer's keys: Enter sends, and on an empty composer ↑ / ↓ walk
 * the thread's earlier messages (the recall the phone and a terminal offer).
 * `/` completes the agent's commands (sent as a command), `@` the project's
 * files, and "+" is there only for an agent that takes images.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import type { AgentCommand } from "$shared/agents/agent-capabilities";
import ChatComposer from "./ChatComposer.svelte";

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

  it("completes a project file with @", async () => {
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { mentionRoot: "/repo", onsend: () => undefined },
      commands: {
        fs_search_files: () => ({
          entries: [{ name: "app.ts", path: "/repo/src/app.ts", isDir: false, ignored: false }],
          truncated: false,
        }),
      },
    });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("look at @ap");
    await until(() => screen.queryByRole("option", { name: "src/app.ts" }) !== null);
    await user.keyboard("{Tab}");
    expect(box.value).toBe("look at @src/app.ts ");
  });

  it("offers images only to an agent that takes them", () => {
    const without = mountWithProviders(ChatComposer, { props: { onsend: () => undefined } });
    expect(without.screen.queryByRole("button", { name: "Add images" })).toBeNull();
    without.unmount?.();
    const withImages = mountWithProviders(ChatComposer, {
      props: { onsend: () => undefined, acceptsImages: true },
    });
    expect(withImages.screen.getByRole("button", { name: "Add images" })).toBeTruthy();
  });
});
