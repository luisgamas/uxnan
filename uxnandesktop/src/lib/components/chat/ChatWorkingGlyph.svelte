<script lang="ts">
  // The chat's live mark — the agent working, a step running. It is the same
  // Comet Trail, in the same hue, that says "working" in the sidebar and on the
  // project cards (`AgentStatusIndicator`), so the app shows that state one way.
  import { cn } from "$lib/utils";
  import { stateHue } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import CometTrail from "../CometTrail.svelte";

  let { class: className }: { class?: string } = $props();
</script>

<span
  class={cn("inline-flex size-3.5 shrink-0 items-center justify-center", stateHue.working, className)}
  role="status"
  aria-label={i18n.t("chat.working")}
>
  <CometTrail size={12} />
</span>
