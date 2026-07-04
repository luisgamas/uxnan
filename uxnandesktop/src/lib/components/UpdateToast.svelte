<script lang="ts">
  // Body of the persistent (pinned) update toast — the sonner-hosted replacement
  // for the old fixed top-of-page UpdateBanner. Same phases, copy and actions as
  // the banner (available → download; downloading → progress; downloaded →
  // install now / install when idle; installing → spinner; Dismiss), but styled
  // to sit inside a sonner toast card instead of a full-width primary strip.
  // Driven entirely by the `updater` store (see state/updater.svelte.ts), so its
  // content updates itself as `status`/`progress` change — the toast is shown
  // once with a stable id (see updateToast.ts) and never re-created.

  import { updater } from "$lib/state/updater.svelte";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import XIcon from "@lucide/svelte/icons/x";

  // svelte-sonner passes `closeToast` to a custom component; we don't use it —
  // dismissal goes through the store (updater.dismiss) so the toast re-hides via
  // bannerVisible. Declaring it keeps the prop a known attribute; it's
  // intentionally left unread.
  let { closeToast: _closeToast }: { closeToast?: () => void } = $props();

  const version = $derived(updater.update?.version ?? "");
  const pct = $derived(updater.progressFraction);
</script>

<div class="flex w-full items-center gap-3" role="status">
  <!-- Leading icon reflects the phase. -->
  {#if updater.status === "downloading" || updater.status === "installing"}
    <LoaderIcon class={cn(icon.button, "shrink-0 animate-spin text-primary")} />
  {:else}
    <SparklesIcon class={cn(icon.button, "shrink-0 text-primary")} />
  {/if}

  <!-- Message + (when downloading) a thin progress bar. -->
  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
    <span class={cn("truncate text-foreground", text.body)}>
      {#if updater.status === "available"}
        {i18n.t("updates.bannerAvailable", { version })}
      {:else if updater.status === "downloading"}
        {pct !== null
          ? i18n.t("updates.bannerDownloadingPct", {
              version,
              pct: String(Math.round(pct * 100)),
            })
          : i18n.t("updates.bannerDownloading", { version })}
      {:else if updater.status === "downloaded"}
        {i18n.t("updates.bannerDownloaded", { version })}
      {:else if updater.status === "installing"}
        {i18n.t("updates.bannerInstalling")}
      {/if}
    </span>
    {#if updater.status === "downloading" && pct !== null}
      <div class="h-1 w-full max-w-48 overflow-hidden rounded-full bg-primary/20">
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-150"
          style="width: {Math.round(pct * 100)}%"
        ></div>
      </div>
    {/if}
    {#if updater.status === "downloaded" && updater.agentsBusy}
      <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <TriangleAlertIcon class={icon.decorative} />
        <span class={text.indicator}>{i18n.t("updates.agentsBusyWarning")}</span>
      </span>
    {/if}
  </div>

  <!-- Actions per phase. -->
  <div class="flex shrink-0 items-center gap-1.5">
    {#if updater.status === "available"}
      <Button size="sm" onclick={() => void updater.download()}>
        <DownloadIcon data-icon="inline-start" />
        {i18n.t("updates.download")}
      </Button>
    {:else if updater.status === "downloaded"}
      {#if updater.agentsBusy}
        <Button size="sm" onclick={() => updater.installWhenIdle()}>
          {i18n.t("updates.installWhenIdle")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onclick={() => void updater.installNow()}
        >
          {i18n.t("updates.installNow")}
        </Button>
      {:else}
        <Button size="sm" onclick={() => void updater.installNow()}>
          {i18n.t("updates.installNow")}
        </Button>
      {/if}
    {/if}

    {#if updater.status !== "installing"}
      <TooltipSimple title={i18n.t("updates.dismiss")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="icon-sm"
            aria-label={i18n.t("updates.dismiss")}
            onclick={() => updater.dismiss()}
          >
            <XIcon class={icon.button} />
          </Button>
        {/snippet}
      </TooltipSimple>
    {/if}
  </div>
</div>
