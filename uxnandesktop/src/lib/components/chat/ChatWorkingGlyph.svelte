<script lang="ts">
  // The chat's live mark — the agent working, a step running. It is the same
  // spinner, in the same hue, that says "working" in the sidebar and on the
  // project cards (`AgentStatusIndicator`), so the app shows that state one way.
  import { cn } from "$lib/utils";
  import { stateHue } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { Spinner } from "$lib/components/ui/spinner";

  let { class: className }: { class?: string } = $props();
</script>

<span
  class={cn("inline-flex size-3.5 shrink-0 items-center justify-center", stateHue.working, className)}
  role="status"
  aria-label={i18n.t("chat.working")}
>
  <Spinner class="size-3" aria-hidden="true" role="presentation" />
</span>
