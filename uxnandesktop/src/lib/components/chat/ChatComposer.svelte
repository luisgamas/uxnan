<script lang="ts">
  // The chat's input. Enter sends, Shift+Enter breaks the line (and an IME
  // composition is never cut short). While the agent works the button stops
  // it; typing meanwhile sends a follow-up the bridge queues behind the running
  // turn — or hands to it directly, on agents that take input mid-turn — which
  // is exactly what the phone does with the same message. On an empty
  // composer ↑ recalls the thread's earlier messages (newest first) and ↓ walks
  // back; the text is `bindable`, so the view keeps it as the tab's draft and
  // can put a withdrawn or failed message back into it.
  //
  // What the phone's composer does, the same way: `/` opens the agent's
  // commands (`agent/commands`, grouped: skills, the user's own, built-ins,
  // loaded as soon as the agent is known) and a `/name args` message is sent as
  // `turn/send { command }`; `@` browses and searches the project through the
  // bridge that owns its folder (`workspace/list`, `workspace/searchFiles`) —
  // a folder drills in, a file is written as `@path`; images — from "+",
  // pasted or dropped, up to the phone's limit — ride along as `attachments`
  // when the agent takes them. The suggestion panel sits over the composer,
  // which keeps the focus and drives it (↑ ↓, Enter or Tab, Esc).
  //
  // Built on the shared `InputGroup` (the same primitive the command palette's
  // search uses): a `Textarea` over a `block-end` toolbar of quiet pills — the
  // agent and the model with its run options (`leading`), the access mode
  // (`trailing`) — then the context ring and the round send / stop button.
  import * as InputGroup from "$lib/components/ui/input-group";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
  import StopIcon from "@hugeicons/core-free-icons/StopIcon";
  import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
  import CancelIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import { untrack, type Snippet } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { AgentCommand, AgentCommandInvocation } from "$shared/agents/agent-capabilities";
  import type { TurnAttachment } from "$shared/models/workspace";
  import ChatContextRing from "./ChatContextRing.svelte";
  import ChatSuggestions, { type Suggestion } from "./ChatSuggestions.svelte";
  import {
    asCommand,
    complete,
    matchCommands,
    tokenAt,
    type ComposerToken,
  } from "$lib/bridge/composerTokens";
  import {
    imageFromBlob,
    imageFromDataUrl,
    MAX_IMAGES,
    type ComposerImage,
  } from "$lib/bridge/imageAttachment";
  import { mentionEntries } from "$lib/bridge/mentions";
  import { bridge } from "$lib/bridge/client.svelte";
  import { toast, toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    value = $bindable(""),
    history = [],
    running = false,
    disabled = false,
    placeholder,
    autofocus = false,
    onsend,
    onstop,
    leading,
    trailing,
    context = null,
    loadCommands,
    mentionRoot,
    acceptsImages = false,
  }: {
    /** The text being written (the view persists it as the tab's draft). */
    value?: string;
    /** The thread's earlier messages, oldest first, for ↑ / ↓ recall. */
    history?: string[];
    running?: boolean;
    disabled?: boolean;
    placeholder?: string;
    autofocus?: boolean;
    /** Sends the message; a known `/command` and any images come with it. */
    onsend: (
      text: string,
      extras: { command?: AgentCommandInvocation; attachments?: TurnAttachment[] },
    ) => void | Promise<void>;
    onstop?: () => void;
    /** Controls shown at the start of the toolbar (the model picker). */
    leading?: Snippet;
    /** Controls shown after the leading ones (the access mode). */
    trailing?: Snippet;
    /** How full the context window is, when the agent reports it. */
    context?: { tokens: number; limit: number } | null;
    /** The agent's commands for the `/` panel (none offered without it). */
    loadCommands?: () => Promise<AgentCommand[]>;
    /** The project folder `@` completes files from (none without it). */
    mentionRoot?: string;
    /** Whether the agent takes images (`capabilities.images`). */
    acceptsImages?: boolean;
  } = $props();

  let ref = $state<HTMLTextAreaElement | null>(null);
  let images = $state<ComposerImage[]>([]);
  const empty = $derived(value.trim().length === 0 && images.length === 0);

  // ---- the suggestion panel: `/command` or `@file` under the caret ----
  let token = $state<ComposerToken | undefined>(undefined);
  /** A token the user dismissed with Esc stays closed until it changes. */
  let dismissed = $state<string | null>(null);
  let commands = $state<AgentCommand[] | null>(null);
  let commandsLoading = $state(false);
  let files = $state<{ path: string; isDir: boolean }[]>([]);
  let filesLoading = $state(false);
  let active = $state(0);

  const tokenKey = $derived(token ? `${token.kind}:${token.start}:${token.query}` : null);
  const panelOpen = $derived(
    token !== undefined &&
      tokenKey !== dismissed &&
      ((token.kind === "command" && loadCommands !== undefined) ||
        (token.kind === "mention" && mentionRoot !== undefined)),
  );
  const items = $derived<Suggestion[]>(
    !panelOpen || !token
      ? []
      : token.kind === "command"
        ? matchCommands(commands ?? [], token.query)
            .slice(0, 60)
            .map((command) => ({ kind: "command" as const, command }))
        : files.map((f) => ({ kind: "file" as const, ...f })),
  );

  function readToken() {
    token = ref ? tokenAt(value, ref.selectionStart ?? value.length) : undefined;
  }

  // The agent's commands, asked as soon as the agent is known — not when `/`
  // is typed — so a `/name args` message recalled, pasted, restored from the
  // draft or sent at once still goes out as the command it is. Another agent
  // (a new chat's picker) has other commands: its own load replaces them.
  let commandsRequest: Promise<AgentCommand[]> | null = null;
  function ensureCommands(): Promise<AgentCommand[]> {
    if (!loadCommands) return Promise.resolve([]);
    if (commands !== null) return Promise.resolve(commands);
    commandsRequest ??= loadCommands().catch(() => [] as AgentCommand[]);
    return commandsRequest;
  }
  $effect(() => {
    const load = loadCommands;
    // Only the loader is tracked: the load itself reads and writes `commands`.
    return untrack(() => {
      commands = null;
      commandsRequest = null;
      if (!load) return;
      let current = true;
      commandsLoading = true;
      void ensureCommands()
        .then((list) => {
          if (current) commands = list;
        })
        .finally(() => {
          if (current) commandsLoading = false;
        });
      return () => {
        current = false;
      };
    });
  });

  // What the mention names — the folder it is in, or the project's matches —
  // a beat after typing stops, asked of the bridge (`$lib/bridge/mentions`).
  let searchSeq = 0;
  $effect(() => {
    if (token?.kind !== "mention" || !mentionRoot || tokenKey === dismissed) return;
    const query = token.query;
    const root = mentionRoot;
    const seq = ++searchSeq;
    filesLoading = true;
    const timer = setTimeout(async () => {
      try {
        const found = await mentionEntries((m, p) => bridge.call(m, p), root, query);
        if (seq === searchSeq) files = found;
      } catch {
        if (seq === searchSeq) files = [];
      } finally {
        if (seq === searchSeq) filesLoading = false;
      }
    }, 150);
    return () => clearTimeout(timer);
  });

  // A new token starts at the top of the list.
  $effect(() => {
    void tokenKey;
    active = 0;
  });

  function pick(item: Suggestion) {
    if (!token) return;
    const replacement =
      item.kind === "command" ? `/${item.command.name}` : `@${item.path}${item.isDir ? "/" : ""}`;
    const next = complete(value, token, replacement);
    value = next.text;
    token = undefined;
    queueMicrotask(() => {
      ref?.focus();
      ref?.setSelectionRange(next.caret, next.caret);
      readToken();
    });
  }

  /** Keys the open panel takes; true when it took this one. */
  function panelKey(e: KeyboardEvent): boolean {
    if (!panelOpen) return false;
    if (e.key === "Escape") {
      dismissed = tokenKey;
      return true;
    }
    if (items.length === 0) return false;
    if (e.key === "ArrowDown") {
      active = (active + 1) % items.length;
      return true;
    }
    if (e.key === "ArrowUp") {
      active = (active - 1 + items.length) % items.length;
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const item = items[active];
      if (item) pick(item);
      return true;
    }
    return false;
  }

  // ---- images ----
  async function addImages(list: ComposerImage[]) {
    const room = Math.max(0, MAX_IMAGES - images.length);
    if (list.length > room) toast(i18n.t("chat.imagesLimit", { count: MAX_IMAGES }));
    if (room === 0) return;
    images = [...images, ...list.slice(0, room)];
  }

  async function chooseImages() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      const ready: ComposerImage[] = [];
      for (const path of paths) {
        const dataUrl = await invoke<string>("fs_read_data_url", { path });
        ready.push(await imageFromDataUrl(dataUrl, path.split(/[\\/]/).pop() ?? "image"));
      }
      await addImages(ready);
      ref?.focus();
    } catch (err) {
      toastError(err);
    }
  }

  /** Images dropped on the composer, like pasted ones. */
  let dragging = $state(false);
  function carriesFiles(e: DragEvent): boolean {
    return acceptsImages && !disabled && [...(e.dataTransfer?.types ?? [])].includes("Files");
  }
  async function ondrop(e: DragEvent) {
    dragging = false;
    if (!carriesFiles(e)) return;
    e.preventDefault();
    const dropped = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (dropped.length === 0) return;
    try {
      await addImages(await Promise.all(dropped.map((f) => imageFromBlob(f, f.name || "image"))));
      ref?.focus();
    } catch (err) {
      toastError(err);
    }
  }

  async function onpaste(e: ClipboardEvent) {
    if (!acceptsImages) return;
    const pasted = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (pasted.length === 0) return;
    e.preventDefault();
    try {
      await addImages(await Promise.all(pasted.map((f) => imageFromBlob(f, f.name || "image"))));
    } catch (err) {
      toastError(err);
    }
  }

  $effect(() => {
    if (autofocus && ref && !disabled) ref.focus();
  });

  async function submit() {
    if (empty || disabled) return;
    const message = value;
    const command = message.trimStart().startsWith("/")
      ? asCommand(message, await ensureCommands())
      : undefined;
    const attachments = images.map((i) => i.attachment);
    value = "";
    images = [];
    token = undefined;
    await onsend(message, {
      ...(command ? { command } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }

  /** Which earlier message ↑ put in the composer (an index into `history`). */
  let recalled = $state<number | null>(null);

  /** ↑ / ↓ walk the history while the composer is empty or still shows a
   *  recalled message untouched; any edit ends the walk. */
  function recall(step: -1 | 1): boolean {
    if (history.length === 0) return false;
    const walking = recalled !== null && value === history[recalled];
    if (!walking && value !== "") return false;
    if (!walking && step === 1) return false;
    const next = (walking ? (recalled as number) : history.length) + step;
    if (next < 0) return true;
    if (next >= history.length) {
      recalled = null;
      value = "";
      return true;
    }
    recalled = next;
    value = history[next];
    queueMicrotask(() => ref?.setSelectionRange(value.length, value.length));
    return true;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (panelKey(e)) {
      e.preventDefault();
      return;
    }
    const plain = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
    if (plain && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (recall(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    recalled = null;
    void submit();
  }
</script>

<div class="relative flex flex-col gap-1">
  {#if panelOpen}
    <div class="absolute inset-x-0 bottom-full z-20 mb-2">
      <ChatSuggestions
        {items}
        {active}
        loading={token?.kind === "command" ? commandsLoading : filesLoading}
        emptyLabel={token?.kind === "command" ? i18n.t("chat.noCommands") : i18n.t("chat.noFiles")}
        onpick={pick}
        onhover={(index) => (active = index)}
      />
    </div>
  {/if}
  <!-- The group dims only when the INPUT is disabled, not whenever any of its
       buttons is (the send button is disabled on an empty draft, and the
       primitive's `has-disabled` would fade the whole composer for it). -->
  <InputGroup.Root
    class={cn(
      "rounded-xl bg-card shadow-xs has-disabled:bg-card has-disabled:opacity-100 has-[textarea:disabled]:opacity-50",
      dragging && "ring-2 ring-ring/40",
    )}
    ondragover={(e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    {ondrop}
  >
    {#if images.length > 0}
      <InputGroup.Addon align="block-start" class="flex-wrap gap-1.5">
        {#each images as image (image.id)}
          <span class="group/thumb relative size-12 overflow-hidden rounded-md ring-1 ring-border/60">
            <img src={image.previewUrl} alt={image.name} class="size-full object-cover" />
            <button
              type="button"
              class="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-xs transition-opacity group-hover/thumb:opacity-100 focus-visible:opacity-100"
              aria-label={i18n.t("chat.removeImage", { name: image.name })}
              onclick={() => (images = images.filter((i) => i.id !== image.id))}
            >
              <Icon icon={CancelIcon} class="size-3" />
            </button>
          </span>
        {/each}
      </InputGroup.Addon>
    {/if}
    <InputGroup.Textarea
      bind:ref
      bind:value
      {onkeydown}
      {onpaste}
      oninput={readToken}
      onclick={readToken}
      onkeyup={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") readToken();
      }}
      onblur={() => (token = undefined)}
      {disabled}
      rows={1}
      placeholder={placeholder ?? i18n.t("chat.composerPlaceholder")}
      aria-label={i18n.t("chat.composerLabel")}
      class={cn("max-h-60 min-h-11 px-3 leading-5", text.body)}
    />
    <InputGroup.Addon align="block-end" class="gap-0.5">
      {#if acceptsImages}
        <InputGroup.Button
          size="icon-sm"
          variant="ghost"
          class="rounded-full text-muted-foreground"
          aria-label={i18n.t("chat.addImages")}
          title={i18n.t("chat.addImages")}
          disabled={disabled || images.length >= MAX_IMAGES}
          onclick={() => void chooseImages()}
        >
          <Icon icon={PlusIcon} class={icon.action} />
        </InputGroup.Button>
      {/if}
      {#if leading}{@render leading()}{/if}
      {#if trailing}{@render trailing()}{/if}
      <span class="flex-1"></span>
      {#if context && context.limit > 0}
        <ChatContextRing tokens={context.tokens} limit={context.limit} />
      {/if}
      {#if running && empty && onstop}
        <InputGroup.Button
          size="icon-sm"
          variant="secondary"
          class="rounded-full"
          aria-label={i18n.t("chat.stop")}
          title={i18n.t("chat.stop")}
          onclick={onstop}
        >
          <Icon icon={StopIcon} class={icon.action} />
        </InputGroup.Button>
      {:else}
        <InputGroup.Button
          size="icon-sm"
          variant="default"
          class="rounded-full"
          disabled={empty || disabled}
          aria-label={running ? i18n.t("chat.queue") : i18n.t("chat.send")}
          title={running ? i18n.t("chat.queue") : i18n.t("chat.send")}
          onclick={() => void submit()}
        >
          <Icon icon={ArrowUp02Icon} class={icon.action} />
        </InputGroup.Button>
      {/if}
    </InputGroup.Addon>
  </InputGroup.Root>
  {#if running && !empty}
    <p class={cn(text.meta, "px-1")}>{i18n.t("chat.queueHint")}</p>
  {/if}
</div>
