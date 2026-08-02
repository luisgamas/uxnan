<script lang="ts">
  // Rendered Markdown preview for the file viewer's Preview mode. The source is
  // parsed into a typed AST by `$lib/markdown` (in-house, on the already-installed
  // Lezer parser) and rendered here with **plain Svelte markup — never `{@html}`**,
  // so a document from an untrusted repo can't script the webview. External links
  // open through the app opener; local and remote images are resolved to bounded
  // data URLs via the backend (the asset protocol isn't scoped to arbitrary paths,
  // and packaged CSP deliberately does not allow arbitrary remote images).
  import {
    parseSafeHtml,
    renderMarkdown,
    type MdBlock,
    type MdHtmlNode,
    type MdInline,
  } from "$lib/markdown";
  import { highlightMarkdownCode } from "$lib/markdownHighlight";
  import { resolvePreviewAssetPath } from "$lib/filePreview";
  import { fsReadDataUrl, imageFetchDataUrl, openExternal } from "$lib/api";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import InfoIcon from "@lucide/svelte/icons/info";
  import LightbulbIcon from "@lucide/svelte/icons/lightbulb";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square-warning";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import OctagonAlertIcon from "@lucide/svelte/icons/octagon-alert";

  // `inline` renders the document as a compact fragment (no full-height scroller,
  // no centered max-width, tighter rhythm) for embedding inside a card — e.g. a
  // GitHub PR/issue comment. The default (document) mode is unchanged.
  let {
    source,
    baseDir = null,
    inline = false,
    onopenfile,
  }: {
    source: string;
    baseDir?: string | null;
    inline?: boolean;
    onopenfile?: (path: string) => void;
  } = $props();

  const blocks = $derived(renderMarkdown(source));
  let scrollHost = $state<HTMLElement | null>(null);

  // --- image resolution ------------------------------------------------------
  // data: srcs render directly. Remote and local paths are read into bounded data
  // URLs once (cached by original src) so packaged CSP can stay restrictive.
  let resolved = $state<Record<string, string>>({});

  function isRemote(src: string): boolean {
    return /^https?:/i.test(src);
  }
  function isInline(src: string): boolean {
    return /^data:/i.test(src);
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

  function htmlDimension(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value.endsWith("%") ? value : `${value}px`;
  }

  function collectImages(list: MdBlock[], out: Set<string>): void {
    for (const b of list) {
      if (b.type === "table") [...b.header, ...b.rows.flat()].forEach((c) => collectInlineImages(c, out));
      else if (b.type === "heading" || b.type === "paragraph") collectInlineImages(b.children, out);
      else if (b.type === "blockquote" || b.type === "alert" || b.type === "details")
        collectImages(b.children, out);
      else if (b.type === "list") b.items.forEach((it) => collectImages(it.children, out));
      else if (b.type === "html") collectHtmlImages(parseSafeHtml(b.value), out);
    }
  }
  function collectInlineImages(nodes: MdInline[], out: Set<string>): void {
    for (const n of nodes) {
      if (n.type === "image" && n.src && !isInline(n.src)) out.add(n.src);
      else if (n.type === "strong" || n.type === "em" || n.type === "del" || n.type === "link")
        collectInlineImages(n.children, out);
    }
  }
  function collectHtmlImages(nodes: MdHtmlNode[], out: Set<string>): void {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.tag === "img" && node.attrs.src && !isInline(node.attrs.src)) {
        out.add(node.attrs.src);
      }
      collectHtmlImages(node.children, out);
    }
  }

  // Resolve any new local images whenever the parsed document changes.
  $effect(() => {
    const wanted = new Set<string>();
    collectImages(blocks, wanted);
    for (const src of wanted) {
      if (src in resolved) continue;
      if (!isRemote(src) && !baseDir) continue;
      resolved[src] = ""; // mark in-flight so we don't re-request
      const request = isRemote(src)
        ? imageFetchDataUrl(src, "preview")
        : fsReadDataUrl(resolvePreviewAssetPath(baseDir!, src));
      void request
        .then((url) => (resolved[src] = url))
        .catch(() => {
          // Keep the empty marker: deleting it would make this reactive effect
          // retry a broken URL forever. A remount/source change offers a retry.
          resolved[src] = "";
        });
    }
  });

  /** The <img> src to use for an AST image: remote as-is, local resolved (or empty
   *  while loading / on failure). */
  function imgSrc(src: string): string {
    if (isInline(src)) return src;
    // HTTP(S) works directly in an ordinary browser preview. The packaged app's
    // CSP blocks it, then the backend-fetched data URL replaces it.
    if (isRemote(src)) return resolved[src] || src;
    return resolved[src] || "";
  }

  function onLinkClick(e: MouseEvent, href: string): void {
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) {
      void openExternal(href);
      return;
    }
    const hashAt = href.indexOf("#");
    const filePart = hashAt >= 0 ? href.slice(0, hashAt) : href;
    const fragment = hashAt >= 0 ? href.slice(hashAt + 1) : "";
    if (!filePart && fragment) {
      const id = safeDecode(fragment);
      requestAnimationFrame(() => {
        const target = scrollHost?.querySelector<HTMLElement>(`#${cssEscape(id)}`);
        target?.scrollIntoView({ block: "start" });
      });
      return;
    }
    if (baseDir && filePart && onopenfile) {
      onopenfile(joinPath(baseDir, safeDecode(filePart)));
    }
  }

  function safeDecode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
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
      >{:else if n.type === "image"}<img
        class="md-img"
        src={imgSrc(n.src)}
        alt={n.alt}
        title={n.title ?? undefined}
        width={n.width ?? undefined}
        height={n.height ?? undefined}
        style:width={htmlDimension(n.width)}
        style:height={htmlDimension(n.height)}
      />{/if}
  {/each}
{/snippet}

