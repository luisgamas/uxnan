<script lang="ts">
  // What a turn holds but its page left out — a run's steps, a step's full
  // output or diff, the whole reasoning (plans/046: pages are bounded, the
  // detail is read when asked for) — at the point it is asked for: a quiet
  // button that asks, a spinner while the bridge answers, or why it could not
  // (an answer too large for the connection included), with Retry. One place,
  // so every on-demand read in the timeline looks and behaves the same.
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { chatErrorText } from "./chatError";

  let {
    detail,
    label,
    onload,
  }: {
    /** The read so far; nothing yet when it was never asked for. */
    detail: { loading: boolean; error?: string } | undefined;
    /** What the button asking for it says; no button without one. */
    label?: string;
    /** Ask for it — `retry` after a failure, so a failure is never re-asked by itself. */
    onload: (retry: boolean) => void;
  } = $props();
</script>

{#if detail?.loading}
  <div class={cn(text.meta, "flex min-h-7 items-center gap-2 px-2")}>
    <Spinner class={icon.decorative} aria-label={i18n.t("common.loading")} />
    {i18n.t("common.loading")}
  </div>
{:else if detail?.error !== undefined}
  <div class="flex min-h-7 min-w-0 items-center gap-2 px-2">
    <span class={cn(text.meta, "min-w-0 flex-1 truncate text-destructive")} title={chatErrorText(detail.error)}>
      {chatErrorText(detail.error)}
    </span>
    <Button variant="ghost" size="xs" onclick={() => onload(true)}>{i18n.t("chat.retry")}</Button>
  </div>
{:else if label}
  <Button variant="ghost" size="xs" class="self-start text-muted-foreground" onclick={() => onload(false)}>
    {label}
  </Button>
{/if}
