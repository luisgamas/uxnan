<script lang="ts">
  // Settings → Resources → Resource mode: the preset picker (with an honest
  // per-preset effects view), the workspace auto-sleep feature flag, and the
  // advanced per-capability overrides with "use preset" / reset.
  //
  // Everything shown is derived from the RESOLVED policy, so the effects list
  // always states what will actually happen — overrides included, each marked.
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
  import * as Select from "$lib/components/ui/select";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { resourceMode } from "$lib/state/resourceMode.svelte";
  import {
    AUTO_SLEEP_LEVELS,
    LIMITS,
    RESOURCE_PROFILES,
    type OverridableKey,
    type ResourceProfile,
    type WorkspaceAutoSleepLevel,
  } from "$lib/resources/policy";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { Icon } from "$lib/components/ui/icon";
  import LeafIcon from "@hugeicons/core-free-icons/Leaf01Icon";
  import ScaleIcon from "@hugeicons/core-free-icons/BalanceScaleIcon";
  import GaugeIcon from "@hugeicons/core-free-icons/GaugeIcon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import RotateCcwIcon from "@hugeicons/core-free-icons/Rotate01Icon";

  const policy = $derived(resourceMode.policy);
  const caps = $derived(policy.capabilities);
  const overridden = $derived(new Set(policy.overridden));

  const PROFILE_ICONS = { efficient: LeafIcon, balanced: ScaleIcon, performance: GaugeIcon };

  function profileName(p: ResourceProfile): string {
    return i18n.t(`resourceMode.profile.${p}`);
  }
  function profileDesc(p: ResourceProfile): string {
    return i18n.t(`resourceMode.profile.${p}Desc`);
  }

  // Roving radio group: the checked card is the tab stop, arrows move + select.
  function onGroupKeydown(e: KeyboardEvent): void {
    const delta =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    const at = RESOURCE_PROFILES.indexOf(policy.profile);
    const next =
      RESOURCE_PROFILES[(at + delta + RESOURCE_PROFILES.length) % RESOURCE_PROFILES.length];
    resourceMode.setProfile(next);
    // Follow the selection with focus, radio-group style.
    queueMicrotask(() => {
      const el = document.querySelector<HTMLElement>(`[data-resource-profile="${next}"]`);
      el?.focus();
    });
  }

  /** One line of the effects view. */
  interface EffectLine {
    key: OverridableKey | "reconcile" | "github" | "usage";
    label: string;
    value: string;
    overridden: boolean;
  }

  function autoSleepValue(level: WorkspaceAutoSleepLevel, minutes: number): string {
    const base =
      level === "off"
        ? i18n.t("resourceMode.effect.autoSleepOff")
        : level === "suggest"
          ? i18n.t("resourceMode.effect.autoSleepSuggest", { minutes })
          : i18n.t("resourceMode.effect.autoSleepAuto", { minutes });
    if (level !== "off" && !policy.autoSleepEnabled) {
      return `${base} ${i18n.t("resourceMode.effect.autoSleepFlagOff")}`;
    }
    return base;
  }

  const effects = $derived.by((): EffectLine[] => [
    {
      key: "gitSweepIntervalMs",
      label: i18n.t("resourceMode.effect.gitSweep"),
      value: i18n.t("resourceMode.effect.everySeconds", {
        seconds: Math.round(caps.gitSweepIntervalMs / 1000),
      }),
      overridden: overridden.has("gitSweepIntervalMs"),
    },
    {
      key: "reconcile",
      label: i18n.t("resourceMode.effect.reconcile"),
      // 0 = every driver tick (3 s) — the pre-mode behavior.
      value: i18n.t("resourceMode.effect.everySeconds", {
        seconds: Math.max(3, Math.round(caps.worktreeReconcileIntervalMs / 1000)),
      }),
      overridden: false,
    },
    {
      key: "github",
      label: i18n.t("resourceMode.effect.github"),
      value:
        caps.githubPollFactor > 1
          ? i18n.t("resourceMode.effect.intervalRelaxed", { factor: caps.githubPollFactor })
          : caps.githubPollFactor < 1
            ? i18n.t("resourceMode.effect.intervalFresher")
            : i18n.t("resourceMode.effect.intervalNormal"),
      overridden: false,
    },
    {
      key: "usage",
      label: i18n.t("resourceMode.effect.usage"),
      value:
        caps.usageRefreshFactor > 1
          ? i18n.t("resourceMode.effect.intervalRelaxed", { factor: caps.usageRefreshFactor })
          : i18n.t("resourceMode.effect.intervalNormal"),
      overridden: false,
    },
    {
      key: "orchestrationConcurrency",
      label: i18n.t("resourceMode.effect.orchestration"),
      value:
        caps.orchestrationExtendedConcurrency !== null
          ? i18n.t("resourceMode.effect.orchestrationExtended", {
              n: caps.orchestrationConcurrency,
              max: caps.orchestrationExtendedConcurrency,
            })
          : i18n.t("resourceMode.effect.orchestrationSteps", {
              n: caps.orchestrationConcurrency,
            }),
      overridden: overridden.has("orchestrationConcurrency"),
    },
    {
      key: "resourceHistorySeconds",
      label: i18n.t("resourceMode.effect.history"),
      value: i18n.t("resourceMode.effect.historyMinutes", {
        minutes: Math.round(caps.resourceHistorySeconds / 60),
      }),
      overridden: overridden.has("resourceHistorySeconds"),
    },
    {
      key: "petFlavour",
      label: i18n.t("resourceMode.effect.pet"),
      value: caps.petFlavour
        ? i18n.t("resourceMode.effect.petNormal")
        : i18n.t("resourceMode.effect.petReduced"),
      overridden: overridden.has("petFlavour"),
    },
    {
      key: "workspaceAutoSleep",
      label: i18n.t("resourceMode.effect.autoSleep"),
      value: autoSleepValue(caps.workspaceAutoSleep, caps.autoSleepIdleMinutes),
      overridden:
        overridden.has("workspaceAutoSleep") || overridden.has("autoSleepIdleMinutes"),
    },
  ]);

  let advancedOpen = $state(false);

  /** Clamp + set a numeric override from an input's change event. */
  function setNumber(
    key: "gitSweepIntervalMs" | "orchestrationConcurrency" | "resourceHistorySeconds" | "autoSleepIdleMinutes",
    raw: string,
    scale = 1,
  ): void {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const bounds = LIMITS[key];
    const value = Math.min(bounds.max, Math.max(bounds.min, Math.round(n * scale)));
    resourceMode.setOverride(key, value);
  }

  const autoSleepLevelLabel = $derived(i18n.t(`resourceMode.level.${caps.workspaceAutoSleep}`));
