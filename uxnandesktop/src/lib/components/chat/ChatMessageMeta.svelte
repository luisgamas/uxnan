<script lang="ts">
  // Under a message, revealed while its row is hovered or focused: when it was
  // sent and a copy button. The row that holds it carries `group/message`.
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
  import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
  import { clipboardWrite } from "$lib/clipboard";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon } from "$lib/design";

  let {
    text,
    at,
    align = "start",
  }: {
    /** What the copy button copies; no button when empty. */
    text: string;
    /** When the message was sent (epoch ms). */
    at?: number;
    align?: "start" | "end";
  } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const time = $derived(
    at ? new Intl.DateTimeFormat(i18n.locale, { timeStyle: "short" }).format(new Date(at)) : "",
  );
  const full = $derived(
    at
      ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(at),
        )
      : "",
  );

  async function copy() {
    await clipboardWrite(text);
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1500);
  }

  $effect(() => () => clearTimeout(timer));
</script>

<div class={cn(chat.messageMeta, align === "end" && "justify-end")}>
  {#if time}<time title={full} class="tabular-nums">{time}</time>{/if}
  {#if text}
    <Button
      variant="ghost"
      size="icon-xs"
      class="size-5 text-muted-foreground/70 hover:text-foreground"
      aria-label={copied ? i18n.t("chat.copied") : i18n.t("chat.copy")}
      title={copied ? i18n.t("chat.copied") : i18n.t("chat.copy")}
      onclick={() => void copy()}
    >
      <Icon icon={copied ? Tick02Icon : Copy01Icon} class={icon.status} />
    </Button>
  {/if}
</div>
