<script lang="ts">
  // Lightweight unified-diff renderer: colorizes added/removed/hunk lines from
  // the raw `git diff` text. (CodeMirror 6 with a proper diff extension is a
  // Phase 3 follow-up — FOR-DEV.)
  import { cn } from "$lib/utils";

  let { diff }: { diff: string } = $props();

  const lines = $derived(diff.length ? diff.split("\n") : []);

  function lineClass(l: string): string {
    if (l.startsWith("@@")) return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
    if (l.startsWith("+++") || l.startsWith("---")) return "text-muted-foreground";
    if (l.startsWith("+")) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    if (l.startsWith("-")) return "bg-red-500/10 text-red-700 dark:text-red-300";
    if (
      l.startsWith("diff ") ||
      l.startsWith("index ") ||
      l.startsWith("new file") ||
      l.startsWith("deleted file") ||
      l.startsWith("rename ") ||
      l.startsWith("similarity ")
    )
      return "text-muted-foreground";
    return "text-foreground";
  }
</script>

<div class="overflow-auto rounded-md border border-border bg-background font-mono text-xs leading-relaxed">
  {#each lines as line, i (i)}
    <div class={cn("whitespace-pre px-2", lineClass(line))}>{line || " "}</div>
  {/each}
</div>