{#snippet htmlRun(nodes: MdHtmlNode[])}
  {#each nodes as n}
    {#if n.type === "text"}
      {n.value}
    {:else if n.tag === "img"}
      {@const src = n.attrs.src ? imgSrc(n.attrs.src) : ""}
      {#if src}
        <img
          class="md-html-img"
          {src}
          alt={n.attrs.alt ?? ""}
          title={n.attrs.title ?? undefined}
          width={n.attrs.width ?? undefined}
          height={n.attrs.height ?? undefined}
          style:width={htmlDimension(n.attrs.width)}
          style:height={htmlDimension(n.attrs.height)}
        />
      {:else if n.attrs.alt}
        <span class="text-muted-foreground">{n.attrs.alt}</span>
      {/if}
    {:else if n.tag === "a"}
      <a
        href={n.attrs.href ?? "#"}
        title={n.attrs.title ?? undefined}
        onclick={(e) => onLinkClick(e, n.attrs.href ?? "")}
      >{@render htmlRun(n.children)}</a>
    {:else if n.tag === "br"}
      <br />
    {:else if n.tag === "hr"}
      <hr class="md-hr" />
    {:else}
      <svelte:element
        this={n.tag}
        class={`md-html-${n.tag}`}
        style:text-align={n.attrs.align}
      >{@render htmlRun(n.children)}</svelte:element>
    {/if}
  {/each}
{/snippet}

{#snippet blockList(list: MdBlock[])}
  {#each list as b}
    {#if b.type === "heading"}
      <svelte:element this={`h${b.level}`} id={b.id} class={`md-h md-h${b.level} font-title`}>
        {@render inlineRun(b.children)}
      </svelte:element>
    {:else if b.type === "paragraph"}
      <p class="md-p">{@render inlineRun(b.children)}</p>
    {:else if b.type === "blockquote"}
      <blockquote class="md-quote">{@render blockList(b.children)}</blockquote>
    {:else if b.type === "alert"}
      <!-- GitHub alert callout (`> [!WARNING]` …): a colored rail + labeled head. -->
      <div class={cn("md-alert", `md-alert-${b.kind}`)}>
        <p class="md-alert-title">
          {#if b.kind === "note"}<InfoIcon class="size-4 shrink-0" />
          {:else if b.kind === "tip"}<LightbulbIcon class="size-4 shrink-0" />
          {:else if b.kind === "important"}<MessageSquareIcon class="size-4 shrink-0" />
          {:else if b.kind === "warning"}<TriangleAlertIcon class="size-4 shrink-0" />
          {:else}<OctagonAlertIcon class="size-4 shrink-0" />{/if}
          {i18n.t(`markdown.alert.${b.kind}`)}
        </p>
        {@render blockList(b.children)}
      </div>
    {:else if b.type === "details"}
      <details class="md-details">
        <summary class="md-summary">{b.summary || i18n.t("markdown.detailsFallback")}</summary>
        <div class="md-details-body">{@render blockList(b.children)}</div>
      </details>
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
      <pre class="md-pre uxnan-scroll"><code>{#each highlightMarkdownCode(b.value, b.lang) as run}<span class={run.classes || undefined}>{run.text}</span>{/each}</code></pre>
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
      <div class="md-html-fragment">{@render htmlRun(parseSafeHtml(b.value))}</div>
    {/if}
  {/each}
{/snippet}

{#if blocks.length === 0}
  {#if !inline}<p class={cn("p-4", text.meta)}>{i18n.t("preview.markdownEmpty")}</p>{/if}
{:else}
  {#if inline}
    <div class="md md-inline">{@render blockList(blocks)}</div>
  {:else}
    <div bind:this={scrollHost} class="md-scroll">
      <article class="md">{@render blockList(blocks)}</article>
    </div>
  {/if}
{/if}

<style>
  /* Clean docs prose, tuned to the app's density + tokens (no typography plugin).
     Colors come from the semantic CSS variables so it follows light/dark. */
  .md-scroll {
    height: 100%;
    overflow: auto;
  }
  .md {
    min-height: 100%;
    box-sizing: border-box;
    padding: 1.25rem 1.5rem 3rem;
    max-width: 52rem;
    margin: 0 auto;
    font-size: 13px;
    line-height: 1.65;
    color: var(--foreground);
    /* The app shell sets `user-select: none`; re-enable it here so the rendered
       document can be selected and copied (with its formatting) like a real doc. */
    -webkit-user-select: text;
    user-select: text;
    cursor: auto;
  }
  /* Inline (embedded-in-a-card) variant: a plain fragment that flows with its
     container — no full-height scroller, no centered max-width, no outer padding,
     and a tighter rhythm with headings scaled down for a comment context. */
  .md.md-inline {
    height: auto;
    overflow: visible;
    padding: 0;
    max-width: none;
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
  }
  .md.md-inline > :global(:first-child) {
    margin-top: 0;
  }
  .md.md-inline > :global(:last-child) {
    margin-bottom: 0;
  }
  .md.md-inline :global(.md-h) {
    margin: 0.9em 0 0.4em;
  }
  .md.md-inline :global(.md-h1) {
    font-size: 1.3em;
  }
  .md.md-inline :global(.md-h2) {
    font-size: 1.2em;
  }
  .md.md-inline :global(.md-h3) {
    font-size: 1.1em;
  }
  .md.md-inline :global(.md-h4),
  .md.md-inline :global(.md-h5),
  .md.md-inline :global(.md-h6) {
    font-size: 1em;
  }
  .md.md-inline :global(.md-p) {
    margin: 0.5em 0;
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
  .md :global(.md-pre code) {
    font-family: var(--ux-font-mono);
    font-size: 0.85em;
    line-height: 1.55;
    white-space: pre;
  }
  .md :global(.md-html-fragment) {
    margin: 0.9em 0;
  }
  .md :global(.md-html-fragment > :first-child) {
    margin-top: 0;
  }
  .md :global(.md-html-fragment > :last-child) {
    margin-bottom: 0;
  }
  .md :global(.md-html-p),
  .md :global(.md-html-div) {
    margin: 0.75em 0;
  }
  .md :global(.md-html-h1),
  .md :global(.md-html-h2),
  .md :global(.md-html-h3),
  .md :global(.md-html-h4),
  .md :global(.md-html-h5),
  .md :global(.md-html-h6) {
    margin: 1.4em 0 0.55em;
    font-weight: 600;
    line-height: 1.3;
  }
  .md :global(.md-html-h1) {
    font-size: 1.7em;
  }
  .md :global(.md-html-h2) {
    font-size: 1.35em;
  }
  .md :global(.md-html-h3) {
    font-size: 1.15em;
  }
  .md :global(.md-html-kbd) {
    display: inline-flex;
    min-width: 1.6em;
    justify-content: center;
    border: 1px solid color-mix(in oklab, var(--border) 75%, transparent);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0.05em 0.35em;
    background: var(--ux-panel-muted);
    font-family: var(--ux-font-mono);
    font-size: 0.82em;
  }
  .md :global(.md-html-img) {
    display: inline-block;
    width: auto;
    max-width: 100%;
    height: auto;
    margin: 0.18em;
    vertical-align: middle;
  }

  /* GitHub alerts (`> [!WARNING]`): a colored rail + a labeled, iconed head. */
  .md :global(.md-alert) {
    margin: 0.9em 0;
    padding: 0.6em 1em;
    border-left: 3px solid var(--md-alert-color);
    border-radius: 0 6px 6px 0;
    background: color-mix(in oklab, var(--md-alert-color) 7%, transparent);
  }
  .md :global(.md-alert-title) {
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin: 0 0 0.35em;
    font-weight: 600;
    color: var(--md-alert-color);
  }
  .md :global(.md-alert > .md-p:last-child) {
    margin-bottom: 0;
  }
  .md :global(.md-alert-note) {
    --md-alert-color: var(--primary);
  }
  .md :global(.md-alert-tip) {
    --md-alert-color: oklch(0.72 0.15 155);
  }
  .md :global(.md-alert-important) {
    --md-alert-color: oklch(0.65 0.18 300);
  }
  .md :global(.md-alert-warning) {
    --md-alert-color: oklch(0.72 0.16 75);
  }
  .md :global(.md-alert-caution) {
    --md-alert-color: oklch(0.65 0.21 25);
  }

  /* <details>/<summary> disclosure, collapsed by default like on GitHub. */
  .md :global(.md-details) {
    margin: 0.9em 0;
    padding: 0.5em 0.8em;
    border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
    border-radius: 8px;
    background: color-mix(in oklab, var(--foreground) 3%, transparent);
  }
  .md :global(.md-summary) {
    cursor: pointer;
    font-weight: 500;
    list-style-position: outside;
  }
  .md :global(.md-summary:hover) {
    color: var(--primary);
  }
  .md :global(.md-details[open] > .md-summary) {
    margin-bottom: 0.5em;
  }
  .md :global(.md-details-body > :first-child) {
    margin-top: 0;
  }
  .md :global(.md-details-body > :last-child) {
    margin-bottom: 0;
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
    display: inline-block;
    width: auto;
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

  /* Fenced-code highlighting uses Lezer's stable classHighlighter vocabulary. */
  .md :global(.tok-keyword) {
    color: rgb(168 85 247);
  }
  .md :global(.tok-comment) {
    color: rgb(107 114 128);
    font-style: italic;
  }
  .md :global(.tok-string),
  .md :global(.tok-string2) {
    color: rgb(22 163 74);
  }
  .md :global(.tok-number),
  .md :global(.tok-bool),
  .md :global(.tok-atom) {
    color: rgb(202 138 4);
  }
  .md :global(.tok-typeName),
  .md :global(.tok-className),
  .md :global(.tok-namespace) {
    color: rgb(13 148 136);
  }
  .md :global(.tok-propertyName),
  .md :global(.tok-labelName) {
    color: rgb(8 145 178);
  }
  .md :global(.tok-operator),
  .md :global(.tok-punctuation) {
    color: rgb(100 116 139);
  }
  .md :global(.tok-meta),
  .md :global(.tok-macroName) {
    color: rgb(217 119 6);
  }
  .md :global(.tok-invalid) {
    color: rgb(220 38 38);
  }
  :global(.dark .md .tok-keyword) {
    color: rgb(196 154 255);
  }
  :global(.dark .md .tok-comment) {
    color: rgb(148 163 184);
  }
  :global(.dark .md .tok-string),
  :global(.dark .md .tok-string2) {
    color: rgb(134 239 172);
  }
  :global(.dark .md .tok-number),
  :global(.dark .md .tok-bool),
  :global(.dark .md .tok-atom) {
    color: rgb(250 204 21);
  }
  :global(.dark .md .tok-typeName),
  :global(.dark .md .tok-className),
  :global(.dark .md .tok-namespace) {
    color: rgb(94 234 212);
  }
  :global(.dark .md .tok-propertyName),
  :global(.dark .md .tok-labelName) {
    color: rgb(103 232 249);
  }
  :global(.dark .md .tok-operator),
  :global(.dark .md .tok-punctuation) {
    color: rgb(148 163 184);
  }
  :global(.dark .md .tok-meta),
  :global(.dark .md .tok-macroName) {
    color: rgb(251 191 36);
  }
</style>
