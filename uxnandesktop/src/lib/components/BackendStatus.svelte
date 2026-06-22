<script lang="ts">
  // Status-bar backend indicator: a colored icon that opens a popover with live,
  // accurate detail about the Rust backend connection. Color tracks the state
  // (green = connected, amber = connecting, red = unreachable).
  import * as Popover from "$lib/components/ui/popover";
  import { app } from "$lib/state/app.svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import ServerIcon from "@lucide/svelte/icons/server";

  const state = $derived(
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
</script>

<Popover.Root>
  <Popover.Trigger
    class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    title={state.label}
    aria-label={state.label}
  >
    <ServerIcon class={cn("size-3.5", state.icon)} />
  </Popover.Trigger>
  <Popover.Content align="end" side="top" class="w-64 p-3">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class={cn("size-2 shrink-0 rounded-full", state.dot)}></span>
        <span class="text-sm font-medium text-foreground">{state.label}</span>
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
      <div class="flex items-center justify-between border-t border-border pt-2">
        <span class={text.meta}>{i18n.t("status.backendRepos")}</span>
        <span class={cn("font-medium text-foreground", text.body)}>{app.repos.length}</span>
      </div>
    </div>
  </Popover.Content>
</Popover.Root>
