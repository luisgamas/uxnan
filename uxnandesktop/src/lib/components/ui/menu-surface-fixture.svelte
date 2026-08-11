<script lang="ts">
  import MenuSurface from "./menu-surface.svelte";

  let { x = 32, y = 32, onClose }: { x?: number; y?: number; onClose?: () => void } = $props();
  let origin = $state<HTMLButtonElement>();
</script>

<button bind:this={origin} aria-label="underlying target">Underlying</button>
<MenuSurface {x} {y} focusReturn={origin} onClose={onClose}>
  {#snippet children()}
    <button role="menuitem">First</button>
    <button role="menuitem">Second</button>
    <button role="menuitem">Third</button>
  {/snippet}
</MenuSurface>
