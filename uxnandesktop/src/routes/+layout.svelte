<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { app } from "$lib/state/app.svelte";

  let { children } = $props();

  // Hydrate from the Rust backend once the webview is mounted.
  onMount(() => {
    app.init();
  });

  // Keep the document theme in sync with the persisted setting.
  $effect(() => {
    const dark = app.prefersDark();
    document.documentElement.classList.toggle("dark", dark);
  });
</script>

{@render children()}
