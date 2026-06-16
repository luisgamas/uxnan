<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { app } from "$lib/state/app.svelte";
  import { agentMonitor } from "$lib/state/agentMonitor.svelte";
  import { agentStatus } from "$lib/state/agentStatus.svelte";

  let { children } = $props();

  // Hydrate from the Rust backend once the webview is mounted.
  onMount(() => {
    app.init();
    // Listen for agents detected (or stopped) in any terminal.
    void agentMonitor.startDetection();
    // Hydrate + subscribe to precise hook-reported agent states.
    void agentStatus.start();
  });

  // Re-sync the agent commands to detect whenever the configured agents change.
  $effect(() => {
    void app.agentProfiles.length;
    app.syncAgentCommands();
  });

  // Keep the document theme in sync with the persisted setting.
  $effect(() => {
    const dark = app.prefersDark();
    document.documentElement.classList.toggle("dark", dark);
  });
</script>

{@render children()}
