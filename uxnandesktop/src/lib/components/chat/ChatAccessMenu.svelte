<script lang="ts">
  // How much the agent may do before it asks — the mode the conversation runs
  // in, among the ones its agent offers (`capabilities.accessModes`, the same
  // list the phone shows), in the phone's colours: amber when it asks first,
  // green when it works on its own inside the project, red with full access,
  // sky when it only plans. The trigger carries the colour so the mode reads
  // at a glance; the menu shows each mode with one line saying what it means.
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon";
  import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
  import SquareUnlock02Icon from "@hugeicons/core-free-icons/SquareUnlock02Icon";
  import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import type { AccessMode } from "$shared/models/thread";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    value,
    modes,
    disabled = false,
    onChange,
  }: {
    /** The mode the conversation runs in (one of `modes`). */
    value: AccessMode;
    /** The modes its agent offers, in the order to list them. */
    modes: readonly AccessMode[];
    disabled?: boolean;
    onChange: (mode: AccessMode) => void;
  } = $props();

  const MODES = [
    {
      mode: "requestApproval",
      glyph: SquareLock02Icon,
      tone: "text-amber-600 dark:text-amber-400",
      pill: "bg-amber-500/12 text-amber-700 hover:bg-amber-500/20 hover:text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25 dark:hover:text-amber-200",
    },
    {
      mode: "approveForMe",
      glyph: PencilEdit02Icon,
      tone: "text-emerald-600 dark:text-emerald-400",
      pill: "bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25 dark:hover:text-emerald-200",
    },
    {
      mode: "fullAccess",
      glyph: SquareUnlock02Icon,
      tone: "text-red-600 dark:text-red-400",
      pill: "bg-red-500/12 text-red-700 hover:bg-red-500/20 hover:text-red-800 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25 dark:hover:text-red-200",
    },
    {
      mode: "plan",
      glyph: CheckListIcon,
      tone: "text-sky-600 dark:text-sky-400",
      pill: "bg-sky-500/12 text-sky-700 hover:bg-sky-500/20 hover:text-sky-800 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:bg-sky-500/25 dark:hover:text-sky-200",
    },
  ] as const satisfies readonly { mode: AccessMode; glyph: unknown; tone: string; pill: string }[];

  const current = $derived(MODES.find((m) => m.mode === value) ?? MODES[2]);
  const offered = $derived(MODES.filter((m) => modes.includes(m.mode)));
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger {disabled}>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="sm"
        class={cn(chat.pill, current.pill)}
        aria-label={i18n.t("chat.accessLabel")}
        title={i18n.t(`chat.accessDesc.${value}`)}
      >
        <Icon icon={current.glyph} class={icon.status} />
        <span class="truncate">{i18n.t(`chat.access.${value}`)}</span>
        <Icon icon={ArrowDown01Icon} class={cn(icon.status, "opacity-70")} />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content width="wide" align="start" side="top">
    <DropdownMenu.Label class={text.menuLabel}>{i18n.t("chat.accessLabel")}</DropdownMenu.Label>
    <DropdownMenu.RadioGroup {value} onValueChange={(v) => v && v !== value && onChange(v as AccessMode)}>
      {#each offered as m (m.mode)}
        <DropdownMenu.RadioItem value={m.mode} class={cn(text.menu, "items-start")}>
          <Icon icon={m.glyph} class={cn(icon.decorative, "mt-0.5 shrink-0", m.tone)} />
          <div class="flex min-w-0 flex-col">
            <span>{i18n.t(`chat.access.${m.mode}`)}</span>
            <span class={text.meta}>{i18n.t(`chat.accessDesc.${m.mode}`)}</span>
          </div>
        </DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
