<script lang="ts">
  // Body of the persistent (pinned) update toast — the sonner-hosted replacement
  // for the old fixed top-of-page UpdateBanner. Same phases, copy and actions as
  // the banner (available → download; downloading → progress; downloaded →
  // install now / install when idle; installing → spinner; Dismiss), but styled
  // as a proper elevated card following the uxnan clean desktop UI design system:
  // solid background, border, release notes link, and consistent surface layering.

  import { updater } from "$lib/state/updater.svelte";
  import { i18n } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import XIcon from "@lucide/svelte/icons/x";

  let { closeToast: _closeToast }: { closeToast?: () => void } = $props();

  const version = $derived(updater.update?.version ?? "");
  const pct = $derived(updater.progressFraction);
  const hasNotes = $derived(
    updater.update?.notes !== null && updater.update?.notes !== undefined && updater.update?.notes.length > 0
  );
  const releaseUrl = $derived(
    `https://github.com/luisgamas/uxnan/releases/tag/desktop-v${version}`
  );
</script>

<div class="flex w-full items-start gap-3 rounded-lg border border-border/70 bg-[var(--ux-elevated)] p-3 shadow-md" role="status">
  <!-- Leading icon reflects the phase. -->
  {#if updater.status === "downloading" || updater.status === "installing"}
    <LoaderIcon class={cn(icon.button, "mt-0.5 shrink-0 animate-spin text-primary")} />
  {:else}
    <SparklesIcon class={cn(icon.button, "mt-0.5 shrink-0 text-primary")} />
  {/if}

  <!-- Message + progress bar + release notes link -->
  <div class="flex min-w-0 flex-1 flex-col gap-1">
    <span class={cn("text-foreground", text.body)}>
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

    <!-- Progress bar (download phase only) -->
    {#if updater.status === "downloading" && pct !== null}
      <div class="h-1 w-full max-w-48 overflow-hidden rounded-full bg-primary/20">
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-150"
          style="width: {Math.round(pct * 100)}%"
        ></div>
      </div>
    {/if}

    <!-- Agents-busy warning (install phase) -->
    {#if updater.status === "downloaded" && updater.agentsBusy}
      <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <TriangleAlertIcon class={icon.decorative} />
        <span class={text.indicator}>{i18n.t("updates.agentsBusyWarning")}</span>
      </span>
    {/if}

    <!-- Release notes link -->
    {#if hasNotes || (updater.status !== "idle" && updater.status !== "checking")}
      <a
        href={releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        class={cn(
          "inline-flex items-center gap-1 text-muted-foreground no-underline transition-colors hover:text-foreground",
          text.indicator,
        )}
        title={i18n.t("updates.releaseNotesTitle", { version })}
      >
        <ExternalLinkIcon class={icon.decorative} />
        {i18n.t("updates.releaseNotes")}
      </a>
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
      <Button
        variant="ghost"
        size="icon-sm"
        title={i18n.t("updates.dismiss")}
        aria-label={i18n.t("updates.dismiss")}
        onclick={() => updater.dismiss()}
      >
        <XIcon class={icon.button} />
      </Button>
    {/if}
  </div>
</div>
