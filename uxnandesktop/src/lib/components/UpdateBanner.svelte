<script lang="ts">
  // Slim, dismissible banner shown under the title bar when an update is
  // available / downloading / ready to install. Persistent (not a toast) because
  // it carries a choice: install now, install once agents are idle, or later.
  // Driven entirely by the `updater` store (see state/updater.svelte.ts).

  import { updater } from "$lib/state/updater.svelte";
  import { i18n } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import XIcon from "@lucide/svelte/icons/x";

  const version = $derived(updater.update?.version ?? "");
  const pct = $derived(updater.progressFraction);
</script>

{#if updater.bannerVisible}
  <div
    class="flex shrink-0 items-center gap-3 border-b border-border bg-primary/10 px-3 py-1.5"
    role="status"
  >
    <!-- Leading icon reflects the phase. -->
    {#if updater.status === "downloading" || updater.status === "installing"}
      <LoaderIcon class={cn(icon.button, "shrink-0 animate-spin text-primary")} />
    {:else}
      <SparklesIcon class={cn(icon.button, "shrink-0 text-primary")} />
    {/if}

    <!-- Message + (when downloading) a thin progress bar. -->
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class={cn("truncate", text.body)}>
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
{/if}
