<script lang="ts">
  // Pick a folder on a host and register it as a project.
  //
  // The same job as the local directory picker, against a machine with no
  // filesystem we can walk — so every step is a round trip, and the design
  // follows from that: it opens at the host's home, walks one level at a time,
  // and the folder you are *in* is the one you add. No tree, no lazy expansion,
  // no speculative prefetch of siblings nobody asked for.
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Icon } from "$lib/components/ui/icon";
  import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
  import ArrowUpIcon from "@hugeicons/core-free-icons/ArrowUp01Icon";
  import AlertIcon from "@hugeicons/core-free-icons/Alert01Icon";
  import { sshBrowseDirs, sshRepoAdd } from "$lib/api";
  import { app } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, panel, text } from "$lib/design";
  import type { SshRemoteListing } from "$lib/types";

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

  let listing = $state<SshRemoteListing | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let adding = $state(false);

  const msg = (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

  async function go(path: string): Promise<void> {
    loading = true;
    error = null;
    try {
      listing = await sshBrowseDirs(hostId, path);
    } catch (e) {
      error = msg(e);
    } finally {
      loading = false;
    }
  }

  // Start at the host's home each time the dialog opens, rather than wherever
  // the last visit ended: the folder you want is far more often near home than
  // near where you last looked.
  $effect(() => {
    if (open && listing === null && !loading) void go("");
  });

  async function addCurrent(): Promise<void> {
    if (!listing) return;
    adding = true;
    error = null;
    try {
      const repo = await sshRepoAdd(hostId, listing.path);
      if (!app.repos.some((r) => r.id === repo.id)) app.repos.push(repo);
      listing = null;
      onOpenChange?.(false);
      app.settingsOpen = false;
    } catch (e) {
      error = msg(e);
    } finally {
      adding = false;
    }
  }
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => {
    if (!next) {
      listing = null;
      error = null;
    }
    onOpenChange?.(next);
  }}
>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("hosts.pickFolderTitle", { host: hostLabel })}</Dialog.Title>
      <Dialog.Description>{i18n.t("hosts.pickFolderBody")}</Dialog.Description>
    </Dialog.Header>

    <!-- The path is the thing being chosen, so it is the thing shown, in the
         host's own spelling rather than normalized to this machine's. -->
    <p class={cn(text.meta, "truncate font-mono")} title={listing?.path ?? ""}>
      {listing?.path ?? "…"}
    </p>

    {#if error}
      <div class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2" role="alert">
        <Icon icon={AlertIcon} class={cn(icon.action, "mt-0.5 shrink-0 text-destructive")} />
        <p class={cn(text.body, "min-w-0 text-destructive")}>{error}</p>
      </div>
    {/if}

    <ul class={cn(panel.settingsPreview, "divide-y divide-border/50 overflow-y-auto")}>
      {#if listing?.parent}
        <li>
          <button
            type="button"
            class={cn("flex min-h-9 w-full items-center gap-2.5 px-3 text-left", focus.ring)}
            onclick={() => go(listing!.parent!)}
          >
            <Icon icon={ArrowUpIcon} class={cn(icon.action, "shrink-0 text-muted-foreground")} />
            <span class={text.body}>{i18n.t("hosts.pickFolderUp")}</span>
          </button>
        </li>
      {/if}
      {#each listing?.dirs ?? [] as dir (dir.path)}
        <li>
          <button
            type="button"
            class={cn(
              "flex min-h-9 w-full items-center gap-2.5 px-3 text-left hover:bg-accent",
              focus.ring,
            )}
            onclick={() => go(dir.path)}
          >
            <Icon icon={FolderIcon} class={cn(icon.action, "shrink-0 text-muted-foreground")} />
            <span class={cn(text.body, "truncate")}>{dir.name}</span>
          </button>
        </li>
      {/each}
      {#if !loading && listing && listing.dirs.length === 0}
        <li class={cn(text.meta, "px-3 py-2")}>{i18n.t("hosts.pickFolderEmpty")}</li>
      {/if}
      {#if loading}
        <li class={cn(text.meta, "px-3 py-2")}>{i18n.t("hosts.pickFolderLoading")}</li>
      {/if}
    </ul>

    {#if listing?.truncated}
      <!-- Never let a cut listing pass for a whole one: the folder they want may
           be one of the ones not shown. -->
      <p class={cn(text.meta, "text-amber-600 dark:text-amber-500")}>
        {i18n.t("hosts.pickFolderTruncated")}
      </p>
    {/if}

    <Dialog.Footer>
      <Button variant="outline" onclick={() => onOpenChange?.(false)}>{i18n.t("common.cancel")}</Button>
      <Button disabled={!listing || adding} onclick={addCurrent}>
        {i18n.t("hosts.pickFolderAdd")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
