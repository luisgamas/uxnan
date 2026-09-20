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
  // One status-bar item, in the bar's own style, that opens Settings → Git —
  // and retires itself on that click: once the person has looked, the nudge
  // has done its job, and the section is always there to open on purpose. A
  // nudge that comes back after being looked at is nagging, so the retirement
  // is permanent (`worktrees.cleanupNoticeDismissed`).
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { Icon } from "$lib/components/ui/icon";
  import { app } from "$lib/state/app.svelte";
  import { worktreeCleanupCount } from "$lib/api";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon as iconSize, shell } from "$lib/design";
  import BroomIcon from "@hugeicons/core-free-icons/CleanIcon";

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

  /** Open the cleanup section and retire the nudge: it has been looked at. */
  function lookAndRetire() {
    app.settings.worktrees = { ...app.settings.worktrees, cleanupNoticeDismissed: true };
    void app.persistSettings();
    app.openSettings("git");
  }
</script>

{#if show}
  <TooltipSimple title={i18n.t("settings.worktreeCleanupNoticeHint")}>
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        class={cn(
          shell.statusBarItem,
          "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          focus.ring,
        )}
        aria-label={i18n.t("settings.worktreeCleanupNoticeHint")}
        onclick={lookAndRetire}
      >
        <Icon icon={BroomIcon} class={iconSize.action} />
        {i18n.t("settings.worktreeCleanupNotice", { count })}
      </button>
    {/snippet}
  </TooltipSimple>
{/if}
