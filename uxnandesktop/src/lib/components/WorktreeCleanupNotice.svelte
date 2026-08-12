<script lang="ts">
  // A one-time status-bar nudge when the managed worktree folder has collected
  // enough checkouts to be worth a look.
  //
  // It exists because the folder is out of sight: the sibling folders it
  // replaced sat next to the repository and annoyed you into pruning them, and
  // a cleanup section nobody opens is the same problem with extra steps.
  //
  // Deliberately counts FOLDERS, not bytes. Measuring the size means walking
  // every checkout's `node_modules`, which is the most expensive thing this
  // feature can do, and it would happen at every startup to answer a question
  // that a directory listing answers well enough. Clicking through runs the
  // real scan, which is where the sizes come from.
  //
  // Dismissing is permanent (`worktrees.cleanupNoticeDismissed`): a nudge that
  // comes back after being waved away is nagging.
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { Icon } from "$lib/components/ui/icon";
  import { app } from "$lib/state/app.svelte";
  import { worktreeCleanupCount } from "$lib/api";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon as iconSize } from "$lib/design";
  import BroomIcon from "@hugeicons/core-free-icons/CleanIcon";
  import CloseIcon from "@hugeicons/core-free-icons/Cancel01Icon";

  /** Below this the folder is simply in use, and saying anything is noise. */
  const THRESHOLD = 12;

  let count = $state(0);
  let checked = $state(false);

  const dismissed = $derived(app.settings.worktrees?.cleanupNoticeDismissed === true);
  const show = $derived(checked && !dismissed && count >= THRESHOLD);

  $effect(() => {
    if (checked || dismissed) return;
    checked = true;
    void worktreeCleanupCount()
      .then((n) => (count = n))
      .catch(() => (count = 0));
  });

  function dismiss() {
    app.settings.worktrees = { ...app.settings.worktrees, cleanupNoticeDismissed: true };
    void app.persistSettings();
  }
</script>

{#if show}
  <div class="flex items-center">
    <TooltipSimple title={i18n.t("settings.worktreeCleanupNoticeHint")}>
      {#snippet children(props)}
        <button
          {...props}
          type="button"
          class={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium",
            "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          )}
          onclick={() => app.openSettings("git")}
        >
          <Icon icon={BroomIcon} class={iconSize.action} />
          {i18n.t("settings.worktreeCleanupNotice", { count })}
        </button>
      {/snippet}
    </TooltipSimple>
    <Button
      variant="ghost"
      size="icon-xs"
      class="size-6 text-muted-foreground/70 hover:text-foreground"
      title={i18n.t("settings.worktreeCleanupNoticeDismiss")}
      aria-label={i18n.t("settings.worktreeCleanupNoticeDismiss")}
      onclick={dismiss}
    >
      <Icon icon={CloseIcon} class="size-3" />
    </Button>
  </div>
{/if}
