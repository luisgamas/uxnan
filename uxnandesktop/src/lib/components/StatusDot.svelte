<script lang="ts" module>
  export type StatusTone = "ok" | "warn" | "error" | "busy" | "off";
</script>

<script lang="ts">
  // The small colored dot a settings row or a list row puts before a
  // connection's state — GitHub signed in, an SSH host connected, the bridge
  // reachable. One component, so the tones mean the same thing everywhere:
  // `ok` connected, `warn` reachable but needs attention, `error` failed,
  // `busy` in progress (pulsing), `off` not connected.
  import { cn } from "$lib/utils";

  let {
    tone,
    label,
    class: className,
  }: {
    tone: StatusTone;
    /** Spoken/hovered name of the state, when no text next to the dot says it. */
    label?: string;
    class?: string;
  } = $props();

  const TONES: Record<StatusTone, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    error: "bg-destructive",
    busy: "animate-pulse bg-amber-500",
    off: "bg-muted-foreground/40",
  };
</script>

<span
  class={cn("size-2 shrink-0 rounded-full", TONES[tone], className)}
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
  title={label}
></span>
