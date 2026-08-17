<script lang="ts">
  // Status-bar ports indicator: the ports on the machines you are connected to,
  // and which of them are reachable from here.
  //
  // Same shape as the usage and backend indicators — icon trigger, top-aligned
  // popover — because they are the same kind of thing: a small live fact about
  // the session that should never take room from the work.
  //
  // Nothing is forwarded on its own. A tunnel opens a socket on *this* machine,
  // so it waits for the click; what arrives by itself is only the knowledge that
  // a port exists (a terminal printed its address).
  import * as Popover from "$lib/components/ui/popover";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { openUrl } from "$lib/api";
  import { clipboardWrite } from "$lib/clipboard";
  import { ports, type PortRow } from "$lib/state/ports.svelte";
  import { sessions } from "$lib/state/sessions.svelte";
  import { cn } from "$lib/utils";
  import { icon as iconSize, overlay, shell, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { Icon } from "$lib/components/ui/icon";
  import ConnectIcon from "@hugeicons/core-free-icons/ConnectIcon";
  import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon";
  import CopyIcon from "@hugeicons/core-free-icons/Copy01Icon";
  import CancelIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import {
    shouldPreventStatusPopoverAutoFocus,
    type StatusPopoverCloseReason,
  } from "./status-popover-focus";

  // Only hosts with a live session: a port on a machine we are not connected to
  // is not something this can act on.
  const hosts = $derived(sessions.connected);
  const enabled = $derived(hosts.length > 0);
  const forwarded = $derived(ports.forwards.length);

  let open = $state(false);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let contentRef = $state<HTMLElement | null>(null);
  let statusTooltipOpen = $state(false);
  let closeReason = $state<StatusPopoverCloseReason>("programmatic");
  let copied = $state<string | null>(null);

  function onOpenChange(next: boolean): void {
    if (next) {
      closeReason = "programmatic";
      statusTooltipOpen = false;
      // Only the in-process list, never the hosts: asking a machine what it is
      // listening on costs a shell start there, so that stays on the button.
      void ports.refreshForwards();
    }
  }

  function onInteractOutside(event?: PointerEvent): void {
    closeReason = "outside";
    open = false;
    const target = event?.target;
    if (target instanceof HTMLElement) queueMicrotask(() => target.focus());
  }

  // Bits UI owns the normal dismissible layer; this keeps the handoff
  // deterministic when the pointer lands on a native surface outside the DOM
  // (the terminal, the browser window) — same fallback the usage popover has.
  function onWindowPointerDown(event: PointerEvent): void {
    if (!open || !contentRef || !triggerRef) return;
    const target = event.target;
    if (target instanceof Node && !contentRef.contains(target) && !triggerRef.contains(target)) {
      onInteractOutside(event);
    }
  }

  /** Ask every connected host what it is listening on. */
  async function scanAll(): Promise<void> {
    for (const hostId of hosts) await ports.scan(hostId);
  }

  /** Forward, check the far end answers, and only then open the preview.
   *
   *  The check is not ceremony: a tunnel opens fine with nothing behind it, and
   *  the browser is the worst possible place to discover that — its error page
   *  cannot say whether the host refuses forwarding, or the service is simply
   *  somewhere else on that machine. Every click re-checks, because the usual
   *  second click is someone retrying after starting the server. */
  async function openRow(row: PortRow): Promise<void> {
    const info = await ports.forward(row.hostId, row.port, row.address);
    if (!info) return;
    if (!info.reachable) return;
    const path = row.path.startsWith("/") ? row.path : `/${row.path}`;
    await openUrl(`http://127.0.0.1:${info.localPort}${path}`);
  }

  /** What went wrong, in the user's language, with what SSH said as the tooltip. */
  function refusalText(row: PortRow): string | null {
    const refusal = row.forward?.refusal;
    if (!refusal) return null;
    if (refusal.kind === "forwardingDisabled") return i18n.t("ports.forwardingDisabled");
    if (refusal.kind === "nothingListening") {
      return row.address
        ? i18n.t("ports.nothingListeningAt", { address: row.address })
        : i18n.t("ports.nothingListening");
    }
    return refusal.detail;
  }

  async function copyRow(row: PortRow): Promise<void> {
    const url = ports.localUrl(row);
    if (!url) return;
    await clipboardWrite(url);
    copied = row.forward?.id ?? null;
    setTimeout(() => (copied = null), 1200);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#if enabled}
  <Popover.Root bind:open {onOpenChange}>
    <TooltipSimple bind:open={statusTooltipOpen} title={i18n.t("ports.statusBarTooltip")}>
      {#snippet children(tp)}
        <Popover.Trigger
          bind:ref={triggerRef}
          {...tp}
          class={cn(
            shell.statusBarAction,
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          aria-label={i18n.t("ports.statusBarTooltip")}
        >
          <Icon
            icon={ConnectIcon}
            class={cn(iconSize.action, forwarded > 0 && "text-foreground")}
          />
        </Popover.Trigger>
      {/snippet}
    </TooltipSimple>

    <Popover.Content
      bind:ref={contentRef}
      align="end"
      side="top"
      width="status"
      padding="none"
      onInteractOutside={onInteractOutside}
      onEscapeKeydown={() => (closeReason = "escape")}
      onCloseAutoFocus={(event) => {
        statusTooltipOpen = false;
        if (shouldPreventStatusPopoverAutoFocus(closeReason)) {
          event.preventDefault();
        } else {
          queueMicrotask(() => triggerRef?.focus());
        }
      }}
    >
      <div class="flex items-start justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div class="min-w-0 space-y-0.5">
          <div class="text-sm font-medium leading-tight text-foreground">
            {i18n.t("ports.title")}
          </div>
          <div class={text.meta}>{i18n.t("ports.caption")}</div>
        </div>
        <TooltipSimple title={i18n.t("ports.refreshTooltip")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon-sm"
              disabled={ports.loading}
              aria-label={i18n.t("ports.refreshTooltip")}
              onclick={() => void scanAll()}
            >
              <Icon icon={RefreshCwIcon} class={cn("size-3.5", ports.loading && "animate-spin")} />
            </Button>
          {/snippet}
        </TooltipSimple>
      </div>

      <div class="scrollbar-sleek flex max-h-80 flex-col overflow-y-auto">
        {#each hosts as hostId (hostId)}
          {@const rows = ports.rowsFor(hostId)}
          {#if rows.length > 0}
            {#if hosts.length > 1}
              <div class={cn("px-3 pt-2", text.section)}>{sessions.labelOf(hostId)}</div>
            {/if}
            <div class="flex flex-col divide-y divide-border/50 px-3">
              {#each rows as row (row.port)}
                <div class="flex items-center gap-2 py-2">
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="flex items-baseline gap-1.5">
                      <span class={cn("font-mono tabular-nums text-foreground", text.body)}>
                        {row.port}
                      </span>
                      <span class={text.meta}>
                        {row.source === "announced"
                          ? i18n.t("ports.announced")
                          : i18n.t("ports.found")}
                      </span>
                    </span>
                    {#if refusalText(row)}
                      <!-- The tunnel is open and the far end is not answering.
                           Said here, where the click was, rather than left to a
                           browser error page that cannot know why. -->
                      <TooltipSimple title={row.forward?.refusal?.detail ?? ""}>
                        {#snippet children(tp)}
                          <span {...tp} class={cn("truncate", text.indicator, "text-destructive")}>
                            {refusalText(row)}
                          </span>
                        {/snippet}
                      </TooltipSimple>
                    {:else if row.forward}
                      <span class={cn("truncate font-mono", text.indicator, "text-muted-foreground")}>
                        127.0.0.1:{row.forward.localPort}
                      </span>
                    {:else if row.loopback === false}
                      <span class={text.indicator}>{i18n.t("ports.reachableThere")}</span>
                    {/if}
                  </span>

                  <span class="flex shrink-0 items-center gap-0.5">
                    {#if row.forward}
                      <TooltipSimple
                        title={copied === row.forward.id
                          ? i18n.t("ports.copied")
                          : i18n.t("ports.copy")}
                      >
                        {#snippet children(tp)}
                          <Button
                            {...tp}
                            variant="ghost"
                            size="icon-sm"
                            aria-label={i18n.t("ports.copy")}
                            onclick={() => void copyRow(row)}
                          >
                            <Icon icon={CopyIcon} class="size-3.5" />
                          </Button>
                        {/snippet}
                      </TooltipSimple>
                      <TooltipSimple title={i18n.t("ports.stop")}>
                        {#snippet children(tp)}
                          <Button
                            {...tp}
                            variant="ghost"
                            size="icon-sm"
                            aria-label={i18n.t("ports.stop")}
                            onclick={() => void ports.close(row.forward!.id)}
                          >
                            <Icon icon={CancelIcon} class="size-3.5" />
                          </Button>
                        {/snippet}
                      </TooltipSimple>
                    {/if}
                    <TooltipSimple
                      title={row.forward ? i18n.t("ports.openTooltip") : i18n.t("ports.forwardTooltip")}
                    >
                      {#snippet children(tp)}
                        <Button
                          {...tp}
                          variant="ghost"
                          size="sm"
                          class="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
                          disabled={ports.loading}
                          onclick={() => void openRow(row)}
                        >
                          <Icon icon={ExternalLinkIcon} class="size-3.5" />
                          {i18n.t("ports.open")}
                        </Button>
                      {/snippet}
                    </TooltipSimple>
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        {/each}

        {#if hosts.every((hostId) => ports.rowsFor(hostId).length === 0)}
          <p class={cn("px-3 py-3", text.meta)}>{i18n.t("ports.empty")}</p>
        {/if}
      </div>

      {#if ports.error}
        <p class={cn("border-t border-border/60 px-3 py-2 text-destructive", text.meta)}>
          {ports.error}
        </p>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}
