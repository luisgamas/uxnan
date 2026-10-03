<script lang="ts" module>
  /** Where a Cloudflare API token is created (the template is named in copy). */
  export const CLOUDFLARE_TOKENS_URL = "https://dash.cloudflare.com/profile/api-tokens";
</script>

<script lang="ts">
  // The Cloudflare API token field the relay's actions share (set up, update,
  // remove from Cloudflare): a password field, how to get a token, and — where
  // the action can keep it — "remember it in the system keychain", off by
  // default. The value is bound to the caller, which clears it right after its
  // call; this component keeps nothing.
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowUpRightIcon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
  import { openExternal } from "$lib/api";
  import { i18n } from "$lib/i18n";
  import { text } from "$lib/design";

  let {
    id,
    token = $bindable(""),
    remember = $bindable(false),
    showRemember = false,
    showHint = true,
    disabled = false,
  }: {
    /** Prefix for the field ids (several dialogs may hold one). */
    id: string;
    token?: string;
    remember?: boolean;
    /** Offer "remember the token" (setup and update; not remove). */
    showRemember?: boolean;
    /** Say where a token comes from, with a link (off when the caller's own
     *  steps already do). */
    showHint?: boolean;
    disabled?: boolean;
  } = $props();
</script>

<div class="flex flex-col gap-3">
  <div class="space-y-1.5">
    <Label for="{id}-token">{i18n.t("relay.apiToken")}</Label>
    <Input
      id="{id}-token"
      type="password"
      bind:value={token}
      autocomplete="off"
      spellcheck={false}
      {disabled}
    />
    {#if showHint}
      <div class="flex flex-wrap items-center gap-x-1.5">
        <p class={text.meta}>{i18n.t("relay.tokenHint")}</p>
        <Button
          variant="link"
          size="xs"
          class="h-auto px-0"
          onclick={() => void openExternal(CLOUDFLARE_TOKENS_URL).catch(() => {})}
        >
          {i18n.t("relay.openTokens")}
          <Icon icon={ArrowUpRightIcon} />
        </Button>
      </div>
    {/if}
  </div>
  {#if showRemember}
    <div class="flex items-start gap-2.5">
      <Checkbox id="{id}-remember" bind:checked={remember} {disabled} />
      <div class="min-w-0 space-y-0.5">
        <Label for="{id}-remember">{i18n.t("relay.remember")}</Label>
        <p class={text.meta}>{i18n.t("relay.rememberDesc")}</p>
      </div>
    </div>
  {/if}
</div>
