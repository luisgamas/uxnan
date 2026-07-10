<script lang="ts">
  // Rendered Markdown preview for the file viewer's Preview mode. The source is
  // parsed into a typed AST by `$lib/markdown` (in-house, on the already-installed
  // Lezer parser) and rendered here with **plain Svelte markup — never `{@html}`**,
  // so a document from an untrusted repo can't script the webview. External links
  // open through the app opener; local relative images are resolved to data URLs
  // via the backend (the asset protocol isn't scoped to arbitrary paths).
  import { renderMarkdown, type MdBlock, type MdInline } from "$lib/markdown";
  import { fsReadDataUrl, openExternal } from "$lib/api";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";

  let { source, baseDir = null }: { source: string; baseDir?: string | null } = $props();

  const blocks = $derived(renderMarkdown(source));

  // --- local image resolution ------------------------------------------------
  // Remote (http/https) and data: srcs render directly; a local relative path is
  // read into a data URL once (cached by original src) so it displays without an
  // asset-protocol grant.
  let resolved = $state<Record<string, string>>({});

  function isRemote(src: string): boolean {
    return /^(https?:|data:)/i.test(src);
  }

  /** Resolve a possibly-relative image path against the document's folder. */
  function joinPath(dir: string, rel: string): string {
    if (/^[a-zA-Z]:\//.test(rel) || rel.startsWith("/")) return rel; // drive- or root-absolute
    const parts = dir.replace(/\/+$/, "").split("/");
    for (const seg of rel.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  }

  function collectImages(list: MdBlock[], out: Set<string>): void {
    for (const b of list) {
      if (b.type === "table") [...b.header, ...b.rows.flat()].forEach((c) => collectInlineImages(c, out));
      else if (b.type === "heading" || b.type === "paragraph") collectInlineImages(b.children, out);
      else if (b.type === "blockquote") collectImages(b.children, out);
      else if (b.type === "list") b.items.forEach((it) => collectImages(it.children, out));
    }
  }
  function collectInlineImages(nodes: MdInline[], out: Set<string>): void {
    for (const n of nodes) {
      if (n.type === "image" && n.src && !isRemote(n.src)) out.add(n.src);
      else if (n.type === "strong" || n.type === "em" || n.type === "del" || n.type === "link")
        collectInlineImages(n.children, out);
    }
  }

  // Resolve any new local images whenever the parsed document changes.
  $effect(() => {
    if (!baseDir) return;
    const wanted = new Set<string>();
    collectImages(blocks, wanted);
    for (const src of wanted) {
      if (src in resolved) continue;
      resolved[src] = ""; // mark in-flight so we don't re-request
      void fsReadDataUrl(joinPath(baseDir, src))
        .then((url) => (resolved[src] = url))
        .catch(() => {
          delete resolved[src];
        });
    }
  });

  /** The <img> src to use for an AST image: remote as-is, local resolved (or empty
   *  while loading / on failure). */
  function imgSrc(src: string): string {
    if (isRemote(src)) return src;
    return resolved[src] || "";
  }

  function onLinkClick(e: MouseEvent, href: string): void {
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) void openExternal(href);
  }
</script>

{#snippet inlineRun(nodes: MdInline[])}
  {#each nodes as n}
    {#if n.type === "text"}{n.value}{:else if n.type === "code"}<code class="md-code">{n.value}</code
      >{:else if n.type === "break"}<br />{:else if n.type === "strong"}<strong
        >{@render inlineRun(n.children)}</strong
      >{:else if n.type === "em"}<em>{@render inlineRun(n.children)}</em>{:else if n.type === "del"}<del
        >{@render inlineRun(n.children)}</del
      >{:else if n.type === "link"}<a
        href={n.href}
        title={n.title ?? undefined}
        onclick={(e) => onLinkClick(e, n.href)}>{@render inlineRun(n.children)}</a
      >{:else if n.type === "image"}<img class="md-img" src={imgSrc(n.src)} alt={n.alt} title={n.title ?? undefined} />{/if}
  {/each}
{/snippet}

{#snippet blockList(list: MdBlock[])}
  {#each list as b}
    {#if b.type === "heading"}
      <svelte:element this={`h${b.level}`} class={`md-h md-h${b.level} font-title`}>
        {@render inlineRun(b.children)}
      </svelte:element>
    {:else if b.type === "paragraph"}
      <p class="md-p">{@render inlineRun(b.children)}</p>
    {:else if b.type === "blockquote"}
      <blockquote class="md-quote">{@render blockList(b.children)}</blockquote>
    {:else if b.type === "list"}
      {#if b.ordered}
        <ol class="md-list" start={b.start}>
          {#each b.items as it}
            <li class="md-li">{@render blockList(it.children)}</li>
          {/each}
        </ol>
      {:else}
        <ul class={cn("md-list", b.items.some((i) => i.checked !== null) && "md-tasks")}>
          {#each b.items as it}
            <li class={cn("md-li", it.checked !== null && "md-task")}>
              {#if it.checked !== null}
                <input type="checkbox" checked={it.checked} disabled class="md-check" />
              {/if}
              {@render blockList(it.children)}
            </li>
          {/each}
        </ul>
      {/if}
    {:else if b.type === "codeBlock"}
      <pre class="md-pre uxnan-scroll"><code>{b.value}</code></pre>
    {:else if b.type === "table"}
      <div class="md-table-wrap uxnan-scroll">
        <table class="md-table">
          <thead>
            <tr>
              {#each b.header as cell, i}
                <th style:text-align={b.align[i] ?? "left"}>{@render inlineRun(cell)}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each b.rows as row}
              <tr>
                {#each row as cell, i}
                  <td style:text-align={b.align[i] ?? "left"}>{@render inlineRun(cell)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if b.type === "rule"}
      <hr class="md-hr" />
    {:else if b.type === "html"}
      <pre class="md-html uxnan-scroll"><code>{b.value}</code></pre>
    {/if}
  {/each}
{/snippet}

{#if blocks.length === 0}
  <p class={cn("p-4", text.meta)}>{i18n.t("preview.markdownEmpty")}</p>
{:else}
  <div class="md uxnan-scroll">
    {@render blockList(blocks)}
  </div>
{/if}

<style>
  /* Clean docs prose, tuned to the app's density + tokens (no typography plugin).
     Colors come from the semantic CSS variables so it follows light/dark. */
  .md {
    height: 100%;
    overflow: auto;
    padding: 1.25rem 1.5rem 3rem;
    max-width: 52rem;
    margin: 0 auto;
    font-size: 13px;
    line-height: 1.65;
    color: var(--foreground);
  }
  .md :global(.md-h) {
    font-weight: 600;
    line-height: 1.3;
    margin: 1.6em 0 0.6em;
    letter-spacing: -0.01em;
  }
  .md :global(.md-h:first-child) {
    margin-top: 0;
  }
  .md :global(.md-h1) {
    font-size: 1.7em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 80%, transparent);
  }
  .md :global(.md-h2) {
    font-size: 1.35em;
    padding-bottom: 0.25em;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 65%, transparent);
  }
  .md :global(.md-h3) {
    font-size: 1.15em;
  }
  .md :global(.md-h4) {
    font-size: 1em;
  }
  .md :global(.md-h5),
  .md :global(.md-h6) {
    font-size: 0.9em;
    color: var(--muted-foreground);
  }
  .md :global(.md-p) {
    margin: 0.75em 0;
  }
  .md :global(a) {
    color: var(--primary);
    text-decoration: none;
    cursor: pointer;
  }
  .md :global(a:hover) {
    text-decoration: underline;
  }
  .md :global(.md-code) {
    font-family: var(--ux-font-mono);
    font-size: 0.88em;
    padding: 0.12em 0.35em;
    border-radius: 4px;
    background: color-mix(in oklab, var(--foreground) 7%, transparent);
  }
  .md :global(.md-pre) {
    margin: 0.9em 0;
    padding: 0.8em 0.95em;
    border-radius: 8px;
    border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
    background: var(--ux-panel-muted);
    overflow-x: auto;
  }
  .md :global(.md-pre code),
  .md :global(.md-html code) {
    font-family: var(--ux-font-mono);
    font-size: 0.85em;
    line-height: 1.55;
    white-space: pre;
  }
  .md :global(.md-html) {
    margin: 0.9em 0;
    padding: 0.6em 0.8em;
    border-radius: 8px;
    border: 1px dashed color-mix(in oklab, var(--border) 80%, transparent);
    background: color-mix(in oklab, var(--muted-foreground) 6%, transparent);
    color: var(--muted-foreground);
  }
  .md :global(.md-quote) {
    margin: 0.9em 0;
    padding: 0.1em 1em;
    border-left: 3px solid color-mix(in oklab, var(--primary) 45%, var(--border));
    color: var(--muted-foreground);
  }
  .md :global(.md-list) {
    margin: 0.6em 0;
    padding-left: 1.5em;
  }
  .md :global(ul.md-list) {
    list-style: disc;
  }
  .md :global(ol.md-list) {
    list-style: decimal;
  }
  .md :global(ul.md-tasks) {
    list-style: none;
    padding-left: 0.4em;
  }
  .md :global(.md-li) {
    margin: 0.25em 0;
  }
  .md :global(.md-li > .md-p) {
    margin: 0.2em 0;
  }
  .md :global(.md-task) {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
  }
  .md :global(.md-check) {
    transform: translateY(1px);
    accent-color: var(--primary);
  }
  .md :global(.md-hr) {
    margin: 1.6em 0;
    border: none;
    border-top: 1px solid color-mix(in oklab, var(--border) 80%, transparent);
  }
  .md :global(.md-img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
  }
  .md :global(.md-table-wrap) {
    margin: 1em 0;
    overflow-x: auto;
  }
  .md :global(.md-table) {
    border-collapse: collapse;
    font-size: 0.95em;
  }
  .md :global(.md-table th),
  .md :global(.md-table td) {
    border: 1px solid color-mix(in oklab, var(--border) 75%, transparent);
    padding: 0.4em 0.7em;
  }
  .md :global(.md-table th) {
    font-weight: 600;
    background: var(--ux-panel-muted);
  }
</style>
