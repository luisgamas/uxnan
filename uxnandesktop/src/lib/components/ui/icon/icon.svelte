<script lang="ts" module>
  import type { SVGAttributes } from "svelte/elements";

  /** One drawable node of a Hugeicons glyph: `[tag, attributes]`, exactly the
   *  shape `@hugeicons/core-free-icons` ships. Attribute keys arrive in
   *  camelCase (`strokeLinecap`) and carry a bookkeeping `key` we drop. */
  export type IconNode = readonly (readonly [
    string,
    Readonly<Record<string, string | number>>,
  ])[];

  export interface IconProps extends SVGAttributes<SVGSVGElement> {
    /** A glyph imported from `@hugeicons/core-free-icons/<Name>Icon`. */
    icon: IconNode;
    /** Pixel footprint. Prefer a Tailwind `size-*` class (see `icon` in
     *  `$lib/design`) — CSS wins over these geometry attributes, so this is
     *  only the fallback for callers that pass no class. */
    size?: number | string;
    /** Overrides the 1.5 stroke the glyph data carries. */
    strokeWidth?: number | string;
  }
</script>

<script lang="ts">
  // Renders a Hugeicons glyph declaratively.
  //
  // We deliberately do NOT use the official `@hugeicons/svelte` component: it
  // paints via `innerHTML` inside `onMount`, which (a) renders an empty `<svg>`
  // until hydration, (b) never repaints when the `icon` prop changes — the
  // glyph is captured once at mount — and (c) tears down and rebuilds every
  // child on any prop update. Several call sites here swap the glyph reactively
  // (agent state, view mode, settings rows), so (b) alone rules it out.
  //
  // The upstream package we do depend on is the icon *data*
  // (`@hugeicons/core-free-icons`, MIT), imported one glyph per subpath so the
  // bundler only ever pulls what a screen actually uses.

  let { icon, size = 24, strokeWidth, ...rest }: IconProps = $props();

  const toKebab = (key: string) =>
    key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

  const nodes = $derived(
    icon.map(([tag, attributes]) => {
      const attrs: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (key === "key") continue;
        attrs[toKebab(key)] = value;
      }
      // Only thicken strokes — a filled shape has no `stroke` to widen.
      if (strokeWidth !== undefined && attrs.stroke !== undefined) {
        attrs["stroke-width"] = strokeWidth;
      }
      return { tag, attrs };
    }),
  );
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  aria-hidden="true"
  {...rest}
>
  {#each nodes as node, i (i)}
    <svelte:element this={node.tag} {...node.attrs} />
  {/each}
</svg>
