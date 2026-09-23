<script lang="ts">
  // What an agent is waiting for the person to approve in this workspace's
  // browser page (`src-tauri/src/browser/approval.rs`). It sits between the
  // toolbar and the page — never over the page, so the element the agent
  // named stays visible with its highlight — and answers with
  // `browser_approval_answer`. The agent's call waits for the answer (45 s at
  // most, then it is refused).

  import { browserApprovalAnswer, type BrowserApproval } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import ShieldIcon from "@hugeicons/core-free-icons/SecurityCheckIcon";

  let { approval }: { approval: BrowserApproval } = $props();

  let busy = $state(false);

  const ACTIONS: Record<BrowserApproval["action"], MessageKey> = {
    read: "browser.approvalRead",
    screenshot: "browser.approvalScreenshot",
    console: "browser.approvalConsole",
    click: "browser.approvalClick",
    type: "browser.approvalType",
    press: "browser.approvalPress",
    scroll: "browser.approvalScroll",
  };

  const what = $derived(
    i18n.t(ACTIONS[approval.action], {
      agent: approval.agent,
      target: approval.target ?? "",
      host: approval.host,
    }),
  );

  function answer(choice: "once" | "site" | "deny"): void {
    busy = true;
    void browserApprovalAnswer(approval.id, choice).finally(() => (busy = false));
  }
</script>

<div
  role="alertdialog"
  aria-live="assertive"
  aria-label={i18n.t("browser.approvalTitle")}
  class="flex shrink-0 flex-col gap-1.5 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2"
>
  <div class="flex min-w-0 items-start gap-2">
    <Icon icon={ShieldIcon} class={cn(icon.decorative, "mt-0.5 shrink-0 text-amber-600 dark:text-amber-400")} />
    <div class="min-w-0 flex-1">
      <p class={cn(text.body, "break-words")}>{what}</p>
      <p class={cn(text.meta, "break-words")}>
        {#if approval.risk === "high"}
          <span class="font-medium text-amber-700 dark:text-amber-300">{i18n.t("browser.approvalHigh")}</span>
          ·
        {/if}
        {#if approval.detail}{approval.detail} · {/if}<span class="font-mono">{approval.host}</span>
      </p>
    </div>
  </div>
  <div class="flex flex-wrap items-center justify-end gap-1.5">
    <Button variant="ghost" size="sm" class={text.body} disabled={busy} onclick={() => answer("deny")}>
      {i18n.t("browser.approvalDeny")}
    </Button>
    {#if approval.scope === "site"}
      <Button variant="outline" size="sm" class={text.body} disabled={busy} onclick={() => answer("site")}>
        {i18n.t("browser.approvalSite", { host: approval.host })}
      </Button>
    {/if}
    <Button variant="default" size="sm" class={text.body} disabled={busy} onclick={() => answer("once")}>
      {i18n.t("browser.approvalOnce")}
    </Button>
  </div>
</div>
