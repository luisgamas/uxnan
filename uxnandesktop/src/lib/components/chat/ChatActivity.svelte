<script lang="ts">
  // One step of an agent's work, on one compact row: an icon, a verb ("Ran",
  // "Edited", "Read", "Searched", or the tool's name), the detail (the command,
  // the file, what the tool acted on) and its state — a pulsing dot while it
  // runs, red when it failed. A step with something to show (a command's
  // output, a file's diff, a tool's result) opens in place. A subagent is its
  // own card (`ChatSubagent`), not a row.
  //
  // The bridge classifies every agent's tools into one vocabulary (`kind`, with
  // a ready-to-show `target`, shared/models/tool.ts), so this row never learns
  // an agent's own tool names. Everything arrives from the bridge, so every
  // field is read defensively.
  //
  // A step arrives as its bounded preview (plans/046): a command's start, its
  // output's end, an edit without its diff — each cut field with its full size
  // beside it. Opening an edit reads its diff (`turn/step`); a cut command or
  // output shows what the preview holds and offers the rest.
  //
  // A thought (a stretch of the agent's reasoning, in its place among the
  // steps) reads as "Thinking" while it is being written and "Thought" after,
  // followed by its own text on one line; open, it is Markdown in a box that
  // scrolls — following the newest words while they stream, unless the reader
  // scrolled up (back at the bottom, it follows again).
  import { untrack } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Icon } from "$lib/components/ui/icon";
  import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
  import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
  import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon";
  import FileViewIcon from "@hugeicons/core-free-icons/FileViewIcon";
  import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
  import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
  import Globe02Icon from "@hugeicons/core-free-icons/Globe02Icon";
  import GlobalSearchIcon from "@hugeicons/core-free-icons/GlobalSearchIcon";
  import PlugSocketIcon from "@hugeicons/core-free-icons/PlugSocketIcon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
  import MarkdownView from "$lib/components/MarkdownView.svelte";
  import DiffView from "$lib/components/DiffView.svelte";
  import { toUnifiedPatch } from "$lib/bridge/diffPatch";
  import { stepFailed, stepRunning, type StepPreview } from "$shared/models/history";
  import { plainLine } from "$lib/bridge/timeline";
  import type { Conversation } from "$lib/bridge/conversation.svelte";
  import ChatOnDemand from "./ChatOnDemand.svelte";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";
  import ChatWorkingGlyph from "./ChatWorkingGlyph.svelte";
  import ShimmerText from "../ShimmerText.svelte";

  let {
    block: step,
    live = true,
    writing = false,
    turnId,
    conversation,
  }: {
    /** The step: a preview (`StepPreview`) or a block as stored. */
    block: Record<string, unknown> | StepPreview;
    /** The step's turn is still running: only then is a running step animated. */
    live?: boolean;
    /** A thought the agent is writing now (its turn's last part) — a thought
     *  has no status of its own, so its turn says so. */
    writing?: boolean;
    /** Where the whole step is read from, when its preview was cut. */
    turnId?: string;
    conversation?: Conversation;
  } = $props();
  const block = $derived(step as unknown as Record<string, unknown>);

  let open = $state(false);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

  const type = $derived(str(block.type));
  const running = $derived(live && (stepRunning(block) || (block.type === "thinking" && writing)));
  const failed = $derived(stepFailed(block));

  /** How each kind of tool call reads, and the icon it takes. */
  const TOOL_VIEWS: Record<string, { glyph: typeof Wrench01Icon; verb: MessageKey }> = {
    read: { glyph: FileViewIcon, verb: "chat.verbRead" },
    search: { glyph: Search01Icon, verb: "chat.verbSearched" },
    list: { glyph: FolderOpenIcon, verb: "chat.verbListed" },
    fetch: { glyph: Globe02Icon, verb: "chat.verbFetched" },
    web_search: { glyph: GlobalSearchIcon, verb: "chat.verbSearchedWeb" },
  };

  /** An MCP tool's name as `server · tool` (`mcp__server__tool` or `server/tool`). */
  function mcpName(name: string): string {
    const parts = name.startsWith("mcp__") ? name.slice(5).split("__") : name.split("/");
    return parts.filter(Boolean).join(" · ") || name;
  }

  const view = $derived.by(() => {
    switch (type) {
      case "thinking":
        return {
          glyph: BrainIcon,
          verb: i18n.t(running ? "chat.verbThinking" : "chat.verbThought"),
          detail: plainLine(str(block.text)),
          mono: false,
        };
      case "command_execution":
        return {
          glyph: CommandLineIcon,
          verb: i18n.t(running ? "chat.verbRunning" : "chat.verbRan"),
          detail: str(block.command),
          mono: true,
        };
      case "diff":
        return { glyph: FileEditIcon, verb: i18n.t("chat.verbEdited"), detail: str(block.filename), mono: true };
      default: {
        // A tool call.
        const kind = str(block.kind);
        const known = TOOL_VIEWS[kind];
        const name = str(block.toolName);
        if (known) {
          return {
            glyph: known.glyph,
            verb: i18n.t(known.verb),
            detail: str(block.target),
            mono: kind !== "web_search",
          };
        }
        return {
          glyph: kind === "mcp" ? PlugSocketIcon : Wrench01Icon,
          verb: (kind === "mcp" ? mcpName(name) : name) || i18n.t("chat.verbTool"),
          detail: str(block.target),
          mono: true,
        };
      }
    }
  });

  // --- the whole step, read when asked for ----------------------------------
  const index = $derived(num(block.index));
  /** The stored step this preview stands for, as `turn/step` read it. */
  const whole = $derived(
    conversation && turnId && index !== null ? conversation.fullStep(turnId, index) : undefined,
  );
  function loadWhole(retry: boolean) {
    if (conversation && turnId && index !== null) void conversation.loadFullStep(turnId, index, retry);
  }
  const canRead = $derived(!!conversation && !!turnId && index !== null);
  const outputCut = $derived(num(block.outputChars) !== null && !whole?.value);
  const thoughtCut = $derived(num(block.textChars) !== null && !whole?.value);
  /** A thought's text: whole once read, its preview until then. */
  const thought = $derived(type === "thinking" ? str(whole?.value?.text ?? block.text) : "");
  const commandCut = $derived(num(block.commandChars) !== null && !whole?.value);

  const output = $derived(
    type === "diff" || type === "thinking" ? "" : str(whole?.value?.output ?? block.output),
  );
  /** The whole command, once read — the row only had room for its start. */
  const command = $derived(
    type === "command_execution" && num(block.commandChars) !== null ? str(whole?.value?.command) : "",
  );
  /** A diff's body never rides a preview: only the step read whole has it. */
  const body = $derived(type === "diff" ? str(whole?.value?.diff ?? block.diff) : "");
  const hasDiff = $derived(type === "diff" && (!!body || (num(block.diffChars) ?? 0) > 0));
  const patch = $derived(body ? toUnifiedPatch(str(block.filename), body) : null);
  const expandable = $derived(
    !!output || hasDiff || !!thought.trim() || (canRead && (outputCut || commandCut)),
  );
  const exit = $derived(num(block.exitCode));

  // A thought being written follows its newest words, unless the reader
  // scrolled up to read; back at the bottom, it follows again.
  let thoughtBox = $state<HTMLElement | null>(null);
  let pinned = true;
  function onThoughtScroll() {
    if (!thoughtBox) return;
    pinned = thoughtBox.scrollHeight - thoughtBox.scrollTop - thoughtBox.clientHeight < 8;
  }
  $effect(() => {
    void thought;
    if (!thoughtBox || !running || !pinned) return;
    thoughtBox.scrollTop = thoughtBox.scrollHeight;
  });

  // Opening an edit is asking for its diff.
  $effect(() => {
    if (open && type === "diff" && !body && canRead) untrack(() => loadWhole(false));
  });
