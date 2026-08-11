<script lang="ts">
  // Shared navigation hints for the command-palette-style dialogs (quick switch +
  // add project), so they read coherently. Inline content only — the caller
  // gets the same footer surface and minimum height as action-based dialogs.
  import Kbd from "./Kbd.svelte";
  import { i18n } from "$lib/i18n";
  import { dialog } from "$lib/design";
  import { cn } from "$lib/utils";

  let { class: className }: { class?: string } = $props();
</script>

<div class={cn(dialog.footerSurface, "flex items-center gap-4 text-xs text-muted-foreground", className)}>
  <span class="flex items-center gap-1.5">
    <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span>
    {i18n.t("palette.hintNavigate")}
  </span>
  <span class="flex items-center gap-1.5">
    <Kbd>↵</Kbd>{i18n.t("palette.hintSelect")}
  </span>
  <span class="flex items-center gap-1.5">
    <Kbd>Esc</Kbd>{i18n.t("palette.hintExit")}
  </span>
</div>
