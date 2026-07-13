<script lang="ts">
  // Status-bar GitHub button: opens the GitHub section, shows the unread
  // notifications count (when enabled) and the API rate-limit remaining in a
  // tooltip. Hidden when disabled or not signed in (nothing to show).
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";

  const show = $derived((app.settings.github?.statusBarEnabled ?? true) && github.available);
  const tip = $derived(
    github.rateLimit
      ? i18n.t("github.account.rateLimitValue", {
          remaining: github.rateLimit.remaining,
          limit: github.rateLimit.limit,
        })
      : i18n.t("github.open"),
  );
</script>

{#if show}
  <TooltipSimple title={tip}>
    {#snippet children(props)}
      <button
        {...props}
        class="inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:text-foreground"
        aria-label={i18n.t("github.open")}
        onclick={() => app.openGitHub()}
      >
        <GitPullRequestIcon class="size-3.5" />
        {#if github.notifications > 0}
          <span class="min-w-3.5 rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {github.notifications}
          </span>
        {/if}
      </button>
    {/snippet}
  </TooltipSimple>
{/if}
