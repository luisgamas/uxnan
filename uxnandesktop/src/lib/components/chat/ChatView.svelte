<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Textarea } from '$lib/components/ui/textarea';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { openExternal } from '$lib/api';
  import { i18n } from '$lib/i18n';
  import { chat, text } from '$lib/design';
  import { cn } from '$lib/utils';
  import { Icon } from '$lib/components/ui/icon';
  import ViewIcon from '@hugeicons/core-free-icons/BrowserIcon';
  import MaximizeIcon from '@hugeicons/core-free-icons/Maximize01Icon';
  import RefreshIcon from '@hugeicons/core-free-icons/RefreshIcon';
  import { useChat } from '$lib/bridge/chat.svelte';
  import { useViewComposer } from './viewComposer.svelte';
  import {
    cachedView, claimViewFrame, clampViewHeight, createViewHost, formatViewAnnotations,
    releaseViewFrame, stageView,
    VIEW_HOST_METHODS, VIEW_MAX_HEIGHT, VIEW_MIN_HEIGHT, VIEW_THEME_VARIABLES,
    type ViewAnnotation, type ViewHostContext,
  } from '$lib/bridge/views';

  let { block }: { block: Record<string, unknown> } = $props();
  const chatStore = useChat();
  const insertIntoComposer = useViewComposer();
  const viewId = $derived(typeof block.viewId === 'string' && /^[0-9a-f]{32}$/.test(block.viewId) ? block.viewId : '');
  const title = $derived(typeof block.title === 'string' ? block.title.slice(0, 120) : i18n.t('chat.agentView'));
  let height = $state(untrack(() => typeof block.height === 'number' ? clampViewHeight(block.height) : 320));
  let url = $state('');
  let error = $state('');
  let loading = $state(false);
  let near = $state(false);
  let frameLive = $state(false);
  let expanded = $state(false);
  let annotating = $state(false);
  let pendingAnnotation = $state<ViewAnnotation | null>(null);
  let note = $state('');
  let frame = $state<HTMLIFrameElement | null>(null);
  let card = $state<HTMLElement | null>(null);
  /** A link the page asked to open, waiting on the person's answer. */
  let pendingLink = $state<{ url: string; answer: (open: boolean) => void } | null>(null);
  let linkOpen = $state(false);
  let sentTheme = '';
  const frameSlot = Symbol('agent-view-frame');

  const themeContext = (displayMode: 'inline' | 'fullscreen'): ViewHostContext => {
    const style = getComputedStyle(document.documentElement);
    const themeVariables: Record<string, string> = {
      '--color-background-primary': style.getPropertyValue('--background').trim(),
      '--color-background-secondary': style.getPropertyValue('--muted').trim(),
      '--color-text-primary': style.getPropertyValue('--foreground').trim(),
      '--color-text-secondary': style.getPropertyValue('--muted-foreground').trim(),
      '--color-border-primary': style.getPropertyValue('--border').trim(),
      '--color-ring-primary': style.getPropertyValue('--ring').trim(),
      '--color-background-info': style.getPropertyValue('--primary').trim(),
      '--color-background-danger': style.getPropertyValue('--destructive').trim(),
      '--color-background-success': style.getPropertyValue('--chart-2').trim(),
      '--color-background-warning': style.getPropertyValue('--chart-4').trim(),
      '--font-sans': style.getPropertyValue('--font-sans').trim(),
      '--font-mono': style.getPropertyValue('--ux-font-mono').trim(),
      '--border-radius-sm': style.getPropertyValue('--radius-sm').trim(),
      '--border-radius-md': style.getPropertyValue('--radius-md').trim(),
      '--border-radius-lg': style.getPropertyValue('--radius-lg').trim(),
    };
    const variables = Object.fromEntries(VIEW_THEME_VARIABLES.flatMap((key) => themeVariables[key] ? [[key, themeVariables[key]]] : []));
    return { theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', styles: { variables }, displayMode, platform: 'desktop', locale: i18n.locale };
  };
  const host = createViewHost({
    context: () => themeContext(expanded ? 'fullscreen' : 'inline'),
    send: (message) => frame?.contentWindow?.postMessage(message, '*'),
    onHeight: (measured) => { height = Math.max(VIEW_MIN_HEIGHT, Math.min(VIEW_MAX_HEIGHT, measured)); },
    onMessage: (message) => insertIntoComposer?.(message),
    onAnnotation: (annotation) => { if (annotating) { pendingAnnotation = annotation; note = ''; } },
    openLink: async (href) => {
      pendingLink?.answer(false);
      const open = await new Promise<boolean>((answer) => { pendingLink = { url: href, answer }; linkOpen = true; });
      if (!open) return false;
      await openExternal(href);
      return true;
    },
  });

  async function load() {
    if (!near || loading || url || !viewId) return;
    loading = true;
    error = '';
    try {
      const data = await cachedView(viewId, (method, params) => chatStore.client.call(method, params));
      url = await stageView(viewId, data.html);
      claimFrame();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Unable to load this view.';
    } finally { loading = false; }
  }
  function claimFrame() {
    if (!near || !url) return;
    frameLive = true;
    claimViewFrame(frameSlot, () => { frameLive = false; });
  }
  function receive(event: MessageEvent) {
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
    void host.receive(event.data);
  }
  function frameReady(mode: 'inline' | 'fullscreen') {
    sentTheme = JSON.stringify(themeContext(mode));
    host.send(VIEW_HOST_METHODS.annotate, { on: annotating });
  }
  function setAnnotating(next: boolean) {
    annotating = next;
    pendingAnnotation = null;
    host.send(VIEW_HOST_METHODS.annotate, { on: next });
  }
  function openExpanded() {
    expanded = true;
    claimFrame();
  }
  function addAnnotation() {
    if (!pendingAnnotation) return;
    // Straight to the composer, where the person sees it and decides to send.
    insertIntoComposer?.(formatViewAnnotations(title, [{ annotation: pendingAnnotation, note: note.slice(0, 1000) }]));
    pendingAnnotation = null;
    note = '';
  }

  onMount(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { near = true; void load(); claimFrame(); }
      else if (!expanded) { near = false; frameLive = false; releaseViewFrame(frameSlot); }
    }, { rootMargin: '240px' });
    if (card) observer.observe(card);
    window.addEventListener('message', receive);
    const themeObserver = new MutationObserver(() => {
      const mode = expanded ? 'fullscreen' : 'inline';
      const context = themeContext(mode);
      const value = JSON.stringify(context);
      if (sentTheme && value !== sentTheme) host.send(VIEW_HOST_METHODS.hostContextChanged, { ...context });
      sentTheme = value;
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => { observer.disconnect(); themeObserver.disconnect(); window.removeEventListener('message', receive); releaseViewFrame(frameSlot); pendingLink?.answer(false); };
  });

  // `allow-scripts` alone: an opaque origin, which cannot reach the app or its
  // IPC (docs/agent-views.md → Isolation).
  const frameAttributes = { sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', loading: 'lazy' } as const;
</script>

<article bind:this={card} data-view-id={viewId} class={cn(chat.card, 'my-2 overflow-hidden p-0')} aria-label={`Agent view: ${title}`}>
  <header class="flex min-h-10 items-center gap-2 border-b border-border/60 px-3 py-1.5">
    <Icon icon={ViewIcon} class="size-4 shrink-0 text-muted-foreground" />
    <h3 class="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</h3>
    <Button variant={annotating ? 'secondary' : 'ghost'} size="sm" class="h-7 px-2 text-xs" aria-pressed={annotating} onclick={() => setAnnotating(!annotating)}>{i18n.t('chat.viewAnnotate')}</Button>
    <Button variant="ghost" size="icon-xs" aria-label={i18n.t('chat.viewExpand')} title={i18n.t('chat.viewExpand')} onclick={openExpanded}><Icon icon={MaximizeIcon} class="size-3.5" /></Button>
  </header>
  {#if error}
    <div class="flex min-h-20 items-center justify-between gap-3 px-3 py-4">
      <p class={cn(text.meta, 'min-w-0')}>{error}</p>
      <Button variant="outline" size="sm" onclick={() => { url = ''; void load(); }}><Icon icon={RefreshIcon} class="size-3.5" /> {i18n.t('chat.viewRetry')}</Button>
    </div>
  {:else if !near || loading}
    <div class="flex items-center justify-center bg-muted/30 text-xs text-muted-foreground" style={`height:${height}px`} aria-live="polite">{loading ? i18n.t('chat.viewLoading') : i18n.t('chat.viewWaiting')}</div>
  {:else if url && frameLive && !expanded}
    <iframe bind:this={frame} title={title} src={url} sandbox={frameAttributes.sandbox} referrerpolicy={frameAttributes.referrerpolicy} loading={frameAttributes.loading} class="block w-full border-0 bg-background" style={`height:${height}px`} onload={() => frameReady('inline')}></iframe>
  {:else if url && !expanded}
    <div class="flex items-center justify-center bg-muted/30 text-xs text-muted-foreground" style={`height:${height}px`}>{i18n.t('chat.viewPaused')}</div>
  {/if}
  {#if pendingAnnotation}
    <div class="border-t border-border/60 bg-muted/30 p-3">
      <p class="mb-2 truncate text-xs text-muted-foreground">{pendingAnnotation.selector}</p>
      <Textarea bind:value={note} maxlength={1000} rows={2} aria-label={i18n.t('chat.viewAnnotationLabel')} placeholder={i18n.t('chat.viewAnnotationPlaceholder')} />
      <div class="mt-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onclick={() => pendingAnnotation = null}>{i18n.t('common.cancel')}</Button><Button size="sm" onclick={addAnnotation}>{i18n.t('chat.viewAddAnnotation')}</Button></div>
    </div>
  {/if}
</article>

<Dialog.Root bind:open={expanded} onOpenChange={(open) => { expanded = open; }}>
  <Dialog.Content size="large" class="flex h-[min(90vh,900px)] flex-col overflow-hidden" showCloseButton>
    <Dialog.Header><Dialog.Title class="truncate">{title}</Dialog.Title></Dialog.Header>
    {#if url && frameLive}<iframe bind:this={frame} title={title} src={url} sandbox={frameAttributes.sandbox} referrerpolicy="no-referrer" loading="lazy" class="min-h-0 w-full flex-1 border-0 bg-background" onload={() => frameReady('fullscreen')}></iframe>{:else if url}<div class="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">{i18n.t('chat.viewPaused')}</div>{/if}
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={linkOpen}
  ondismiss={() => { pendingLink?.answer(false); pendingLink = null; }}
  title={i18n.t('chat.viewOpenLinkTitle')}
  description={pendingLink?.url ?? ''}
  confirmLabel={i18n.t('chat.viewOpenLinkConfirm')}
  onconfirm={() => { pendingLink?.answer(true); pendingLink = null; }}
/>
