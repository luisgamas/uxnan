<script lang="ts">
  // Status-bar GitHub indicator (passive): shows the unread notifications count
  // (when enabled) and the API rate-limit remaining in a tooltip. GitHub itself
  // opens per-project from each project card's ⋯ menu, so this no longer
  // navigates anywhere — it's purely informational. Hidden when disabled or not
  // signed in (nothing to show).
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { i18n } from "$lib/i18n";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";

  const show = $derived((app.settings.github?.statusBarEnabled ?? true) && github.available);
  const tip = $derived(
    github.rateLimit
      ? i18n.t("github.account.rateLimitValue", {
          remaining: github.rateLimit.remaining,
          limit: github.rateLimit.limit,
        })
      : i18n.t("github.title"),
  );
</script>

{#if show}
  <TooltipSimple title={tip}>
    {#snippet children(props)}
      <span
        {...props}
        class="inline-flex items-center gap-1 px-1 text-muted-foreground"
        aria-label={i18n.t("github.title")}
      >
        <GitPullRequestIcon class="size-3.5" />
        {#if github.notifications > 0}
          <span class="min-w-3.5 rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {github.notifications}
          </span>
        {/if}
      </span>
    {/snippet}
  </TooltipSimple>
{/if}
