<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { overlay } from "$lib/design";
  import { registerOverlay } from "$lib/overlayLayer";

  let {
    x,
    y,
    width = "standard",
    class: className,
    children,
    onClose,
    focusReturn,
  }: {
    x: number;
    y: number;
    width?: "simple" | "standard" | "wide";
    class?: string;
    children: Snippet;
    onClose?: () => void;
    /** Optional origin focus restored only for keyboard dismissal. Outside
     *  pointer dismissal intentionally leaves focus with the clicked target. */
    focusReturn?: HTMLElement | (() => void) | null;
  } = $props();

  let surface: HTMLDivElement;
  const anchorX = $derived(x);
  const anchorY = $derived(y);
  let position = $state({ left: 0, top: 0 });

  $effect(() => registerOverlay(surface));

  function measurePosition(): void {
    if (!surface || typeof window === "undefined") return;
    const rect = surface.getBoundingClientRect();
    const inset = 8;
    const next = {
      left: Math.max(inset, Math.min(anchorX, window.innerWidth - rect.width - inset)),
      top: Math.max(inset, Math.min(anchorY, window.innerHeight - rect.height - inset)),
    };
    if (next.left !== position.left || next.top !== position.top) position = next;
  }

  $effect(() => {
    anchorX;
    anchorY;
    width;
    surface;
    position = { left: anchorX, top: anchorY };
    queueMicrotask(measurePosition);
  });

  onMount(() => {
    const firstItem = surface?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    firstItem?.focus();
    measurePosition();
    const resizeObserver = new ResizeObserver(measurePosition);
    if (surface) resizeObserver.observe(surface);
    window.addEventListener("resize", measurePosition);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measurePosition);
    };
  });

  function items(): HTMLButtonElement[] {
    return Array.from(surface?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFromKeyboard();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      closeFromKeyboard();
      return;
    }
    const menuItems = items();
    const current = document.activeElement;
    const index = menuItems.indexOf(current as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!menuItems.length) return;
      const offset = event.key === "ArrowDown" ? 1 : -1;
      menuItems[(index + offset + menuItems.length) % menuItems.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? menuItems[0] : menuItems.at(-1))?.focus();
    }
  }

  function handleOutsidePointerdown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Node) || !surface?.contains(target)) onClose?.();
  }

  function closeFromKeyboard(): void {
    onClose?.();
    queueMicrotask(() => {
      if (typeof focusReturn === "function") focusReturn();
      else focusReturn?.focus();
    });
  }
</script>

<div
  bind:this={surface}
  class={cn(
    "fixed z-50",
    overlay.menuSurface,
    width === "simple" ? overlay.menuSimple : width === "wide" ? overlay.menuWide : overlay.menuStandard,
    className,
  )}
  style="left:{position.left}px; top:{position.top}px"
  role="menu"
  tabindex="-1"
  onpointerdown={(event) => event.stopPropagation()}
  onkeydown={handleKeydown}
>
  {@render children?.()}
</div>
<svelte:window onpointerdown={handleOutsidePointerdown} />
