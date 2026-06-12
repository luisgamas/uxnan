<script lang="ts">
  import { untrack } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import type { AgentProfile } from "$lib/types";
  import BotIcon from "@lucide/svelte/icons/bot";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let {
    agent,
    onchange,
    onremove,
  }: {
    agent: AgentProfile;
    onchange: () => void;
    onremove: () => void;
  } = $props();

  // Args are edited as a local space-separated string and committed to the array.
  // Seeded once (rows are keyed by id, so a different agent remounts this).
  let argsText = $state(untrack(() => agent.args.join(" ")));
  function commitArgs() {
    agent.args = argsText.split(/\s+/).filter(Boolean);
    onchange();
  }
</script>

<div class="flex flex-col gap-2 rounded-md border border-border p-2.5">
  <div class="flex items-center gap-2">
    <BotIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    <Input
      class="h-8 text-xs"
      placeholder={i18n.t("agentEditor.namePlaceholder")}
      bind:value={agent.name}
      oninput={onchange}
    />
    <Button
      variant="ghost"
      size="icon-sm"
      title={i18n.t("agentEditor.removeAgent")}
      onclick={onremove}
    >
      <Trash2Icon class={icon.button} />
    </Button>
  </div>
  <div class="flex flex-col gap-1.5 sm:flex-row">
    <Input
      class="h-8 flex-1 font-mono text-xs"
      placeholder={i18n.t("agentEditor.commandPlaceholder")}
      bind:value={agent.command}
      oninput={onchange}
    />
    <Input
      class="h-8 flex-1 font-mono text-xs"
      placeholder={i18n.t("agentEditor.argsPlaceholder")}
      bind:value={argsText}
      oninput={commitArgs}
    />
  </div>
</div>
