<script lang="ts">
  // One step of an agent's work, on one compact row: an icon, a verb ("Ran",
  // "Edited", "Read", "Searched", or the tool's name), the detail (the command,
  // the file, what the tool acted on) and its state — a pulsing dot while it
  // runs, red when it failed. A step with something to show (a command's
  // output, a file's diff, a tool's result, a subagent's report) opens in place.
  //
  // The bridge classifies every agent's tools into one vocabulary (`kind`, with
  // a ready-to-show `target`, shared/models/tool.ts), so this row never learns
  // an agent's own tool names. Everything arrives from the bridge, so every
  // field is read defensively.
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Icon } from "$lib/components/ui/icon";
  import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
  import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
  import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon";
  import UserMultipleIcon from "@hugeicons/core-free-icons/UserMultipleIcon";
  import FileViewIcon from "@hugeicons/core-free-icons/FileViewIcon";
  import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
  import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
  import Globe02Icon from "@hugeicons/core-free-icons/Globe02Icon";
  import GlobalSearchIcon from "@hugeicons/core-free-icons/GlobalSearchIcon";
  import PlugSocketIcon from "@hugeicons/core-free-icons/PlugSocketIcon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import DiffView from "$lib/components/DiffView.svelte";
  import { toUnifiedPatch } from "$lib/bridge/diffPatch";
  import { activityFailed, activityRunning } from "$lib/bridge/timeline";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let { block }: { block: Record<string, unknown> } = $props();

  let open = $state(false);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

  const type = $derived(str(block.type));
  const running = $derived(activityRunning(block));
  const failed = $derived(activityFailed(block));
  const sub = $derived(
    block.state && typeof block.state === "object" ? (block.state as Record<string, unknown>) : {},
  );

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
      case "command_execution":
        return {
          glyph: CommandLineIcon,
          verb: i18n.t(running ? "chat.verbRunning" : "chat.verbRan"),
          detail: str(block.command),
          mono: true,
        };
      case "diff":
        return { glyph: FileEditIcon, verb: i18n.t("chat.verbEdited"), detail: str(block.filename), mono: true };
      case "tool": {
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
      default:
        return {
          glyph: UserMultipleIcon,
          verb: i18n.t("chat.subagent"),
          detail: str(sub.name),
          mono: false,
        };
    }
  });

  const output = $derived(
    type === "diff" ? "" : type === "subagent" ? str(sub.output) : str(block.output),
  );
  const patch = $derived(type === "diff" ? toUnifiedPatch(str(block.filename), str(block.diff)) : null);
  const expandable = $derived(!!output || !!patch);
  const exit = $derived(num(block.exitCode));
</script>

<Collapsible.Root bind:open>
  <Collapsible.Trigger class={chat.activity} disabled={!expandable}>
    <Icon
      icon={view.glyph}
      class={cn(icon.decorative, "shrink-0", failed ? "text-destructive" : "opacity-70")}
    />
    <span class={cn("shrink-0 font-medium", failed ? "text-destructive" : "text-foreground/80")}>
      {view.verb}
    </span>
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
      <span class={chat.runningDot} role="status" aria-label={i18n.t("chat.working")}></span>
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
    {#if patch}
      <div class="mx-2 my-1 h-72 overflow-hidden rounded-md border border-border/60">
        <DiffView diff={patch} />
      </div>
    {:else if output}
      <pre class={cn(chat.output, "mx-2 my-1")}>{output}</pre>
    {/if}
  </Collapsible.Content>
</Collapsible.Root>
