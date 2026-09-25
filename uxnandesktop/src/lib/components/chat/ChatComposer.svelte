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
  // FOR-DEV: image attachments (`turn/send { attachments }`, when the agent
  // advertises `images`), the `/` command palette (`agent/commands` +
  // `turn/send { command }`) and `@` file mentions, which the phone's composer
  // has. Deferred to keep the first chat release reviewable; see FOR-DEV.md →
  // Phase 6 → Chat tabs.
  //
  // Built on the shared `InputGroup` (the same primitive the command palette's
  // search uses): a `Textarea` over a `block-end` toolbar of quiet pills — the
  // agent and the model with its run options (`leading`), the access mode
  // (`trailing`) — then the context ring and the round send / stop button.
  import * as InputGroup from "$lib/components/ui/input-group";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
  import StopIcon from "@hugeicons/core-free-icons/StopIcon";
  import type { Snippet } from "svelte";
  import ChatContextRing from "./ChatContextRing.svelte";
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
  }: {
    /** The text being written (the view persists it as the tab's draft). */
    value?: string;
    /** The thread's earlier messages, oldest first, for ↑ / ↓ recall. */
    history?: string[];
    running?: boolean;
    disabled?: boolean;
    placeholder?: string;
    autofocus?: boolean;
    onsend: (text: string) => void | Promise<void>;
    onstop?: () => void;
    /** Controls shown at the start of the toolbar (the model picker). */
    leading?: Snippet;
    /** Controls shown after the leading ones (the access mode). */
    trailing?: Snippet;
    /** How full the context window is, when the agent reports it. */
    context?: { tokens: number; limit: number } | null;
  } = $props();

  let ref = $state<HTMLTextAreaElement | null>(null);
  const empty = $derived(value.trim().length === 0);

  $effect(() => {
    if (autofocus && ref && !disabled) ref.focus();
  });

  async function submit() {
    if (empty || disabled) return;
    const message = value;
    value = "";
    await onsend(message);
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

<div class="flex flex-col gap-1">
  <!-- The group dims only when the INPUT is disabled, not whenever any of its
       buttons is (the send button is disabled on an empty draft, and the
       primitive's `has-disabled` would fade the whole composer for it). -->
  <InputGroup.Root
    class="rounded-xl bg-card shadow-xs has-disabled:bg-card has-disabled:opacity-100 has-[textarea:disabled]:opacity-50"
  >
    <InputGroup.Textarea
      bind:ref
      bind:value
      {onkeydown}
      {disabled}
      rows={1}
      placeholder={placeholder ?? i18n.t("chat.composerPlaceholder")}
      aria-label={i18n.t("chat.composerLabel")}
      class={cn("max-h-60 min-h-11 px-3 leading-5", text.body)}
    />
    <InputGroup.Addon align="block-end" class="gap-0.5">
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
