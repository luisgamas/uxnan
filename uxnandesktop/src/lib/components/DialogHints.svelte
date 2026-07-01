<script lang="ts">
  // Shared navigation hints for the command-palette-style dialogs (quick switch +
  // add project), so they read coherently. Inline content only — the caller
  // provides the surrounding bar/footer chrome.
  import Kbd from "./Kbd.svelte";
  import { i18n } from "$lib/i18n";

  let { class: className }: { class?: string } = $props();
</script>

<div class="flex items-center gap-4 text-[11px] text-muted-foreground {className ?? ''}">
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