</script>

<Collapsible.Root bind:open>
  <Collapsible.Trigger class={chat.activity} disabled={!expandable}>
    <Icon
      icon={view.glyph}
      class={cn(icon.decorative, "shrink-0", failed ? "text-destructive" : "opacity-70")}
    />
    <ShimmerText
      active={running}
      class={cn("shrink-0 font-medium", failed ? "text-destructive" : "text-foreground/80")}
    >
      {view.verb}
    </ShimmerText>
    {#if view.detail}
      <span class={cn("min-w-0 flex-1 truncate", view.mono && "font-mono text-[11px]")}>{view.detail}</span>
    {:else}
      <span class="flex-1"></span>
    {/if}
    {#if type === "diff"}
      <span class={cn(text.indicator, "shrink-0 font-mono text-emerald-600 dark:text-emerald-400")}>
        +{num(block.additions) ?? 0}
      </span>
      <span class={cn(text.indicator, "shrink-0 font-mono text-red-600 dark:text-red-400")}>
        −{num(block.deletions) ?? 0}
      </span>
    {/if}
    {#if running}
      <ChatWorkingGlyph />
    {:else if failed}
      <span class={cn(text.indicator, "shrink-0 text-destructive")}>
        {exit !== null && exit !== 0 ? i18n.t("chat.exitCode", { code: String(exit) }) : i18n.t("chat.failed")}
      </span>
    {/if}
    <Icon
      icon={ArrowRight01Icon}
      class={cn(icon.status, "shrink-0 transition-transform", open && "rotate-90", !expandable && "invisible")}
    />
  </Collapsible.Trigger>
  <Collapsible.Content>
    {#if type === "thinking"}
      <div bind:this={thoughtBox} onscroll={onThoughtScroll} class={cn(chat.thought, "mx-2 my-1")}>
        <MarkdownView source={thoughtCut ? `${thought}…` : thought} inline quiet />
      </div>
      {#if thoughtCut && canRead && !running}
        <div class="mx-2 mb-1 flex flex-col">
          <ChatOnDemand detail={whole} label={i18n.t("chat.showFullThinking")} onload={loadWhole} />
        </div>
      {/if}
    {:else if type === "diff"}
      {#if patch}
        <div class="mx-2 my-1 h-72 overflow-hidden rounded-md border border-border/60">
          <DiffView diff={patch} />
        </div>
      {:else}
        <ChatOnDemand detail={whole ?? { loading: true }} onload={loadWhole} />
      {/if}
    {:else}
      {#if command}
        <pre class={cn(chat.output, "mx-2 my-1")}>{command}</pre>
      {/if}
      {#if output}
        <!-- A cut output is its end: the ellipsis says something came before. -->
        <pre class={cn(chat.output, "mx-2 my-1")}>{outputCut ? `…\n${output}` : output}</pre>
      {/if}
      {#if canRead && (outputCut || commandCut)}
        <div class="mx-2 mb-1 flex flex-col">
          <ChatOnDemand
            detail={whole}
            label={i18n.t(outputCut ? "chat.showFullOutput" : "chat.showFullCommand")}
            onload={loadWhole}
          />
        </div>
      {/if}
    {/if}
  </Collapsible.Content>
</Collapsible.Root>
