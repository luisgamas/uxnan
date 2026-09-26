<script lang="ts">
  // How much the agent may do before it asks — the thread's access mode, the
  // same three the phone offers. A quiet trigger (a lock and the mode's name)
  // opening the app's standard radio menu, each mode with an icon and one line
  // saying what it means.
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon";
  import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
  import SquareUnlock02Icon from "@hugeicons/core-free-icons/SquareUnlock02Icon";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import type { AccessMode } from "$shared/models/thread";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    value,
    disabled = false,
    onChange,
  }: {
    value: AccessMode;
    disabled?: boolean;
    onChange: (mode: AccessMode) => void;
  } = $props();

  const MODES = [
    { mode: "requestApproval", glyph: SquareLock02Icon },
    { mode: "approveForMe", glyph: PencilEdit02Icon },
    { mode: "fullAccess", glyph: SquareUnlock02Icon },
  ] as const satisfies readonly { mode: AccessMode; glyph: unknown }[];

  const current = $derived(MODES.find((m) => m.mode === value) ?? MODES[2]);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger {disabled}>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="sm"
        class={chat.pill}
        aria-label={i18n.t("chat.accessLabel")}
        title={i18n.t(`chat.accessDesc.${value}`)}
      >
        <Icon icon={current.glyph} class={icon.status} />
        <span class="truncate">{i18n.t(`chat.access.${value}`)}</span>
        <Icon icon={ArrowDown01Icon} class={cn(icon.status, "opacity-60")} />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content width="wide" align="start" side="top">
    <DropdownMenu.Label class={text.menuLabel}>{i18n.t("chat.accessLabel")}</DropdownMenu.Label>
    <DropdownMenu.RadioGroup {value} onValueChange={(v) => v && v !== value && onChange(v as AccessMode)}>
      {#each MODES as m (m.mode)}
        <DropdownMenu.RadioItem value={m.mode} class={cn(text.menu, "items-start")}>
          <Icon icon={m.glyph} class={cn(icon.decorative, "mt-0.5 shrink-0 text-muted-foreground")} />
          <div class="flex min-w-0 flex-col">
            <span>{i18n.t(`chat.access.${m.mode}`)}</span>
            <span class={text.meta}>{i18n.t(`chat.accessDesc.${m.mode}`)}</span>
          </div>
        </DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
