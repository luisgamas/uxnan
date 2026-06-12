<script lang="ts">
  import { untrack } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { i18n } from "$lib/i18n";
  import { icon } from "$lib/design";
  import type { TerminalProfile } from "$lib/types";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let {
    profile,
    onchange,
    onremove,
  }: {
    profile: TerminalProfile;
    onchange: () => void;
    onremove: () => void;
  } = $props();

  // Args are edited as a local space-separated string and committed to the array.
  // Seeded once from the profile (rows are keyed by id, so a different profile
  // remounts this component) — the initial-value capture is intentional.
  let argsText = $state(untrack(() => profile.args.join(" ")));
  function commitArgs() {
    profile.args = argsText.split(/\s+/).filter(Boolean);
    onchange();
  }
</script>

<div class="flex flex-col gap-2 rounded-md border border-border p-2.5">
  <div class="flex items-center gap-2">
    <Input
      class="h-8 text-xs"
      placeholder={i18n.t("profileEditor.namePlaceholder")}
      bind:value={profile.name}
      oninput={onchange}
    />
    <Button
      variant="ghost"
      size="icon-sm"
      title={i18n.t("profileEditor.removeProfile")}
      onclick={onremove}
    >
      <Trash2Icon class={icon.button} />
    </Button>
  </div>
  <div class="flex flex-col gap-1.5 sm:flex-row">
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
  </div>
</div>
