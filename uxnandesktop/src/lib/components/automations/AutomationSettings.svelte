<script lang="ts">
  // Diagnostics rather than preferences: almost everything about an automation
  // is per-automation, so this pane exists to answer "can this machine actually
  // run these while uxnan is closed, and where does it all live".
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { panel, text } from "$lib/design";
  import { automations } from "$lib/state/automations.svelte";
  import { automationsRunsDir } from "$lib/api";
  import { isScheduled } from "$lib/automations/display";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import SchedulerBadge from "./SchedulerBadge.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";

  let runsDir = $state("");
  $effect(() => {
    if (runsDir) return;
    void automationsRunsDir()
      .then((d) => (runsDir = d))
      .catch(() => {});
  });

  const enabled = $derived(automations.items.filter((a) => a.enabled));
  const registered = $derived(
    enabled.filter((a) => isScheduled(automations.scheduler[a.id])).length,
  );

  async function recheck() {
    for (const a of automations.items) await automations.refreshScheduler(a.id);
  }
</script>

<div class="flex flex-col gap-6">
  <SettingsSection
    title={i18n.t("automations.schedulerTitle")}
    description={i18n.t("automations.schedulerDesc")}
  >
    <div class={cn("divide-y divide-border/50", panel.settingsBody)}>
      <SettingsRow
        label={i18n.t("automations.schedulerPlatform")}
        description={automations.schedulerSupported
          ? i18n.t("automations.schedulerSupportedDesc")
          : i18n.t("automations.schedUnsupportedTip")}
      >
        {#snippet control()}
          <SchedulerBadge
            status={automations.schedulerSupported ? { kind: "registered" } : { kind: "unsupported" }}
          />
        {/snippet}
      </SettingsRow>
      <SettingsRow
        label={i18n.t("automations.schedulerRegistered")}
        description={i18n.t("automations.schedulerRegisteredDesc")}
      >
        {#snippet control()}
          <div class="flex items-center gap-2">
            <span class={cn("tabular-nums", text.body)}>{registered} / {enabled.length}</span>
            <Button variant="outline" size="sm" onclick={recheck}>
              <Icon icon={RefreshCwIcon} data-icon="inline-start" />
              {i18n.t("automations.recheck")}
            </Button>
          </div>
        {/snippet}
      </SettingsRow>
    </div>
  </SettingsSection>

  <SettingsSection
    title={i18n.t("automations.storageTitle")}
    description={i18n.t("automations.storageDesc")}
  >
    <div class={panel.settingsBody}>
      <p class={cn("break-all font-mono", text.meta)}>{runsDir || "—"}</p>
    </div>
  </SettingsSection>
</div>
