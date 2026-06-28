<script lang="ts">
  // Integrated developer-browser pane.
  //
  // Renders the target URL in a plain DOM `<iframe>` — a real center tab that
  // composes naturally with the layout (no native overlay, so it can never freeze
  // the app or paint over menus) and is very light (just another browsing context
  // in the webview the ADE already runs). Ideal for previewing/debugging local dev
  // servers and opening the links agents create.
  //
  // Trade-off: some public sites refuse to be embedded (`X-Frame-Options` /
  // `frame-ancestors`) and will render blank — the toolbar's "open in system
  // browser" handles those. `localhost` dev servers almost never block framing.

  import { untrack } from "svelte";
  import { openExternal } from "$lib/api";
  import type { BrowserTab } from "$lib/state/terminals.svelte";
  import { i18n } from "$lib/i18n";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import RotateCwIcon from "@lucide/svelte/icons/rotate-cw";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";

  let { tab }: { tab: BrowserTab } = $props();

  let address = $state(untrack(() => tab.url));
  let src = $state("");
  /** Bumping this remounts the iframe → a reload (works cross-origin too). */
  let reloadEpoch = $state(0);

  // Our own history of navigated URLs (the iframe's internal cross-origin history
  // isn't readable), powering Back/Forward over the addresses we set. Reactive so
  // the Back/Forward buttons enable/disable as you navigate.
  let stack = $state<string[]>([]);
  let pos = $state(-1);

  /** Turn an address-bar entry into a navigable URL: keep explicit schemes and
   *  `about:`; use http for localhost/loopback (dev servers), else https. */
  function normalizeUrl(input: string): string {
    const s = input.trim();
    if (!s) return "about:blank";
    if (/^about:/i.test(s)) return s;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(s)) return `http://${s}`;
    return `https://${s}`;
  }

  function load(raw: string, pushHistory = true): void {
    const u = normalizeUrl(raw);
    address = u;
    src = u;
    if (pushHistory) {
      stack = [...stack.slice(0, pos + 1), u];
      pos = stack.length - 1;
    }
  }

  // Load the initial URL, and re-load when the tab's target changes from outside
  // (an agent reusing this tab via `showUrl`).
  $effect(() => {
    const u = tab.url;
    untrack(() => {
      if (u && u !== src) load(u);
    });
  });

  function go(): void {
    load(address);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    }
  }

  function back(): void {
    if (pos > 0) {
      pos -= 1;
      load(stack[pos], false);
    }
  }
  function forward(): void {
    if (pos < stack.length - 1) {
      pos += 1;
      load(stack[pos], false);
    }
  }
  function reload(): void {
    reloadEpoch += 1;
  }
</script>

<div class="flex h-full w-full flex-col bg-background">
  <!-- Toolbar / address bar -->
  <div class="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1">
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      title={i18n.t("browser.back")}
      aria-label={i18n.t("browser.back")}
      disabled={pos <= 0}
      onclick={back}
    >
      <ArrowLeftIcon class="size-4" />
    </button>
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      title={i18n.t("browser.forward")}
      aria-label={i18n.t("browser.forward")}
      disabled={pos >= stack.length - 1}
      onclick={forward}
    >
      <ArrowRightIcon class="size-4" />
    </button>
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={i18n.t("browser.reload")}
      aria-label={i18n.t("browser.reload")}
      onclick={reload}
    >
      <RotateCwIcon class="size-4" />
    </button>
    <input
      class="min-w-0 flex-1 rounded border border-input bg-card px-2 py-1 text-xs outline-none focus:border-ring"
      type="text"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      placeholder={i18n.t("browser.addressPlaceholder")}
      bind:value={address}
      onkeydown={onKey}
    />
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={i18n.t("browser.openExternal")}
      aria-label={i18n.t("browser.openExternal")}
      onclick={() => void openExternal(address).catch(() => {})}
    >
      <ExternalLinkIcon class="size-4" />
    </button>
  </div>

  <!-- Page -->
  <div class="relative min-h-0 flex-1">
    {#key reloadEpoch}
      <iframe
        title={i18n.t("settings.browser")}
        {src}
        class="absolute inset-0 h-full w-full border-0 bg-white"
        referrerpolicy="no-referrer-when-downgrade"
        allow="clipboard-read; clipboard-write; fullscreen"
      ></iframe>
    {/key}
  </div>
</div>
