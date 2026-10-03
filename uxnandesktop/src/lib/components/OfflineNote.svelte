<script lang="ts">
  // What a panel says while the host it describes is away: what is on screen is
  // what was read then, kept so the user does not lose their place, and nothing
  // can change it until the host is back. A panel that kept another machine's
  // state on screen without this line would be claiming it is current.
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { relativeTime } from "$lib/relativeTime";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";

  let { host, readAt }: { host: string; readAt: number } = $props();

  // "read 3 minutes ago" keeps counting while the note is up.
  let now = $state(Date.now());
  $effect(() => {
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(tick);
  });
</script>

<p class={cn("flex items-start gap-2 px-3 py-1.5", text.meta)} role="status">
  <span class="mt-1.5 flex shrink-0"><StatusDot tone="off" /></span>
  <span>{i18n.t("offline.note", { host, when: relativeTime(readAt, i18n.locale, now) })}</span>
</p>
