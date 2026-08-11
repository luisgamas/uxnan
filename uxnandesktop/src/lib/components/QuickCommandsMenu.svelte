<script lang="ts">
  // Top-bar quick-commands launcher (the lightning control, left of the window
  // controls). One stable DropdownMenu trigger: empty → a "create your first
  // command" item that jumps to settings; otherwise a two-section list — the
  // active worktree/project's commands, then the global ones — plus a footer to
  // manage them. Running a command dispatches through `projects.runQuickCommand`
  // (a `confirm` command first opens the shared destructive dialog).
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { focus, icon, shell, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { contextualQuickCommands, globalQuickCommands } from "$lib/quickCommands";
  import type { QuickCommand } from "$lib/types";
  import EntityIcon from "./EntityIcon.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import EnergyIcon from "@hugeicons/core-free-icons/EnergyIcon";
  import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
  import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";

  const ctx = $derived(projects.commandContext());
  const contextual = $derived(contextualQuickCommands(app.quickCommands, ctx));
  const globals = $derived(globalQuickCommands(app.quickCommands));
  const isEmpty = $derived(app.quickCommands.length === 0);

  // A `confirm` command stages here and runs only once the dialog is accepted.
  // `confirmOpen` drives the (bound) dialog; clearing it (accept / cancel /
  // Escape / backdrop) drops the staged command.
  let pending = $state<QuickCommand | null>(null);
  let confirmOpen = $state(false);
  $effect(() => {
    if (!confirmOpen) pending = null;
  });

  function activate(cmd: QuickCommand): void {
    if (cmd.confirm) {
      pending = cmd;
      confirmOpen = true;
      return;
    }
    void projects.runQuickCommand(cmd);
  }

  function manage(): void {
    app.openSettings("commands");
  }
</script>

<DropdownMenu.Root bind:open={app.quickCommandsMenuOpen}>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        class={`${shell.titlebarLauncher} ${focus.ring} text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground`}
        aria-label={i18n.t("commands.menuTitle")}
        title={i18n.t("commands.menuTitle")}
      >
        <Icon icon={EnergyIcon} class={icon.button} />
      </button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content width="wide" align="end">
    {#if isEmpty}
      <div class={cn("px-2 py-1.5", text.meta)}>{i18n.t("commands.empty")}</div>
      <DropdownMenu.Separator />
      <DropdownMenu.Item class={text.menu} onclick={manage}>
        <Icon icon={PlusIcon} class={icon.button} />
        {i18n.t("commands.createFirst")}
      </DropdownMenu.Item>
    {:else}
      {#if contextual.length}
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={text.menuLabel}>
            {i18n.t("commands.contextSection")}
          </DropdownMenu.GroupHeading>
          {#each contextual as cmd (cmd.id)}
            <DropdownMenu.Item class={text.menu} onclick={() => activate(cmd)}>
              <EntityIcon value={cmd.icon} class={icon.button}>
                {#snippet fallback()}<Icon icon={EnergyIcon} class={icon.button} />{/snippet}
              </EntityIcon>
              <span class="truncate">{cmd.name.trim() || cmd.command}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Group>
      {/if}

      {#if globals.length}
        {#if contextual.length}<DropdownMenu.Separator />{/if}
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={text.menuLabel}>
            {i18n.t("commands.globalSection")}
          </DropdownMenu.GroupHeading>
          {#each globals as cmd (cmd.id)}
            <DropdownMenu.Item class={text.menu} onclick={() => activate(cmd)}>
              <EntityIcon value={cmd.icon} class={icon.button}>
                {#snippet fallback()}<Icon icon={EnergyIcon} class={icon.button} />{/snippet}
              </EntityIcon>
              <span class="truncate">{cmd.name.trim() || cmd.command}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Group>
      {/if}

      {#if !contextual.length && !globals.length}
        <div class={cn("px-2 py-1.5", text.meta)}>{i18n.t("commands.noneHere")}</div>
      {/if}

      <DropdownMenu.Separator />
      <DropdownMenu.Item class={text.menu} onclick={manage}>
        <Icon icon={SettingsIcon} class={icon.button} />
        {i18n.t("commands.manage")}
      </DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>

<ConfirmDialog
  bind:open={confirmOpen}
  title={i18n.t("commands.confirmTitle", { name: pending?.name ?? "" })}
  description={pending?.command ?? ""}
  confirmLabel={i18n.t("commands.run")}
  onconfirm={() => {
    if (pending) void projects.runQuickCommand(pending);
  }}
/>