</script>

<SettingsSection title={i18n.t("resourceMode.title")} description={i18n.t("resourceMode.desc")} bare>
  <div class="space-y-6">
    <!-- Preset picker: three selectable cards behaving as one radio group. -->
    <div
      role="radiogroup"
      aria-label={i18n.t("resourceMode.profileGroup")}
      class="grid gap-2 md:grid-cols-3"
    >
      {#each RESOURCE_PROFILES as p (p)}
        {@const glyph = PROFILE_ICONS[p]}
        {@const checked = policy.profile === p}
        <button
          type="button"
          role="radio"
          aria-checked={checked}
          tabindex={checked ? 0 : -1}
          data-resource-profile={p}
          onkeydown={onGroupKeydown}
          class={cn(
            "flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            checked
              ? "border-foreground/25 bg-[var(--ux-sidebar-accent)]"
              : "border-border/50 bg-muted/20 hover:bg-accent/50",
          )}
          onclick={() => resourceMode.setProfile(p)}
        >
          <span class="flex items-center gap-2">
            <Icon icon={glyph} class={cn(icon.button, checked ? "text-foreground" : "text-muted-foreground")} />
            <span class={cn(text.bodyStrong, !checked && "text-muted-foreground")}>
              {profileName(p)}
            </span>
          </span>
          <span class="text-[12px] leading-5 text-muted-foreground">{profileDesc(p)}</span>
        </button>
      {/each}
    </div>

    <!-- Effects view: what the SELECTED profile (with overrides) actually does. -->
    <div class="space-y-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
      <span class={text.section}>{i18n.t("resourceMode.effectsTitle")}</span>
      <ul class="space-y-1.5">
        {#each effects as line (line.key)}
          <li class={cn("flex items-baseline justify-between gap-4", text.meta)}>
            <span class="min-w-0 truncate">{line.label}</span>
            <span class="shrink-0 text-right font-medium text-foreground/80">
              {line.value}
              {#if line.overridden}
                <span
                  class="ml-1 rounded bg-muted px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {i18n.t("resourceMode.overriddenBadge")}
                </span>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </div>

    <!-- Workspace auto-sleep feature flag (the capability level lives in the
         preset / its advanced override; this switch gates everything). -->
    <div class="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/20 px-4 py-1">
      <SettingsRow
        label={i18n.t("resourceMode.autoSleepFlag")}
        description={i18n.t("resourceMode.autoSleepFlagDesc")}
      >
        {#snippet control()}
          <Switch
            checked={policy.autoSleepEnabled}
            aria-label={i18n.t("resourceMode.autoSleepFlag")}
            onCheckedChange={(c) => resourceMode.setAutoSleepFlag(c)}
          />
        {/snippet}
      </SettingsRow>
    </div>

    <!-- Advanced overrides -->
    <Collapsible.Root bind:open={advancedOpen}>
      <Collapsible.Trigger
        class={cn(
          "flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left",
          "text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <Icon icon={ChevronDownIcon}
          class={cn("size-3.5 transition-transform", !advancedOpen && "-rotate-90")}
        />
        {i18n.t("resourceMode.advanced")}
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="mt-2 space-y-3">
          <p class={text.meta}>{i18n.t("resourceMode.advancedDesc")}</p>
          <div
            class="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/20 px-4 py-1"
          >
            <SettingsRow
              label={i18n.t("resourceMode.override.gitSweep")}
              description={i18n.t("resourceMode.override.gitSweepDesc")}
              for="rm-git-sweep"
            >
              {#snippet control()}
                <span class="flex items-center gap-1.5">
                  {@render usePreset("gitSweepIntervalMs")}
                  <Input
                    id="rm-git-sweep"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    min={LIMITS.gitSweepIntervalMs.min / 1000}
                    max={LIMITS.gitSweepIntervalMs.max / 1000}
                    value={Math.round(caps.gitSweepIntervalMs / 1000)}
                    onchange={(e) =>
                      setNumber(
                        "gitSweepIntervalMs",
                        (e.currentTarget as HTMLInputElement).value,
                        1000,
                      )}
                  />
                </span>
              {/snippet}
            </SettingsRow>

            <SettingsRow
              label={i18n.t("resourceMode.override.concurrency")}
              description={i18n.t("resourceMode.override.concurrencyDesc")}
              for="rm-concurrency"
            >
              {#snippet control()}
                <span class="flex items-center gap-1.5">
                  {@render usePreset("orchestrationConcurrency")}
                  <Input
                    id="rm-concurrency"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    min={LIMITS.orchestrationConcurrency.min}
                    max={LIMITS.orchestrationConcurrency.max}
                    value={caps.orchestrationConcurrency}
                    onchange={(e) =>
                      setNumber(
                        "orchestrationConcurrency",
                        (e.currentTarget as HTMLInputElement).value,
                      )}
                  />
                </span>
              {/snippet}
            </SettingsRow>

            <SettingsRow
              label={i18n.t("resourceMode.override.history")}
              description={i18n.t("resourceMode.override.historyDesc")}
              for="rm-history"
            >
              {#snippet control()}
                <span class="flex items-center gap-1.5">
                  {@render usePreset("resourceHistorySeconds")}
                  <Input
                    id="rm-history"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    min={LIMITS.resourceHistorySeconds.min}
                    max={LIMITS.resourceHistorySeconds.max}
                    value={caps.resourceHistorySeconds}
                    onchange={(e) =>
                      setNumber(
                        "resourceHistorySeconds",
                        (e.currentTarget as HTMLInputElement).value,
                      )}
                  />
                </span>
              {/snippet}
            </SettingsRow>

            <SettingsRow
              label={i18n.t("resourceMode.override.pet")}
              description={i18n.t("resourceMode.override.petDesc")}
            >
              {#snippet control()}
                <span class="flex items-center gap-1.5">
                  {@render usePreset("petFlavour")}
                  <Switch
                    checked={caps.petFlavour}
                    aria-label={i18n.t("resourceMode.override.pet")}
                    onCheckedChange={(c) => resourceMode.setOverride("petFlavour", c)}
                  />
                </span>
              {/snippet}
            </SettingsRow>

            <SettingsRow
              label={i18n.t("resourceMode.override.autoSleepLevel")}
              description={i18n.t("resourceMode.override.autoSleepLevelDesc")}
            >
              {#snippet control()}
                <span class="flex items-center gap-1.5">
                  {@render usePreset("workspaceAutoSleep")}
                  <Select.Root
                    type="single"
                    value={caps.workspaceAutoSleep}
                    onValueChange={(v) =>
                      resourceMode.setOverride(
                        "workspaceAutoSleep",
                        v as WorkspaceAutoSleepLevel,
                      )}
                  >
                    <Select.Trigger class="h-8 w-36 text-xs" disabled={!policy.autoSleepEnabled}>
                      {autoSleepLevelLabel}
                    </Select.Trigger>
                    <Select.Content>
                      {#each AUTO_SLEEP_LEVELS as level (level)}
                        <Select.Item value={level} label={i18n.t(`resourceMode.level.${level}`)}>
                          {i18n.t(`resourceMode.level.${level}`)}
                        </Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </span>
              {/snippet}
            </SettingsRow>

            <SettingsRow
              label={i18n.t("resourceMode.override.idle")}
              description={i18n.t("resourceMode.override.idleDesc")}
              for="rm-idle"
            >
              {#snippet control()}
                <span class="flex items-center gap-1.5">
                  {@render usePreset("autoSleepIdleMinutes")}
                  <Input
                    id="rm-idle"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    min={LIMITS.autoSleepIdleMinutes.min}
                    max={LIMITS.autoSleepIdleMinutes.max}
                    disabled={!policy.autoSleepEnabled}
                    value={caps.autoSleepIdleMinutes}
                    onchange={(e) =>
                      setNumber(
                        "autoSleepIdleMinutes",
                        (e.currentTarget as HTMLInputElement).value,
                      )}
                  />
                </span>
              {/snippet}
            </SettingsRow>
          </div>

          {#if policy.overridden.length > 0}
            <Button variant="outline" size="sm" onclick={() => resourceMode.resetOverrides()}>
              <Icon icon={RotateCcwIcon} class="size-3.5" />
              {i18n.t("resourceMode.reset")}
            </Button>
          {/if}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  </div>
</SettingsSection>

<!-- The "use preset" affordance shown beside an overridden control. -->
{#snippet usePreset(key: OverridableKey)}
  {#if overridden.has(key)}
    <TooltipSimple title={i18n.t("resourceMode.usePreset")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-sm"
          class="size-6"
          aria-label={i18n.t("resourceMode.usePreset")}
          onclick={() => resourceMode.clearOverride(key)}
        >
          <Icon icon={RotateCcwIcon} class="size-3" />
        </Button>
      {/snippet}
    </TooltipSimple>
  {/if}
{/snippet}
