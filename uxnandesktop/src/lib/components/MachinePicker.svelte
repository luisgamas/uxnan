<script lang="ts" module>
  /** The picker's value for this machine. */
  export const LOCAL_MACHINE = "local";
</script>

<script lang="ts">
  // Which machine a settings list is about: this one by default, or one of the
  // connected hosts — one at a time, so a list stays the same length however
  // many hosts you keep. Shown only when there is a host to pick; with none,
  // the caller draws its plain title instead.
  import * as Select from "$lib/components/ui/select";
  import { hosts } from "$lib/state/hosts.svelte";
  import { field } from "$lib/design";
  import { i18n } from "$lib/i18n";

  let {
    value,
    ariaLabel,
    onpick,
  }: {
    /** `LOCAL_MACHINE`, or a connected host's id. */
    value: string;
    ariaLabel: string;
    onpick: (id: string) => void;
  } = $props();

  const machines = $derived([LOCAL_MACHINE, ...hosts.connected]);

  function label(id: string): string {
    return id === LOCAL_MACHINE
      ? i18n.t("machine.here")
      : i18n.t("machine.onHost", { host: hosts.labelOf(id) });
  }

  /** A host that went away is not left picked as if it could still answer. */
  $effect(() => {
    if (value !== LOCAL_MACHINE && !hosts.connected.includes(value)) onpick(LOCAL_MACHINE);
  });
</script>

<Select.Root type="single" {value} onValueChange={(v) => v && onpick(v)}>
  <Select.Trigger size="sm" class={field.selectStandard} aria-label={ariaLabel}>
    <span class="truncate">{label(value)}</span>
  </Select.Trigger>
  <Select.Content>
    {#each machines as id (id)}
      <Select.Item value={id} label={label(id)}>{label(id)}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
