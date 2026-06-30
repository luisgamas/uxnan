<script lang="ts">
  import { untrack } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import type { TerminalProfile } from "$lib/types";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

  let {
    profile,
    onchange,
    onremove,
  }: {
    profile: TerminalProfile;
    onchange: () => void;
    onremove: () => void;
  } = $props();

  // Collapsed by default: the row shows the profile name and expands to its
  // command / args. One row of the profiles list, so it has no border of its own.
  let expanded = $state(false);

  // Args are edited as a local space-separated string and committed to the array.
  // Seeded once from the profile (rows are keyed by id, so a different profile
  // remounts this component) — the initial-value capture is intentional.
  let argsText = $state(untrack(() => profile.args.join(" ")));
  function commitArgs() {
    profile.args = argsText.split(/\s+/).filter(Boolean);
    onchange();
  }
</script>

<Collapsible.Root bind:open={expanded} class="flex flex-col gap-2 py-2">
  <div class="flex items-center gap-2">
    <Input
      class="h-8 text-xs"
      placeholder={i18n.t("profileEditor.namePlaceholder")}
      bind:value={profile.name}
      oninput={onchange}
    />
    <Collapsible.Trigger
      class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      title={i18n.t(expanded ? "project.collapse" : "project.expand")}
    >
      <ChevronDownIcon class={cn(icon.button, "transition-transform", expanded && "rotate-180")} />
    </Collapsible.Trigger>
    <Button
      variant="ghost"
      size="icon-sm"
      title={i18n.t("profileEditor.removeProfile")}
      onclick={onremove}
    >
      <Trash2Icon class={icon.button} />
    </Button>
  </div>
  <Collapsible.Content class="flex flex-col gap-1.5 sm:flex-row">
    <Input
      class="h-8 flex-1 font-mono text-xs"
      placeholder={i18n.t("profileEditor.commandPlaceholder")}
      bind:value={profile.command}
      oninput={onchange}
    />
    <Input
      class="h-8 flex-1 font-mono text-xs"
      placeholder={i18n.t("profileEditor.argsPlaceholder")}
      bind:value={argsText}
      oninput={commitArgs}
    />
  </Collapsible.Content>
</Collapsible.Root>
