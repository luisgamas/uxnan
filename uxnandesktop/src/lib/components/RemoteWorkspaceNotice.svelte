<script lang="ts">
  // What the right panel shows when the selected project lives on another
  // machine.
  //
  // Files, changes, history and GitHub are all read *here*, with this machine's
  // filesystem and this machine's git. On a host none of that applies — and the
  // failure mode it replaces is worse than an empty panel: a folder of the same
  // name on this PC would answer every one of those questions, confidently and
  // about the wrong repository. So the panel says which machine the project is
  // on and what does work today, per the honesty rule in
  // `architecture/02g-remote-hosts.md` §6.
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import ServerIcon from "@hugeicons/core-free-icons/ServerStack01Icon";
  import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
  import { hosts } from "$lib/state/hosts.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { sshHostId } from "$lib/target";

  // The host's own label, falling back to its id: a notice that names the
  // machine beats one that says "a host". Read from the machine the *path*
  // below is on, so the notice and the path it quotes can never name two
  // different computers.
  const host = $derived.by(() => {
    const id = sshHostId(projects.activeReviewTarget);
    return id ? hosts.labelOf(id) : "";
  });

  const path = $derived(projects.activeWorktreePath ?? "");
</script>

<div class="flex flex-col items-center gap-2 px-6 py-8 text-center">
  <Icon icon={ServerIcon} class="size-6 text-muted-foreground/40" />
  <p class={text.bodyStrong}>{i18n.t("remote.panelTitle", { host })}</p>
  <p class={cn(text.meta, "max-w-[36ch]")}>{i18n.t("remote.panelBody")}</p>
  {#if path}
    <p class={cn(text.meta, "max-w-full truncate font-mono")} title={path}>{path}</p>
  {/if}
  <Button
    variant="outline"
    size="sm"
    class="mt-1"
    onclick={() => projects.activeWorktreePath && projects.openTerminalAt(projects.activeWorktreePath)}
  >
    <Icon icon={TerminalIcon} data-icon="inline-start" />
    {i18n.t("remote.panelOpenTerminal")}
  </Button>
</div>
