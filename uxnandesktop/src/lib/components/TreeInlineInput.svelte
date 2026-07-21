<script lang="ts">
  // Shared inline text field for the file tree — the editable input behind both the
  // "New File/Folder" draft row and in-place rename (VSCode-style). It owns the row
  // layout (indent + a leading `icon` snippet + the input, with a failed commit's
  // error shown just below): autofocuses (optionally pre-selecting the basename),
  // commits on Enter/blur (when non-empty and changed), cancels on Escape, and keeps
  // the field focused on a failed Enter so the error can be fixed.
  import { untrack, type Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";

  let {
    indent = 0,
    icon,
    initial = "",
    select = "none",
    placeholder = "",
    ariaLabel,
    oncommit,
    oncancel,
  }: {
    /** Left padding (px) so the row lines up with its tree siblings. */
    indent?: number;
    /** Leading chevron/spacer + file/folder icon, rendered before the input. */
    icon?: Snippet;
    /** Pre-filled value (the current name for rename; "" for a new entry). */
    initial?: string;
    /** Text to pre-select on focus: the basename (before the last dot), all, or none. */
    select?: "basename" | "all" | "none";
    placeholder?: string;
    ariaLabel?: string;
    /** Persist the (trimmed) value. Throw to show the message inline. */
    oncommit: (value: string) => Promise<void>;
    oncancel: () => void;
  } = $props();

  // Seed the field from `initial` once (read via untrack — the input then owns `value`
  // independently; `initial` never changes while a single input is mounted).
  let value = $state(untrack(() => initial));
  let busy = $state(false);
  let error = $state<string | null>(null);
  // Guards against a late blur firing after Enter/Escape already resolved the input.
  let settled = false;

  /** Focus + reveal the input once it mounts (the menu that opened it has closed). */
  function focusInput(el: HTMLInputElement) {
    queueMicrotask(() => {
      el.focus();
      el.scrollIntoView({ block: "nearest" });
      if (select === "all") el.select();
      else if (select === "basename") {
        const dot = el.value.lastIndexOf(".");
        el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
      }
    });
  }

  async function commit(fromBlur: boolean) {
    if (busy || settled) return;
    const name = value.trim();
    if (!name || name === initial.trim()) {
      cancel(); // empty or unchanged → just dismiss (abandoned create / no-op rename)
      return;
    }
    busy = true;
    error = null;
    try {
      await oncommit(name);
      settled = true; // parent clears the state → this input unmounts
    } catch (e) {
      // On blur the field already lost focus, so drop it rather than leaving an
      // unfocused, error-stuck input; on Enter keep it open to fix the name.
      if (fromBlur) {
        cancel();
        return;
      }
      error = e instanceof Error ? e.message : i18n.t("fileTree.invalidName");
      busy = false;
    }
  }

  function cancel() {
    if (settled) return;
    settled = true;
    oncancel();
  }
</script>

<div class="flex flex-col">
  <div
    class="flex h-7 w-full items-center gap-1 rounded-md pr-1"
    style="padding-left: {indent}px"
  >
    {@render icon?.()}
    <input
      use:focusInput
      bind:value
      spellcheck={false}
      autocomplete="off"
      {placeholder}
      aria-label={ariaLabel}
      aria-invalid={error ? "true" : undefined}
      class={cn(
        "min-w-0 flex-1 rounded-sm border bg-background px-1.5 py-0.5 outline-none placeholder:text-muted-foreground/50",
        text.body,
        error
          ? "border-destructive focus-visible:ring-2 focus-visible:ring-destructive/30"
          : "border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/30",
      )}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit(false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      onblur={() => void commit(true)}
    />
  </div>
  {#if error}
    <p
      class="pb-1 pr-1 text-[11px] leading-4 break-words text-destructive"
      style="padding-left: {indent + 20}px"
    >
      {error}
    </p>
  {/if}
</div>
