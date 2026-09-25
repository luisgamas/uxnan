<script lang="ts">
  // Uxnan Desktop in miniature — the same recreation the website draws
  // (web/src/components/mockups/desktop.tsx), ported to the app's own tokens so
  // it follows the theme, and to its own components: the agent-state glyphs
  // are `AgentStatusIndicator`, the marks are `AgentLogo`. One tab per running
  // agent, the project rail with the live agent view under its worktree, the
  // work in the center, the dock on its Files surface.
  //
  // Drawn once at a canonical 800 × 500 and scaled to the width it is given,
  // so it keeps its proportions at any size. `center` picks what the center
  // shows: an agent's terminal, a chat tab, or an agent using Uxnan's tools.
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import AgentStatusIndicator from "$lib/components/AgentStatusIndicator.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
  import FolderTreeIcon from "@hugeicons/core-free-icons/FolderTreeIcon";
  import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
  import MinusIcon from "@hugeicons/core-free-icons/MinusSignIcon";
  import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
  import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import SquareIcon from "@hugeicons/core-free-icons/SquareIcon";
  import TerminalIcon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
  import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import type { DisplayStatus } from "$lib/state/agentDisplay";
  import { cn } from "$lib/utils";
  import { chat } from "$lib/design";

  let { center = "terminal" }: { center?: "terminal" | "chat" | "tools" } = $props();

  const BASE_W = 800;
  const BASE_H = 500;
  let width = $state(BASE_W);
  const scale = $derived(width / BASE_W);

  type Agent = {
    name: string;
    logo: string;
    state: string;
    status: DisplayStatus;
    time: string;
    active?: boolean;
    badge?: string;
    children?: { kind: string; name: string; tool?: string }[];
  };

  const agents: Agent[] = [
    {
      name: "Claude Code",
      logo: "claudecode",
      state: "Working",
      status: "working",
      time: "now",
      active: true,
      children: [
        { kind: "explorer", name: "Map the mobile screens" },
        { kind: "general-purpose", name: "Document the mockups" },
      ],
    },
    { name: "Codex", logo: "codex", state: "Done", status: "done", time: "40m" },
    {
      name: "OpenCode",
      logo: "opencode",
      state: "Blocked",
      status: "blocked",
      time: "now",
      badge: "2/2",
      children: [{ kind: "general", name: "Sweep the changelog", tool: "grep" }],
    },
    { name: "Antigravity", logo: "antigravity", state: "Waiting for input", status: "waiting", time: "2m" },
  ];

  const projects = ["website", "wallium", "notes", "calendar"];
  const tree = ["architecture", "bridge", "relay", "shared", "uxnandesktop", "uxnanmobile"];
</script>

