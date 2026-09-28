<script lang="ts" module>
  /**
   * Each agent's colour, fixed to the agent (never to its rank): the reference
   * categorical palette in its checked order, light and dark steps. Neighbours
   * in the stack are always pairs the palette was validated for.
   */
  export const AGENT_COLOURS: Record<string, { fill: string; swatch: string }> = {
    codex: { fill: "fill-[#2a78d6] dark:fill-[#3987e5]", swatch: "bg-[#2a78d6] dark:bg-[#3987e5]" },
    "claude-code": { fill: "fill-[#eb6834] dark:fill-[#d95926]", swatch: "bg-[#eb6834] dark:bg-[#d95926]" },
    opencode: { fill: "fill-[#1baf7a] dark:fill-[#199e70]", swatch: "bg-[#1baf7a] dark:bg-[#199e70]" },
    grok: { fill: "fill-[#eda100] dark:fill-[#c98500]", swatch: "bg-[#eda100] dark:bg-[#c98500]" },
    "pi-agent": { fill: "fill-[#e87ba4] dark:fill-[#d55181]", swatch: "bg-[#e87ba4] dark:bg-[#d55181]" },
    "antigravity-cli": { fill: "fill-[#008300] dark:fill-[#008300]", swatch: "bg-[#008300]" },
    zero: { fill: "fill-[#4a3aa7] dark:fill-[#9085e9]", swatch: "bg-[#4a3aa7] dark:bg-[#9085e9]" },
  };
  const OTHER = { fill: "fill-muted-foreground/60", swatch: "bg-muted-foreground/60" };
</script>

