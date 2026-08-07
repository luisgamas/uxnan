<script lang="ts">
  // Status-bar backend indicator: a colored icon that opens a popover with live,
  // accurate detail about the Rust backend connection. Color tracks the state
  // (green = connected, amber = connecting, red = unreachable).
  //
  // GitHub's passive readout (unread notifications + API rate limit) lives in
  // this popover instead of its own status-bar button: both answer "how is the
  // app talking to the outside", and folding them together keeps the bar quiet.
  // Unread notifications stay passively visible as a dot on the trigger, so the
  // signal the old button carried isn't lost behind a click.
  import * as Popover from "$lib/components/ui/popover";
  import ResourceSummary from "$lib/components/ResourceSummary.svelte";
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { resources } from "$lib/state/resources.svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { Icon } from "$lib/components/ui/icon";
  import ServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
  import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
  import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";

  const backend = $derived(
    app.backend === "ready"
      ? {
          dot: "bg-green-500",
          icon: "text-green-600 dark:text-green-400",
          label: i18n.t("status.connected"),
        }
      : app.backend === "connecting"
        ? {
            dot: "bg-amber-500",
            icon: "text-amber-600 dark:text-amber-400",
            label: i18n.t("status.connecting"),
          }
        : {
            dot: "bg-destructive",
            icon: "text-destructive",
            label: i18n.t("status.unreachable"),
          },
  );

  // Same gate the standalone button had: the status-bar setting is on and `gh`
  // is installed + signed in (nothing to show otherwise).
  const showGithub = $derived(
    (app.settings.github?.statusBarEnabled ?? true) && github.available,
  );
  // The unread count is only polled when its setting is on; without it the store
  // holds a stale zero, which must not be shown as fact.
  const showUnread = $derived(
    showGithub && app.settings.github?.notificationsEnabled === true,
  );
  const unread = $derived(showUnread ? github.notifications : 0);
  const rate = $derived(github.rateLimit);

  // The trigger tooltip carries the unread count too — the dot says "something",
  // the tooltip says what.
  const triggerLabel = $derived(
    unread > 0
      ? `${backend.label} · ${i18n.plural(unread, "status.githubUnreadOne", "status.githubUnreadOther")}`
      : backend.label,
  );

  // Controlled so the settings row can close the popover explicitly.
  let open = $state(false);
  let triggerTooltipOpen = $state(false);

  // The resource section renders only while the feature is on; its sampling
  // lease follows the popover's lifecycle (open = sample, closed = parked).
  const showResources = $derived(resources.enabled);

  /** Opening is the moment to re-read the two cheap GitHub values (so the
   *  popover never shows a figure up to one poll interval old) and to take /
   *  release the resource-sampling lease. */
  function onOpenChange(next: boolean): void {
    if (showResources) {
      if (next) void resources.open();
      else void resources.close();
    }
    if (!next || !showGithub) return;
    void github.refreshRateLimit();
    if (showUnread) void github.refreshNotifications();
  }
</script>

<Popover.Root bind:open {onOpenChange}>
  <TooltipSimple bind:open={triggerTooltipOpen} title={triggerLabel}>
    {#snippet children(tp)}
      <Popover.Trigger
        {...tp}
        class="relative flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label={triggerLabel}
      >
        <Icon icon={ServerIcon} class={cn("size-3.5", backend.icon)} />
        {#if unread > 0}
          <span
            class="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background"
            aria-hidden="true"
          ></span>
        {/if}
      </Popover.Trigger>
    {/snippet}
  </TooltipSimple>
  <Popover.Content
    align="end"
    side="top"
    class="w-64 p-0"
    onOpenAutoFocus={(event) => event.preventDefault()}
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      triggerTooltipOpen = false;
      (document.activeElement as HTMLElement | null)?.blur();
    }}
  >
    <div class="flex flex-col gap-2 p-3">
      <div class="flex items-center gap-2">
        <span class={cn("size-2 shrink-0 rounded-full", backend.dot)}></span>
        <span class="text-sm font-medium text-foreground">{backend.label}</span>
      </div>
      <p class={text.meta}>{i18n.t("status.backendDesc")}</p>
      {#if app.errorMessage}
        <div
          class={cn(
            "rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-destructive",
            text.meta,
          )}
        >
          {app.errorMessage}
        </div>
      {/if}
      <div class="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span class={cn("min-w-0 truncate", text.meta)}>{i18n.t("status.backendRepos")}</span>
        <span class={cn("shrink-0 font-medium tabular-nums text-foreground", text.body)}>
          {app.repos.length}
        </span>
      </div>
    </div>

    {#if showResources}
      <ResourceSummary />
      <button
        type="button"
        class="flex w-full items-center gap-1.5 border-t border-border/60 px-3 py-2 text-muted-foreground hover:text-foreground {text.meta}"
        onclick={() => {
          open = false;
          app.openSettings("resources");
        }}
      >
        <Icon icon={SettingsIcon} class="size-3.5" />
        {i18n.t("resources.settingsLink")}
      </button>
    {/if}

    {#if showGithub}
      <div class="flex flex-col gap-2 border-t border-border/60 p-3">
        <div class="flex items-center gap-1.5">
          <Icon icon={GitPullRequestIcon} class="size-3.5 text-muted-foreground" />
          <span class="text-sm font-medium text-foreground">{i18n.t("github.title")}</span>
        </div>
        {#if showUnread}
          <div class="flex items-center justify-between gap-2">
            <span class={cn("min-w-0 truncate", text.meta)}>{i18n.t("status.githubUnread")}</span>
            <span
              class={cn(
                "shrink-0 font-medium tabular-nums",
                unread > 0 ? "text-foreground" : "text-muted-foreground",
                text.body,
              )}
            >
              {unread}
            </span>
          </div>
        {/if}
        <div class="flex items-center justify-between gap-2">
          <span class={cn("min-w-0 truncate", text.meta)}>{i18n.t("github.account.rateLimit")}</span>
          <span class={cn("shrink-0 font-medium tabular-nums text-foreground", text.body)}>
            {#if rate}
              {rate.remaining} / {rate.limit}
            {:else}
              <span class="text-muted-foreground">—</span>
            {/if}
          </span>
        </div>
      </div>

      <button
        type="button"
        class="flex w-full items-center gap-1.5 border-t border-border/60 px-3 py-2 text-muted-foreground hover:text-foreground {text.meta}"
        onclick={() => {
          open = false;
          app.openSettings("github");
        }}
      >
        <Icon icon={SettingsIcon} class="size-3.5" />
        {i18n.t("status.githubSettings")}
      </button>
    {/if}
  </Popover.Content>
</Popover.Root>
