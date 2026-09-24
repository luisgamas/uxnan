<script lang="ts">
  // The body of a chat tab: a conversation the Uxnan bridge drives, shown next
  // to the terminals (plan 030). Three states — no bridge to talk to, a new
  // chat choosing its agent, and a running conversation.
  import { bridge } from "$lib/bridge/client.svelte";
  import type { ChatTab } from "$lib/state/terminals.svelte";
  import ChatBridgeGate from "./ChatBridgeGate.svelte";
  import ChatStart from "./ChatStart.svelte";
  import ChatConversation from "./ChatConversation.svelte";
  import { pane } from "$lib/design";

  let { tab, active }: { tab: ChatTab; active: boolean } = $props();
</script>

<div class={pane.root}>
  {#if !bridge.connected}
    <ChatBridgeGate />
  {:else if !tab.threadId}
    <ChatStart {tab} {active} />
  {:else}
    {#key tab.threadId}
      <ChatConversation {tab} threadId={tab.threadId} cwd={tab.cwd} {active} />
    {/key}
  {/if}
</div>
