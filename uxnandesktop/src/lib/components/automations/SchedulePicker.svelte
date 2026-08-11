<script lang="ts">
  // Frequency editor: an interval ("every N minutes/hours/days/weeks") or a
  // clock-time preset. There is no one-shot option — an automation is recurring
  // by definition — and no cron field, which would not translate cleanly to any
  // of the three OS schedulers.
  //
  // The live "next runs" preview is computed here, in the frontend, because the
  // frontend is where local-calendar math belongs (spec `02f` §2.1). It is
  // display-only: the OS scheduler remains the authority on when a run fires.
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, text } from "$lib/design";
  import { nextOccurrences, validateSchedule } from "$lib/automations/schedule";
  import type { Schedule, TimeUnit } from "$lib/automations/types";
  import Combobox from "$lib/components/Combobox.svelte";
  import { Input } from "$lib/components/ui/input";

  let { schedule = $bindable() }: { schedule: Schedule } = $props();

  const KINDS = ["every", "dailyAt", "weekdaysAt", "weeklyAt"] as const;
  const UNITS: TimeUnit[] = ["minutes", "hours", "days", "weeks"];

  const kindGroups = $derived([
    {
      items: KINDS.map((k) => ({ value: k, label: i18n.t(`automations.kind.${k}`) })),
    },
  ]);
  const unitGroups = $derived([
    { items: UNITS.map((u) => ({ value: u, label: i18n.t(`automations.unit.${u}`) })) },
  ]);
  // Spelled out rather than built from an index: a template-literal key cannot
  // be checked against the message catalogue, so a typo would only surface at
  // runtime as a missing translation.
  const WEEKDAY_KEYS = [
    "automations.weekday.0",
    "automations.weekday.1",
    "automations.weekday.2",
    "automations.weekday.3",
    "automations.weekday.4",
    "automations.weekday.5",
    "automations.weekday.6",
  ] as const;
  const dayGroups = $derived([
    {
      items: WEEKDAY_KEYS.map((key, d) => ({ value: String(d), label: i18n.t(key) })),
    },
  ]);

  /** Switch shape while keeping whatever the user already typed, so flipping
   *  between "daily" and "weekly" doesn't silently reset the time. */
  function setKind(kind: string) {
    if (kind === schedule.kind) return;
    const hour = schedule.kind === "every" ? 9 : schedule.hour;
    const minute = schedule.kind === "every" ? 0 : schedule.minute;
    if (kind === "every") {
      schedule = { kind: "every", n: 30, unit: "minutes", startsAt: Date.now() };
    } else if (kind === "dailyAt") {
      schedule = { kind: "dailyAt", hour, minute };
    } else if (kind === "weekdaysAt") {
      schedule = { kind: "weekdaysAt", hour, minute };
    } else {
      schedule = { kind: "weeklyAt", day: 1, hour, minute };
    }
  }

  /** `<input type="time">` value for the clock presets. */
  const timeValue = $derived(
    schedule.kind === "every"
      ? ""
      : `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`,
  );
  function setTime(value: string) {
    if (schedule.kind === "every") return;
    const [h, m] = value.split(":").map(Number);
    if (Number.isInteger(h) && Number.isInteger(m)) {
      schedule = { ...schedule, hour: h, minute: m };
    }
  }

  const errors = $derived(validateSchedule(schedule));
  const preview = $derived(errors.length === 0 ? nextOccurrences(schedule, new Date(), 5) : []);
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
</script>

<div class="flex flex-col gap-3">
  <div class="flex flex-wrap items-center gap-2">
    <Combobox
      value={schedule.kind}
      groups={kindGroups}
      triggerClass={field.selectNarrow}
      onChange={setKind}
      searchPlaceholder={i18n.t("common.search")}
    />

    {#if schedule.kind === "every"}
      <Input
        type="number"
        min="1"
        class={field.editorNumber}
        value={String(schedule.n)}
        oninput={(e) => {
          const n = Number((e.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(n) && schedule.kind === "every") {
            schedule = { ...schedule, n: Math.max(1, Math.floor(n)) };
          }
        }}
      />
      <Combobox
        value={schedule.unit}
        groups={unitGroups}
        triggerClass={field.selectCompact}
        onChange={(v) => {
          if (schedule.kind === "every") schedule = { ...schedule, unit: v as TimeUnit };
        }}
        searchPlaceholder={i18n.t("common.search")}
      />
    {:else}
      {#if schedule.kind === "weeklyAt"}
        <Combobox
          value={String(schedule.day)}
          groups={dayGroups}
          triggerClass={field.selectCompact}
          onChange={(v) => {
            if (schedule.kind === "weeklyAt") schedule = { ...schedule, day: Number(v) };
          }}
          searchPlaceholder={i18n.t("common.search")}
        />
      {/if}
      <Input
        type="time"
        density="compact"
        class={field.time}
        value={timeValue}
        oninput={(e) => setTime((e.currentTarget as HTMLInputElement).value)}
      />
    {/if}
  </div>

  {#if errors.length > 0}
    <p class={cn(text.meta, "text-red-600 dark:text-red-400")}>
      {i18n.t("automations.scheduleInvalid")}
    </p>
  {:else}
    <!-- The preview is what makes an abstract recurrence legible before saving. -->
    <div class="flex flex-col gap-1">
      <span class={text.section}>{i18n.t("automations.nextRuns")}</span>
      <div class="flex flex-wrap gap-1.5">
        {#each preview as when (when.getTime())}
          <span
            class={cn(
              "rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 tabular-nums text-muted-foreground",
              text.indicator,
            )}
          >
            {fmt.format(when)}
          </span>
        {/each}
      </div>
    </div>
  {/if}
</div>
