<script lang="ts">
  // The app's one model picker — Settings → AI commit, GitHub PR drafts,
  // orchestration steps and the chat composer. A trigger showing the chosen
  // model opens a compact menu of the models, searchable and grouped by
  // provider — OpenCode and pi report hundreds of `provider/model` ids, where
  // the provider prefix is the least distinguishing part, so rows show the
  // model and the group names the provider. The first row is "Default model"
  // (no model flag: the CLI's own). A model's run options (reasoning effort,
  // …) have their own picker beside it, `RunOptionsPicker`.
  //
  // Composed from the shared primitives: `Popover` + `Command` (type to
  // filter, arrows, Enter), `Button` for the trigger — `field` in a form
  // (outline, sized by `triggerClass`), `pill` in a toolbar (`chat.pill`:
  // ghost until hovered).
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon";
  import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
  import { groupModels, modelName, type PickerModel } from "$lib/models";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    models,
    value,
    loading = false,
    allowDefault = true,
    variant = "field",
    triggerClass = "w-56",
    disabled = false,
    onSelect,
  }: {
    models: PickerModel[];
    /** The chosen model id; `""` = the CLI's own default. */
    value: string;
    /** A model-list query is in flight. */
    loading?: boolean;
    /** Offer "Default model" (a running chat always has a concrete model). */
    allowDefault?: boolean;
    /** `field` in a form or settings row; `pill` in a toolbar. */
    variant?: "field" | "pill";
    /** The `field` trigger's width (a `field.select*` token or a width class). */
    triggerClass?: string;
    disabled?: boolean;
    onSelect: (id: string) => void;
  } = $props();

  const DEFAULT = "__default__";
  let open = $state(false);

  const current = $derived(models.find((m) => m.id === value));
  const groups = $derived(groupModels(models));
  /** Search only pays off past a screenful. */
  const searchable = $derived(models.length > 8);
  const label = $derived(current ? modelName(current) : value || i18n.t("modelPicker.default"));
  const waiting = $derived(loading && models.length === 0);

  function choose(id: string) {
    open = false;
    if (id !== value) onSelect(id);
  }

</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <!-- {...props} first, then class — otherwise the trigger's own (empty)
           class wins and the button loses its width. -->
      <Button
        {...props}
        variant={variant === "pill" ? "ghost" : "outline"}
        size="sm"
        {disabled}
        role="combobox"
        aria-expanded={open}
        aria-label={i18n.t("modelPicker.label")}
        class={variant === "pill"
          ? cn(chat.pill, "max-w-64")
          : cn("justify-between font-normal", triggerClass)}
      >
        <span class="truncate">{waiting ? i18n.t("modelPicker.loading") : label}</span>
        {#if waiting}
          <Spinner class={icon.status} aria-hidden="true" />
        {:else}
          <Icon
            icon={variant === "pill" ? ArrowDown01Icon : UnfoldMoreIcon}
            class={cn(variant === "pill" ? icon.status : "ml-1", "shrink-0 opacity-60")}
          />
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content width="command" padding="none" align="start">
    <Command.Root value={value || DEFAULT}>
      {#if searchable}<Command.Input placeholder={i18n.t("modelPicker.search")} />{/if}
      <!-- `uxnan-scroll` = the app's thin scrollbar. -->
      <Command.List class="uxnan-scroll max-h-72">
        {#if waiting}
          <div class={cn(text.meta, "flex items-center gap-2 px-3 py-2.5")}>
            <Spinner class={icon.status} />
            {i18n.t("modelPicker.loading")}
          </div>
        {/if}
        <Command.Empty>{i18n.t("modelPicker.noMatch")}</Command.Empty>
        {#if allowDefault}
          <Command.Group>
            <Command.Item value={DEFAULT} keywords={[i18n.t("modelPicker.default")]} onSelect={() => choose("")}>
              <span class={cn("flex-1 truncate", text.body)}>{i18n.t("modelPicker.default")}</span>
              {#if !value}<Icon icon={CheckIcon} class="size-3.5 shrink-0 text-primary" />{/if}
            </Command.Item>
          </Command.Group>
        {/if}
        {#each groups as group (group.provider ?? "")}
          <Command.Group heading={group.provider ?? undefined}>
            {#each group.models as model (model.id)}
              <Command.Item
                value={model.id}
                keywords={[model.displayName, group.provider ?? ""].filter(Boolean)}
                title={model.id}
                onSelect={() => choose(model.id)}
              >
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class={cn("truncate", text.body)}>{modelName(model)}</span>
                  {#if model.description}
                    <span class={cn("truncate", text.meta)}>{model.description}</span>
                  {/if}
                </div>
                {#if model.id === value}<Icon icon={CheckIcon} class="size-3.5 shrink-0 text-primary" />{/if}
              </Command.Item>
            {/each}
          </Command.Group>
        {/each}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