<script lang="ts">
  // Settings → Providers: what the agents on this PC spent, from the bridge's
  // `usage/summary` — every model response each agent CLI recorded, the
  // bridge's turns and the person's own terminal sessions alike.
  //
  // The headline number, then one column per day stacked by agent (hover a day
  // for its figures), then each agent's share and the models behind it. Cost
  // is what the provider billed where the CLI records it, else an estimate at
  // API prices (said so); a model with no known price counts in tokens only.
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { columnOutline, stackColumn } from "$lib/spendColumn";
  import { Segmented } from "$lib/components/ui/segmented";
  import { Spinner } from "$lib/components/ui/spinner";
  import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { bridge } from "$lib/bridge/client.svelte";
  import { bridgeAgentLogo } from "$lib/bridge/agents";
  import { AGENT_CATALOG } from "$lib/agentCatalog";
  import { chat } from "$lib/bridge/chat.svelte";
  import { bridgePanel } from "$lib/bridge/bridgePanel.svelte";
  import { usage, SPEND_PERIODS, type SpendPeriod } from "$lib/state/usage.svelte";
  import { formatMoney } from "$lib/usageFormat";
  import {
    formatTokens,
    niceScale,
    spendView,
    tokensOf,
    type SpendMetric,
  } from "$lib/usageSpend";
  import type { UsageSpend } from "$lib/types";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus as focusStyle, icon, row as rowStyle, text } from "$lib/design";
  import SettingsSection from "./SettingsSection.svelte";

  let metric = $state<SpendMetric>("cost");
  const connected = $derived(bridge.status.state === "connected");
  /** One agent picked from the legend: the chart shows only it, rescaled. */
  let focus = $state<string | null>(null);
  const costView = $derived(usage.spend ? spendView(usage.spend, usage.spendDays, "cost") : null);
  /** A focused agent with no known price is charted in tokens, not as $0. */
  const shownMetric = $derived<SpendMetric>(
    metric === "cost" &&
      focus !== null &&
      costView?.agents.some((a) => a.agentId === focus && unpriced(a.spend))
      ? "tokens"
      : metric,
  );
  const view = $derived(
    usage.spend
      ? shownMetric === "cost"
        ? costView
        : spendView(usage.spend, usage.spendDays, shownMetric)
      : null,
  );
  const chartAgents = $derived(
    view ? view.agents.filter((a) => focus === null || a.agentId === focus) : [],
  );
  const chartPeak = $derived(
    view
      ? Math.max(0, ...view.days.map((d) => chartAgents.reduce((sum, a) => sum + (d.byAgent[a.agentId] ?? 0), 0)))
      : 0,
  );
  const scale = $derived(niceScale(chartPeak));
  /** The headline and the models: the whole period, or the focused agent's. */
  const shown = $derived.by(() => {
    const agent = focus !== null ? view?.agents.find((a) => a.agentId === focus) : undefined;
    if (agent) return { spend: agent.spend, sessions: agent.sessions };
    return view ? { spend: view.total, sessions: view.sessions } : undefined;
  });
  const shownModels = $derived(view ? view.models.filter((m) => focus === null || m.agentId === focus) : []);
  $effect(() => {
    if (focus !== null && view && !view.agents.some((a) => a.agentId === focus)) focus = null;
  });
  /** A spend record in the measure the person picked. */
  const measure = (s: UsageSpend) =>
    metric === "cost" ? formatMoney(s.costUsd) : formatTokens(tokensOf(s));
  const fmt = (n: number) => (shownMetric === "cost" ? formatMoney(n) : formatTokens(n));
  const colour = (agentId: string) => AGENT_COLOURS[agentId] ?? OTHER;
  /** Spend whose cost is unknown: nothing billed, nothing priced. */
  const unpriced = (s: UsageSpend) => s.costUsd === 0 && s.unpricedTokens > 0;
  const sharePct = (share: number) =>
    share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;
  /** The agent's name: as the bridge lists it, else as the catalog knows its
   *  mark (an agent with history on this PC that the bridge no longer runs). */
  const agentName = (agentId: string) =>
    chat.agent(agentId)?.displayName ??
    AGENT_CATALOG.find((a) => a.logo === bridgeAgentLogo(agentId))?.name ??
    agentId;

  // --- the chart ------------------------------------------------------------
  const HEIGHT = 168;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 20;
  let width = $state(600);
  const plot = $derived(HEIGHT - PAD_TOP - PAD_BOTTOM);
  const slot = $derived(view ? width / view.days.length : 0);
  /** Columns keep a gap between them, wider on short periods. */
  const barWidth = $derived(Math.max(2, slot - Math.max(2, slot * 0.28)));
  const y = (v: number) => PAD_TOP + plot - (v / scale.max) * plot;

  /** The chart's own prefix for its column clips (ids are page-wide). */
  const clipId = $props.id();
  const baseline = $derived(PAD_TOP + plot);

  /** Each day's column: its rounded outline (the segments' clip) and the
   *  agents' segments stacked bottom up in their fixed order — every agent
   *  visible and apart from the next (`$lib/spendColumn`). */
  const columns = $derived.by(() => {
    if (!view) return [];
    const order = chartAgents.map((a) => a.agentId);
    return view.days.map((day, index) => {
      const x = index * slot + (slot - barWidth) / 2;
      const values = order.map((id) => day.byAgent[id] ?? 0);
      const total = values.reduce((sum, v) => sum + v, 0);
      const layout = stackColumn(values, baseline - y(total));
      return {
        day,
        x,
        outline: layout.height > 0 ? columnOutline(x, baseline, barWidth, layout.height) : "",
        segments: layout.segments.map((segment) => ({
          agentId: order[segment.index]!,
          y: baseline - segment.top,
          height: segment.top - segment.bottom,
        })),
      };
    });
  });

  let hover = $state<number | null>(null);
  function onMove(event: PointerEvent) {
    if (!view) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const index = Math.floor((event.clientX - rect.left) / slot);
    hover = index >= 0 && index < view.days.length ? index : null;
  }
  const hovered = $derived(hover !== null && view ? view.days[hover] : null);

  function dayLabel(day: string, long = false): string {
    const [yy, mm, dd] = day.split("-").map(Number);
    const date = new Date(yy!, mm! - 1, dd!);
    return date.toLocaleDateString(i18n.locale, long ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
  }
  const axisDays = $derived(
    view ? [0, Math.floor((view.days.length - 1) / 2), view.days.length - 1].map((i) => ({ i, day: view.days[i]!.day })) : [],
  );
</script>

{#snippet spendControls()}
  <div class="flex items-center gap-2">
    <Segmented
      label={i18n.t("spend.metric")}
      value={metric}
      options={[
        { value: "cost", label: i18n.t("spend.cost") },
        { value: "tokens", label: i18n.t("spend.tokens") },
      ]}
      onValueChange={(v) => (metric = v as SpendMetric)}
    />
    <Segmented
      label={i18n.t("spend.period")}
      value={String(usage.spendDays)}
      options={SPEND_PERIODS.map((d) => ({ value: String(d), label: i18n.t("spend.days", { n: d }) }))}
      onValueChange={(v) => void usage.loadSpend(Number(v) as SpendPeriod)}
    />
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={i18n.t("spend.refresh")}
      title={i18n.t("spend.refresh")}
      disabled={usage.spendLoading}
      onclick={() => void usage.loadSpend()}
    >
      {#if usage.spendLoading}
        <Spinner class={icon.action} />
      {:else}
        <Icon icon={RefreshIcon} class={icon.action} />
      {/if}
    </Button>
  </div>
{/snippet}

<SettingsSection
  title={i18n.t("spend.title")}
  description={i18n.t("spend.desc")}
  headerAction={connected ? spendControls : undefined}
>
    {#if !connected}
      <div class="flex flex-col items-center gap-3 py-6 text-center">
        <p class={cn(text.meta, "max-w-sm")}>{i18n.t("spend.bridgeOff")}</p>
        <Button size="sm" variant="outline" onclick={() => bridgePanel.show()}>
          {i18n.t("spend.openBridge")}
        </Button>
      </div>
    {:else if !view || !shown}
      <div class="flex items-center justify-center gap-2 py-10">
        {#if usage.spendError}
          <p class={cn(text.meta, "text-destructive")}>{usage.spendError}</p>
        {:else}
          <Spinner class={cn(icon.action, "text-muted-foreground")} />
          <span class={text.meta}>{i18n.t("spend.reading")}</span>
        {/if}
      </div>
    {:else}
      {@const noPrice = metric === "cost" && unpriced(shown.spend)}
      <!-- The headline: the period's total, or the focused agent's. -->
      <div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <div class="font-title text-3xl font-medium tracking-tight tabular-nums">
            {noPrice
              ? formatTokens(tokensOf(shown.spend))
              : measure(shown.spend)}
          </div>
          <div class={text.meta}>
            {focus !== null ? `${agentName(focus)} · ` : ""}{noPrice
              ? i18n.t("spend.tokensNoPrice")
              : metric === "cost"
                ? shown.spend.estimatedCostUsd > 0
                  ? i18n.t("spend.costEstimated")
                  : i18n.t("spend.costBilled")
                : i18n.t("spend.tokensTotal")}
          </div>
        </div>
        <div class={cn(text.meta, "flex flex-wrap gap-x-4 gap-y-1")}>
          <span>{i18n.t("spend.sessions", { n: shown.sessions })}</span>
          <span>{i18n.t("spend.responses", { n: shown.spend.responses.toLocaleString(i18n.locale) })}</span>
          {#if metric === "cost"}
            <span>{i18n.t("spend.tokensInline", { n: formatTokens(tokensOf(shown.spend)) })}</span>
          {:else}
            <span>{i18n.t("spend.cachedShare", { pct: Math.round((shown.spend.cachedInputTokens / Math.max(1, tokensOf(shown.spend))) * 100) })}</span>
          {/if}
          {#if metric === "cost" && !noPrice && shown.spend.unpricedTokens > 0}
            <span>{i18n.t("spend.unpriced", { n: formatTokens(shown.spend.unpricedTokens) })}</span>
          {/if}
        </div>
      </div>

      {#if view.agents.length === 0}
        <p class={cn(text.meta, "py-8 text-center")}>{i18n.t("spend.empty")}</p>
      {:else}
        <!-- One column per day, stacked by agent. -->
        <div class="relative mt-5" bind:clientWidth={width}>
          <svg
            role="img"
            aria-label={i18n.t("spend.chartLabel")}
            width={width}
            height={HEIGHT}
            class="block overflow-visible"
            onpointermove={onMove}
            onpointerleave={() => (hover = null)}
          >
            {#each scale.ticks as tick (tick)}
              <line x1="0" x2={width} y1={y(tick)} y2={y(tick)} class="stroke-border/60" stroke-width="1" />
            {/each}
            {#each columns as column, i (column.day.day)}
              {#if hover === i}
                <rect x={i * slot} y={PAD_TOP} width={slot} height={plot} class="fill-foreground/[0.04]" />
              {/if}
              {#if column.outline}
                <clipPath id="{clipId}-{i}"><path d={column.outline} /></clipPath>
                <g clip-path="url(#{clipId}-{i})">
                  {#each column.segments as segment (segment.agentId)}
                    <rect
                      x={column.x}
                      y={segment.y}
                      width={barWidth}
                      height={segment.height}
                      class={colour(segment.agentId).fill}
                    />
                  {/each}
                </g>
              {/if}
            {/each}
            {#each axisDays as tick (tick.i)}
              <text
                x={tick.i * slot + slot / 2}
                y={HEIGHT - 4}
                text-anchor={tick.i === 0 ? "start" : tick.i === view.days.length - 1 ? "end" : "middle"}
                class="fill-muted-foreground text-[10px]"
              >{dayLabel(tick.day)}</text>
            {/each}
            <text x={width} y={y(scale.max) - 1} text-anchor="end" class="fill-muted-foreground text-[10px]">{fmt(scale.max)}</text>
          </svg>
          {#if hovered && hover !== null}
            <div
              class="pointer-events-none absolute top-0 z-10 min-w-40 rounded-lg border border-border/60 bg-popover/95 px-3 py-2 text-xs shadow-md backdrop-blur"
              style:left={`${Math.min(Math.max(0, hover * slot + slot / 2 - 80), Math.max(0, width - 170))}px`}
            >
              <div class="mb-1 font-medium">{dayLabel(hovered.day, true)}</div>
              {#each chartAgents.filter((a) => (hovered.byAgent[a.agentId] ?? 0) > 0) as agent (agent.agentId)}
                <div class="flex items-center gap-2">
                  <span class={cn("size-2 shrink-0 rounded-xs", colour(agent.agentId).swatch)}></span>
                  <span class="flex-1 text-muted-foreground">{agentName(agent.agentId)}</span>
                  <span class="tabular-nums">{fmt(hovered.byAgent[agent.agentId] ?? 0)}</span>
                </div>
              {:else}
                <div class="text-muted-foreground">{i18n.t("spend.nothingThatDay")}</div>
              {/each}
              {#if focus === null && hovered.total > 0}
                <div class="mt-1 flex justify-between border-t border-border/60 pt-1">
                  <span class="text-muted-foreground">{i18n.t("spend.total")}</span>
                  <span class="font-medium tabular-nums">{fmt(hovered.total)}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Each agent: its colour, share and figures (the legend). -->
        <ul class="mt-5 -mx-2.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {#each (metric === "cost" ? (costView ?? view) : view).agents as agent (agent.agentId)}
            <li>
              <button
                type="button"
                class={cn(
                  rowStyle.list,
                  "min-w-0 transition-[background-color,color,opacity]",
                  focus === agent.agentId ? rowStyle.listActive : rowStyle.listInactive,
                  focusStyle.ring,
                  focus !== null && focus !== agent.agentId && "opacity-45",
                )}
                aria-pressed={focus === agent.agentId}
                title={focus === agent.agentId ? i18n.t("spend.showAll") : i18n.t("spend.showOnly")}
                onclick={() => (focus = focus === agent.agentId ? null : agent.agentId)}
              >
              <span class={cn("size-2.5 shrink-0 rounded-xs", colour(agent.agentId).swatch)}></span>
              <AgentLogo logo={bridgeAgentLogo(agent.agentId)} class={cn(icon.brand, "shrink-0")} />
              <span class={cn(text.body, "min-w-0 flex-1 truncate")}>{agentName(agent.agentId)}</span>
              {#if metric === "cost" && unpriced(agent.spend)}
                <span class={cn(text.meta, "shrink-0")}>{i18n.t("spend.noPrice")}</span>
                <span class={cn(text.body, "w-20 shrink-0 text-right tabular-nums text-muted-foreground")}>
                  {formatTokens(tokensOf(agent.spend))}
                </span>
              {:else}
                <span class={cn(text.meta, "shrink-0 tabular-nums")}>{sharePct(agent.share)}</span>
                <span class={cn(text.body, "w-20 shrink-0 text-right tabular-nums")}>
                  {measure(agent.spend)}
                </span>
              {/if}
              </button>
            </li>
          {/each}
        </ul>

        <!-- The models behind it (the table view). -->
        <div class="mt-5 border-t border-border/60 pt-4">
          <h3 class={cn(text.menuLabel, "mb-2")}>{i18n.t("spend.models")}</h3>
          <table class={cn("w-full", text.body)}>
            <thead>
              <tr class={cn(text.meta, "text-left")}>
                <th class="pb-1.5 font-normal">{i18n.t("spend.model")}</th>
                <th class="pb-1.5 text-right font-normal">{i18n.t("spend.tokens")}</th>
                <th class="pb-1.5 text-right font-normal">{i18n.t("spend.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {#each shownModels.slice(0, 12) as row (row.agentId + row.model)}
                <tr class="border-t border-border/40">
                  <td class="max-w-0 py-1.5 pr-3">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class={cn("size-2 shrink-0 rounded-xs", colour(row.agentId).swatch)}></span>
                      <span class="truncate" title={row.model}>{row.model}</span>
                    </span>
                  </td>
                  <td class="py-1.5 text-right tabular-nums text-muted-foreground">{formatTokens(tokensOf(row.spend))}</td>
                  <td class="py-1.5 text-right tabular-nums">
                    {#if unpriced(row.spend)}
                      <span class="text-muted-foreground">{i18n.t("spend.noPrice")}</span>
                    {:else}
                      {formatMoney(row.spend.costUsd)}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if shown.spend.estimatedCostUsd > 0}
            <p class={cn(text.meta, "mt-3")}>{i18n.t("spend.estimateNote")}</p>
          {/if}
        </div>
      {/if}
    {/if}
</SettingsSection>
