<script lang="ts">
  // The model a chat runs with. The agent of a thread is fixed once it starts
  // (another CLI cannot continue its native session); the model is not — this
  // switches it (`thread/setModel`), and every client sees the change.
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import { chat } from "$lib/bridge/chat.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text, overlay } from "$lib/design";

  let {
    agentId,
    value,
    resolved = null,
    disabled = false,
    onchange,
  }: {
    agentId: string | undefined;
    /** The chosen model id; undefined = the agent's default. */
    value: string | undefined;
    /** The concrete model an alias resolved to on the latest turn. */
    resolved?: string | null;
    disabled?: boolean;
    onchange: (model: string | undefined) => void;
  } = $props();

  let loading = $state(false);
  const models = $derived(chat.cachedModels(agentId));

  $effect(() => {
    if (!agentId) return;
    loading = true;
    void chat.modelsFor(agentId).finally(() => (loading = false));
  });

  const label = $derived.by(() => {
    if (!value) return i18n.t("chat.modelDefault");
    return models.find((m) => m.id === value)?.displayName ?? value;
  });
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger {disabled}>
    {#snippet child({ props })}
      <Button
        variant="ghost"
        size="xs"
        class="max-w-56 gap-1 font-normal text-muted-foreground hover:text-foreground"
        title={resolved ? i18n.t("chat.modelResolved", { model: resolved }) : undefined}
        {...props}
      >
        <span class="truncate">{label}</span>
        <Icon icon={ArrowDown01Icon} class={cn(icon.status, "shrink-0 opacity-70")} />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content width="wide" align="start">
    <div class={overlay.menuViewport}>
      <DropdownMenu.Item class={text.menu} onclick={() => onchange(undefined)}>
        <span class={cn("flex-1", !value && "font-medium")}>{i18n.t("chat.modelDefault")}</span>
      </DropdownMenu.Item>
      {#if models.length > 0}
        <DropdownMenu.Separator />
      {/if}
      {#each models as model (model.id)}
        <DropdownMenu.Item class={text.menu} onclick={() => onchange(model.id)}>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class={cn("truncate", model.id === value && "font-medium")}>
              {model.displayName || model.id}
            </span>
            {#if model.description || model.version}
              <span class={cn(text.meta, "truncate")}>{model.version ?? model.description}</span>
            {/if}
          </div>
        </DropdownMenu.Item>
      {:else}
        {#if loading}
          <DropdownMenu.Item class={text.menu} disabled>{i18n.t("chat.modelsLoading")}</DropdownMenu.Item>
        {/if}
      {/each}
    </div>
  </DropdownMenu.Content>
</DropdownMenu.Root>
