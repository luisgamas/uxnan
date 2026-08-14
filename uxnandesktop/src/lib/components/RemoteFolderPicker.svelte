<script lang="ts">
  // Pick a folder on a host and register it as a project.
  //
  // The same job as the local "Add project" picker, and deliberately the same
  // surface: it wraps `DirectoryBrowser` with a remote lister, so the address
  // bar, the keyboard navigation, the git badges and the per-row Add button are
  // the ones the user already knows — the only difference is which machine
  // answers.
  //
  // What is genuinely different: every step is a round trip, so there is no
  // filesystem watch (the refresh button is the reload) and a long listing can
  // come back cut, which the footer says out loud.
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import AlertIcon from "@hugeicons/core-free-icons/Alert01Icon";
  import { sshBrowseDirs, sshRepoAdd } from "$lib/api";
  import { app } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import { isMac } from "$lib/keybindings";
  import Kbd from "./Kbd.svelte";
  import DirectoryBrowser from "./DirectoryBrowser.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import type { DirEntry, DirListing } from "$lib/types";

  let {
    hostId,
    hostLabel,
    open = false,
    onOpenChange,
  }: {
    hostId: string;
    hostLabel: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  let listing = $state<DirListing | null>(null);
  let path = $state("");
  let error = $state<string | null>(null);
  let busyPath = $state<string | null>(null);
  let truncated = $state(false);
  let browserKey = $state<((e: KeyboardEvent) => void) | undefined>(undefined);

  const msg = (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

  /** The host's listings, in the local browser's shape. An omitted target means
   *  the host's home — only that machine knows where that is. */
  async function listRemote(target?: string): Promise<DirListing> {
    const result = await sshBrowseDirs(hostId, target ?? "");
    truncated = result.truncated;
    return result;
  }

  async function add(target: string): Promise<void> {
    busyPath = target;
    error = null;
    try {
      const repo = await sshRepoAdd(hostId, target);
      if (!app.repos.some((r) => r.id === repo.id)) app.repos.push(repo);
      listing = null;
      onOpenChange?.(false);
      app.settingsOpen = false;
    } catch (e) {
      error = msg(e);
    } finally {
      busyPath = null;
    }
  }
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => {
    if (!next) {
      listing = null;
      error = null;
      truncated = false;
    }
    onOpenChange?.(next);
  }}
>
  <Dialog.Content size="large" composition="sectioned" class="overflow-hidden" onkeydown={browserKey}>
    <div class="flex flex-col gap-1 border-b border-border/60 px-5 pb-4 pt-5 pr-11">
      <Dialog.Title class="text-[15px] font-semibold leading-none">
        {i18n.t("hosts.pickFolderTitle", { host: hostLabel })}
      </Dialog.Title>
      <Dialog.Description class={text.meta}>{i18n.t("hosts.pickFolderBody")}</Dialog.Description>
    </div>

    <DirectoryBrowser
      active={open}
      bind:listing
      bind:path
      bind:keydownHandler={browserKey}
      list={listRemote}
      watchable={false}
      busy={busyPath !== null}
      listClass="h-60"
      onPrimary={() => listing && add(listing.path)}
    >
      {#snippet rowAction(entry: DirEntry)}
        <Button
          variant={entry.isRepo ? "secondary" : "ghost"}
          size="sm"
          class="h-7 shrink-0 px-2.5 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          disabled={busyPath !== null}
          onclick={() => add(entry.path)}
        >
          {#if busyPath === entry.path}<Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />{/if}
          {busyPath === entry.path ? i18n.t("common.adding") : i18n.t("common.add")}
        </Button>
      {/snippet}
    </DirectoryBrowser>

    {#if error}
      <div class="flex items-start gap-2 border-t border-border/60 bg-destructive/10 px-5 py-2" role="alert">
        <Icon icon={AlertIcon} class={cn(icon.button, "mt-0.5 shrink-0 text-destructive")} />
        <p class="min-w-0 text-xs text-destructive">{error}</p>
      </div>
    {/if}

    {#if truncated}
      <!-- Never let a cut listing pass for a whole one: the folder they want may
           be one of the ones not shown. -->
      <p class="border-t border-border/60 bg-amber-500/10 px-5 py-2 text-xs text-amber-600 dark:text-amber-500">
        {i18n.t("hosts.pickFolderTruncated")}
      </p>
    {/if}

    <div class="flex min-w-0 items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-5 py-3">
      <div class="hidden min-w-0 flex-1 items-center gap-4 overflow-hidden text-xs text-muted-foreground sm:flex">
        <span class="flex shrink-0 items-center gap-1.5">
          <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span>{i18n.t("palette.hintNavigate")}
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <span class="flex items-center gap-1"><Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>↵</Kbd></span>{i18n.t("picker.hintAdd")}
        </span>
      </div>
      <Button
        size="sm"
        disabled={!listing || busyPath !== null}
        onclick={() => listing && add(listing.path)}
      >
        {#if listing && busyPath === listing.path}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
        {/if}
        {listing && busyPath === listing.path ? i18n.t("common.adding") : i18n.t("picker.addFolder")}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