<div class="relative w-full" style="height: {BASE_H * scale}px" bind:clientWidth={width}>
  <div
    class="absolute left-0 top-0 flex origin-top-left flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-[0_24px_70px_-24px_rgb(0_0_0/0.45)]"
    style="width: {BASE_W}px; height: {BASE_H}px; transform: scale({scale})"
  >
    <!-- Title bar — one tab per running agent -->
    <div class="flex h-9 shrink-0 items-center gap-3 border-b border-border/60 bg-sidebar px-3">
      <div class="flex shrink-0 items-center gap-2">
        <img src="/logo.svg" alt="" class="size-3.5" />
        <span class="whitespace-nowrap text-[11.5px] font-medium">Uxnan Desktop</span>
        <span class="rounded border border-border px-1.5 text-[9px] tracking-wider text-muted-foreground">ALPHA</span>
      </div>
      <div class="ml-2 flex min-w-0 items-center gap-1 overflow-hidden">
        {#each agents as agent (agent.name)}
          <div
            class={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-[11px]",
              agent.active ? "bg-accent text-foreground" : "text-muted-foreground",
            )}
          >
            <AgentStatusIndicator status={agent.status} />
            <span class="max-w-[110px] truncate">
              {center === "chat" && agent.active ? "Chat · Codex" : agent.name}
            </span>
            <Icon icon={XIcon} class="size-3 opacity-40" />
          </div>
        {/each}
        <Icon icon={PlusIcon} class="size-3.5 shrink-0 text-muted-foreground/60" />
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-3 text-muted-foreground/60">
        <Icon icon={MinusIcon} class="size-3.5" />
        <Icon icon={SquareIcon} class="size-[11px]" />
        <Icon icon={XIcon} class="size-3.5" />
      </div>
    </div>

    <div class="flex min-h-0 flex-1 text-[11px]">
      <!-- Project rail with the live agent view -->
      <aside class="flex w-[200px] shrink-0 flex-col border-r border-border/60 bg-sidebar p-2.5">
        <div class="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-[10.5px] text-muted-foreground">
          <Icon icon={SearchIcon} class="size-3" />
          <span class="truncate">Search a project…</span>
          <kbd class="ml-auto shrink-0 rounded border border-border/60 px-1 text-[9px]">⌘ P</kbd>
        </div>
        <div class="mb-1.5 mt-4 flex items-center px-1">
          <span class="text-[9px] font-medium tracking-[0.14em] text-muted-foreground">PROJECTS (5)</span>
          <span class="ml-auto flex items-center gap-1.5 text-muted-foreground/70">
            <Icon icon={RefreshIcon} class="size-2.5" />
            <Icon icon={PlusIcon} class="size-2.5" />
          </span>
        </div>
        <div class="flex items-center gap-2 rounded-md px-2 py-1.5">
          <Icon icon={FolderIcon} class="size-3 shrink-0 opacity-70" />
          <span class="truncate text-[10.5px]">uxnan</span>
          <span class="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
            <Icon icon={TerminalIcon} class="size-2.5" />4
          </span>
        </div>
        <div class="mt-1 rounded-lg border border-border/60 bg-background/60 p-1.5">
          <div class="flex items-center gap-1.5 px-1">
            <AgentStatusIndicator status="working" />
            <span class="text-[10.5px]">main</span>
            <span class="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
              <Icon icon={TerminalIcon} class="size-2.5" />4
            </span>
          </div>
          <div class="mb-1 pl-[17px] text-[9px] text-muted-foreground/70">uxnan</div>
          <div class="flex items-center gap-1 px-1 py-1 text-[8.5px] tracking-[0.14em] text-muted-foreground/70">
            <Icon icon={ChevronDownIcon} class="size-2.5" />AGENTS {agents.length}
          </div>
          {#each agents as agent (agent.name)}
            <div class={cn("flex items-center gap-1.5 rounded-md px-1 py-1", agent.active && "bg-accent")}>
              <AgentStatusIndicator status={agent.status} />
              <AgentLogo logo={agent.logo} class="size-3 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-[10px] leading-tight">{agent.name}</div>
                <div class="truncate text-[9px] leading-tight text-muted-foreground/70">{agent.state}</div>
              </div>
              {#if agent.badge}
                <span class="rounded bg-emerald-500/15 px-1 text-[8.5px] text-emerald-600 dark:text-emerald-400">
                  {agent.badge}
                </span>
              {/if}
              <span class="text-[9px] text-muted-foreground">{agent.time}</span>
            </div>
            {#each agent.children ?? [] as child (child.name)}
              <div class="flex items-center gap-1.5 py-[3px] pl-[18px]">
                <AgentStatusIndicator status="working" />
                <span class="shrink-0 rounded bg-foreground/[0.06] px-1 text-[8px] leading-[13px] text-muted-foreground">
                  {child.kind}
                </span>
                <span class="truncate text-[9px] text-muted-foreground">
                  {child.name}{#if child.tool}<span class="opacity-60"> · {child.tool}</span>{/if}
                </span>
              </div>
            {/each}
          {/each}
          <div class="mt-1.5 flex items-center gap-1.5 border-t border-border/60 px-1 pt-1.5">
            <Icon icon={GitBranchIcon} class="size-2.5 shrink-0 text-muted-foreground/70" />
            <div class="min-w-0">
              <div class="truncate text-[10px] leading-tight text-muted-foreground">feat/checkout</div>
              <div class="truncate text-[9px] leading-tight text-muted-foreground/70">checkout</div>
            </div>
          </div>
        </div>
        <div class="mt-2 flex flex-col gap-px">
          {#each projects as project (project)}
            <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground">
              <Icon icon={FolderIcon} class="size-3 shrink-0 opacity-60" />
              <span class="truncate text-[10.5px]">{project}</span>
            </div>
          {/each}
        </div>
      </aside>

      <!-- The center: a terminal, a chat, or an agent using Uxnan's tools -->
      <section class="flex min-w-0 flex-1 flex-col bg-background">
        {#if center === "chat"}
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-5">
            <div class="flex justify-end">
              <span class={cn(chat.userBubble, "text-[11px] leading-[1.55]")}>
                /review the checkout flow before we ship
              </span>
            </div>
            <div class="flex flex-col gap-1 text-[10.5px] text-muted-foreground">
              <span>● Read src/checkout/cart.ts</span>
              <span>● Ran npm test — 42 passed</span>
            </div>
            <p class="text-[11px] leading-[1.6] text-foreground/90">
              Two things before shipping: the coupon total rounds before tax, and the empty-cart
              state never clears the saved address. I can fix both.
            </p>
          </div>
          <div class="relative mx-6 mb-4">
            <div class="absolute bottom-full left-0 mb-1.5 w-60 rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10">
              <div class="px-2 py-1 text-[9px] text-muted-foreground">Skills</div>
              <div class="rounded-md bg-accent px-2 py-1 text-[10.5px]"><b>/review</b> <span class="text-muted-foreground">Review the diff</span></div>
              <div class="px-2 py-1 text-[10.5px]"><b>/compact</b> <span class="text-muted-foreground">Free up context</span></div>
            </div>
            <div class="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-xs">
              <span class="text-[11px]">/re</span>
              <span class="ml-auto flex items-center gap-1.5 text-[9.5px] text-muted-foreground">
                <span class="rounded-full border border-border/60 px-2 py-0.5">gpt-5.5 · high</span>
                <span class="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">↑</span>
              </span>
            </div>
          </div>
        {:else}
          <div class="flex-1 overflow-hidden px-3.5 py-3.5 font-mono text-[10.5px] leading-[1.7] text-muted-foreground">
            <div class="mb-3 flex items-start gap-3">
              <AgentLogo logo="claudecode" class="mt-px size-7 shrink-0" />
              <div class="min-w-0">
                <div class="text-[11px] text-foreground">Claude Code <span class="text-muted-foreground/70">v2.1.282</span></div>
                <div class="text-emerald-600 dark:text-emerald-400">Opus 5.5 with high effort</div>
                <div class="truncate text-muted-foreground/70">~/Projects/uxnan</div>
              </div>
            </div>
            {#if center === "tools"}
              <p class="text-foreground/70"><span class="text-emerald-600 dark:text-emerald-400">&gt;</span> ship the checkout fixes — have Codex write the tests</p>
              <p class="mt-2.5"><span class="text-foreground">⏺</span> uxnan-browser · worktree_create(<span class="text-sky-500">feat/checkout</span>)</p>
              <p class="text-muted-foreground/70">  ⎿ created ~/uxnan/worktrees/uxnan/feat-checkout</p>
              <p><span class="text-foreground">⏺</span> uxnan-browser · agent_send(<span class="text-sky-500">Codex</span>, "write the tests")</p>
              <p class="text-muted-foreground/70">  ⎿ Codex is working in feat/checkout</p>
              <p><span class="text-foreground">⏺</span> uxnan-browser · browser_open(<span class="text-foreground/80">localhost:5173/checkout</span>)</p>
              <p class="text-muted-foreground/70">  ⎿ page loaded · 0 console errors</p>
              <p><span class="text-foreground">⏺</span> uxnan-browser · terminal_read(<span class="text-foreground/80">tests</span>)</p>
              <p class="text-muted-foreground/70">  ⎿ <span class="text-emerald-600 dark:text-emerald-400">✓ 42 tests passed</span></p>
              <p class="mt-2.5 text-foreground/90"><span class="text-foreground">⏺</span> Codex wrote the tests, the page renders clean. Ready for review.</p>
            {:else}
              <p class="text-foreground/70"><span class="text-emerald-600 dark:text-emerald-400">&gt;</span> add a reconnect backoff to the zero adapter and cover it with a test</p>
              <p class="mt-2.5"><span class="text-foreground">⏺</span> Read(<span class="text-sky-500">bridge/src/adapters/zero-adapter.ts</span>)</p>
              <p class="text-muted-foreground/70">  ⎿ 142 lines</p>
              <p><span class="text-foreground">⏺</span> Update(<span class="text-sky-500">bridge/src/adapters/zero-adapter.ts</span>)</p>
              <p class="text-muted-foreground/70">  ⎿ <span class="text-emerald-600 dark:text-emerald-400">+18</span> −4</p>
              <p><span class="text-foreground">⏺</span> Task(<span class="text-sky-500">doc-check</span>) <span class="text-amber-500">running 12s</span></p>
              <p><span class="text-foreground">⏺</span> Bash(<span class="text-foreground/80">npm test -w uxnan-bridge</span>)</p>
              <p class="text-muted-foreground/70">  ⎿ <span class="text-emerald-600 dark:text-emerald-400">✓ 800 tests passed in 6.2s</span></p>
              <p class="mt-2.5 text-foreground/90"><span class="text-foreground">⏺</span> Reconnect backoff is in, with a test that fakes three dropped sockets. Want me to open the PR?</p>
            {/if}
          </div>
          <div class="px-3 pb-2.5">
            <div class="rounded-md border border-border/60 bg-sidebar px-2.5 py-2 font-mono text-[10.5px] text-muted-foreground/70">
              <span class="text-emerald-600 dark:text-emerald-400">&gt;</span> Try "fix lint errors"
            </div>
            <div class="mt-1.5 px-0.5 font-mono text-[9.5px] text-muted-foreground/70">⏸ manual mode on · ? for shortcuts</div>
          </div>
        {/if}
      </section>

      <!-- The right dock, on its Files surface -->
      <aside class="flex w-[170px] shrink-0 flex-col border-l border-border/60 bg-sidebar">
        <div class="flex items-center border-b border-border/60 px-1.5 py-1.5 text-[10px]">
          <span class="flex items-center gap-1 rounded px-1 py-0.5 font-medium">
            <Icon icon={FolderTreeIcon} class="size-3" />Files
            <Icon icon={ChevronDownIcon} class="size-2.5 text-muted-foreground/70" />
          </span>
        </div>
        <div class="flex items-center gap-1.5 px-2.5 py-2 text-[9px] tracking-[0.14em] text-muted-foreground/70">
          UXNAN
          <span class="ml-auto flex items-center gap-1.5">
            <Icon icon={SearchIcon} class="size-2.5" />
            <Icon icon={RefreshIcon} class="size-2.5" />
          </span>
        </div>
        <div class="flex flex-col gap-px px-1.5">
          {#each tree as name (name)}
            <div class="flex items-center gap-1.5 rounded px-1.5 py-[5px] text-[10.5px] text-muted-foreground">
              <Icon icon={ChevronRightIcon} class="size-2.5 text-muted-foreground/60" />
              <Icon icon={FolderIcon} class="size-3 opacity-70" />
              <span class="truncate">{name}</span>
            </div>
          {/each}
          {#each ["AGENTS.md", "README.md"] as file (file)}
            <div class="flex items-center gap-1.5 rounded px-1.5 py-[5px] pl-[26px] text-[10.5px] text-muted-foreground">
              <span class="truncate">{file}</span>
            </div>
          {/each}
        </div>
        <div class="mt-auto border-t border-border/60 px-2.5 py-2 text-[9.5px] text-muted-foreground/70">
          <div class="flex items-center gap-1.5">
            <Icon icon={GitBranchIcon} class="size-2.5" /><span>uxnan / main</span>
          </div>
        </div>
      </aside>
    </div>
  </div>
</div>
