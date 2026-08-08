<script lang="ts">
  // Body of the persistent (pinned) update toast — the sonner-hosted replacement
  // for the old fixed top-of-page UpdateBanner. Same phases, copy and actions as
  // the banner (available → download; downloading → progress; downloaded →
  // install now / install when idle; installing → spinner; Dismiss), but styled
  // as a proper elevated card following the uxnan clean desktop UI design system:
  // solid background, border, release notes link, and consistent surface layering.

  import { updater } from "$lib/state/updater.svelte";
  import { app } from "$lib/state/app.svelte";
  import { openExternal } from "$lib/api";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { Icon } from "$lib/components/ui/icon";
  import DownloadIcon from "@hugeicons/core-free-icons/Download01Icon";
  import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
  import LoaderIcon from "@hugeicons/core-free-icons/Loading01Icon";
  import TriangleAlertIcon from "@hugeicons/core-free-icons/Alert01Icon";
  import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon";
  import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";

  let { closeToast: _closeToast }: { closeToast?: () => void } = $props();

  const version = $derived(updater.update?.version ?? "");
  const pct = $derived(updater.progressFraction);
  const channel = $derived(app.settings.updater?.channel ?? "stable");
  const releaseUrl = $derived(
    `https://github.com/luisgamas/uxnan/releases/tag/desktop-${channel}-v${version}`
  );
</script>

<div
  class="relative flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border/70 bg-[var(--ux-elevated)] p-3.5 shadow-md"
  role="status"
>
  {#if updater.status !== "installing"}
    <TooltipSimple title={i18n.t("updates.dismiss")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-sm"
          class={cn(iconButton.sm, "absolute right-2 top-2")}
          aria-label={i18n.t("updates.dismiss")}
          onclick={() => updater.dismiss()}
        >
          <Icon icon={XIcon} class={icon.button} />
        </Button>
      {/snippet}
    </TooltipSimple>
  {/if}

  <div class="flex min-w-0 items-start gap-2 pr-8">
    {#if updater.status === "downloading" || updater.status === "installing"}
      <Icon icon={LoaderIcon} class={cn(icon.button, "mt-0.5 shrink-0 animate-spin text-primary")} />
    {:else}
      <Icon icon={SparklesIcon} class={cn(icon.button, "mt-0.5 shrink-0 text-primary")} />
    {/if}
    <span class={cn("min-w-0 text-foreground", text.heading)}>
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
  </div>

  <div class="flex min-w-0 flex-col gap-2">
    {#if updater.status === "downloading" && pct !== null}
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-primary/15" aria-label={`${Math.round(pct * 100)}%`}>
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-150"
          style="width: {Math.round(pct * 100)}%"
        ></div>
      </div>
    {/if}

    {#if updater.status === "downloaded" && updater.agentsBusy}
      <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <Icon icon={TriangleAlertIcon} class={icon.decorative} />
        <span class={text.body}>{i18n.t("updates.agentsBusyWarning")}</span>
      </span>
    {/if}

    {#if updater.status === "downloaded"}
      <button
        type="button"
        onclick={() => void openExternal(releaseUrl).catch(() => {})}
        class={cn(
          "inline-flex w-fit items-center gap-1 text-left text-muted-foreground transition-colors hover:text-foreground",
          text.body,
        )}
        title={i18n.t("updates.releaseNotesTitle", { version })}
      >
        <Icon icon={ExternalLinkIcon} class={icon.decorative} />
        {i18n.t("updates.releaseNotes")}
      </button>
    {/if}
  </div>

  {#if updater.status === "available"}
    <Button class="w-full" size="sm" onclick={() => void updater.download()}>
      <Icon icon={DownloadIcon} data-icon="inline-start" />
      {i18n.t("updates.download")}
    </Button>
  {:else if updater.status === "downloaded"}
    <div class="flex w-full flex-col gap-1.5">
      {#if updater.agentsBusy}
        <Button class="w-full" variant="outline" size="sm" onclick={() => updater.installWhenIdle()}>
          {i18n.t("updates.installWhenIdle")}
        </Button>
      {/if}
      <Button class="w-full" size="sm" onclick={() => void updater.installNow()}>
        {i18n.t("updates.installNow")}
      </Button>
    </div>
  {/if}
</div>
