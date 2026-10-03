<script lang="ts">
  // "Set up your relay": the bridge deploys the relay Worker into the user's
  // own Cloudflare account (`relay/setup`). This dialog only gathers what the
  // bridge needs — the account id and an API token made from the "Edit
  // Cloudflare Workers" template — and shows the bridge's answer as it is. It
  // never talks to Cloudflare.
  //
  // The token lives in this component only while the call is in flight: the
  // field is cleared the moment the bridge answers, success or failure, and
  // whenever the dialog closes. It is never logged.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowUpRightIcon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
  import RelayTokenField, { CLOUDFLARE_TOKENS_URL } from "$lib/components/RelayTokenField.svelte";
  import { relay } from "$lib/bridge/relay.svelte";
  import { bridgeErrorText } from "$lib/bridge/client.svelte";
  import { openExternal } from "$lib/api";
  import { toast } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let accountId = $state("");
  let apiToken = $state("");
  let remember = $state(false);
  let deploying = $state(false);
  let error = $state<string | null>(null);

  const canDeploy = $derived(accountId.trim() !== "" && apiToken.trim() !== "" && !deploying);

  // Closing forgets the token (and a stale error); the account id is not a
  // secret and is kept for a second try.
  $effect(() => {
    if (!open) {
      apiToken = "";
      error = null;
    }
  });

  async function deploy(): Promise<void> {
    if (!canDeploy) return;
    deploying = true;
    error = null;
    const token = apiToken;
    try {
      await relay.setup(accountId.trim(), token, remember);
      open = false;
      toast.success(i18n.t("relay.setupOk"));
    } catch (err) {
      error = bridgeErrorText(err);
    } finally {
      apiToken = "";
      deploying = false;
    }
  }

  const STEPS = ["relay.setupStepToken", "relay.setupStepAccount", "relay.setupStepPaste"] as const;
</script>

<Dialog.Root bind:open>
  <Dialog.Content size="form">
    <Dialog.Header>
      <Dialog.Title class={text.title}>{i18n.t("relay.setupTitle")}</Dialog.Title>
      <Dialog.Description class={text.body}>{i18n.t("relay.setupDesc")}</Dialog.Description>
    </Dialog.Header>

    <Dialog.Body class="flex flex-col gap-5 py-0">
      <ol class="flex flex-col gap-2.5">
        {#each STEPS as step, index (step)}
          <li class="flex items-start gap-2.5">
            <span
              class="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums text-muted-foreground"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div class="flex min-w-0 flex-col items-start gap-1">
              <p class={cn(text.body, "leading-5")}>{i18n.t(step)}</p>
              {#if index === 0}
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => void openExternal(CLOUDFLARE_TOKENS_URL).catch(() => {})}
                >
                  {i18n.t("relay.openTokens")}
                  <Icon icon={ArrowUpRightIcon} data-icon="inline-end" />
                </Button>
              {/if}
            </div>
          </li>
        {/each}
      </ol>

      <div class="flex flex-col gap-3">
        <div class="space-y-1.5">
          <Label for="relay-setup-account">{i18n.t("relay.accountId")}</Label>
          <Input
            id="relay-setup-account"
            class="font-mono"
            bind:value={accountId}
            autocomplete="off"
            spellcheck={false}
            disabled={deploying}
          />
        </div>
        <RelayTokenField
          id="relay-setup"
          bind:token={apiToken}
          bind:remember
          showRemember
          showHint={false}
          disabled={deploying}
        />
      </div>

      {#if error}
        <p
          role="alert"
          class={cn(
            "break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive",
            text.body,
          )}
        >
          {error}
        </p>
      {:else if deploying}
        <p class={cn(text.meta, "flex items-center gap-2")} role="status">
          <Spinner aria-hidden="true" class="size-3.5" />
          {i18n.t("relay.deployingHint")}
        </p>
      {/if}
    </Dialog.Body>

    <Dialog.Footer>
      <Button variant="ghost" disabled={deploying} onclick={() => (open = false)}>
        {i18n.t("common.cancel")}
      </Button>
      <Button disabled={!canDeploy} onclick={() => void deploy()}>
        {#if deploying}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
          {i18n.t("relay.deploying")}
        {:else}
          {i18n.t("relay.deploy")}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
