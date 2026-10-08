/**
 * How a rendered view and the client hosting it talk.
 *
 * A subset of the open MCP Apps host protocol (JSON-RPC 2.0 messages between
 * a sandboxed page and its host), so a page written for it needs nothing
 * Uxnan-specific, plus two `uxnan/*` extensions for annotations. The bridge
 * injects one bootstrap into every prepared page; it speaks this protocol to
 * `window.parent.postMessage` on the desktop and to the {@link VIEW_CHANNEL}
 * JavaScript channel on the phone. Hosts accept a message only from the
 * frame/WebView they created, and only these methods.
 */

/** The JavaScript channel the phone's WebView exposes to the page: the page
 *  calls `UxnanView.postMessage(JSON.stringify(message))`. */
export const VIEW_CHANNEL = 'UxnanView';

/** The global function the bootstrap defines for a host that cannot
 *  `postMessage` into the page (the phone): the host runs
 *  `window.__uxnanHost(<message object>)`. The desktop posts to the frame's
 *  window instead, and the bootstrap accepts only its parent as the sender. */
export const VIEW_RECEIVE_FUNCTION = '__uxnanHost';

/** View → host. */
export const VIEW_METHODS = {
  /** Request: the page is ready; the host answers with {@link ViewHostContext}. */
  initialize: 'ui/initialize',
  /** Notification: the page applied the host context and is shown. */
  initialized: 'ui/notifications/initialized',
  /** Notification `{ width, height }`: the page's content size changed. */
  sizeChanged: 'ui/notifications/size-changed',
  /** Request `{ url }`: open a link; the host asks the person first. */
  openLink: 'ui/open-link',
  /** Request `{ role: 'user', content: [{ type: 'text', text }] }`: propose a
   *  message; the host puts it in the composer, the person decides to send. */
  message: 'ui/message',
  /** Notification {@link ViewAnnotation}: the person picked an element. */
  annotation: 'uxnan/annotation',
} as const;

/** Host → view. */
export const VIEW_HOST_METHODS = {
  /** Notification: a partial {@link ViewHostContext} (theme change). */
  hostContextChanged: 'ui/notifications/host-context-changed',
  /** Notification `{ on: boolean }`: enter or leave element-picking mode. */
  annotate: 'uxnan/annotate',
} as const;

/** The context a host gives the page: theme and where it is shown. */
export interface ViewHostContext {
  theme: 'light' | 'dark';
  /** CSS custom properties, applied to `:root` (see {@link VIEW_THEME_VARIABLES}). */
  styles?: { variables: Partial<Record<ViewThemeVariable, string>> };
  displayMode?: 'inline' | 'fullscreen';
  platform?: 'desktop' | 'mobile';
  locale?: string;
}

/** The theme variables a host passes — the open standard's names, so a page
 *  styled with them follows the app's colors and fonts. */
export const VIEW_THEME_VARIABLES = [
  '--color-background-primary',
  '--color-background-secondary',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-border-primary',
  '--color-ring-primary',
  '--color-background-info',
  '--color-background-danger',
  '--color-background-success',
  '--color-background-warning',
  '--font-sans',
  '--font-mono',
  '--border-radius-sm',
  '--border-radius-md',
  '--border-radius-lg',
] as const;
export type ViewThemeVariable = (typeof VIEW_THEME_VARIABLES)[number];

/** The bounds of what one annotation may carry, so a page cannot flood the
 *  composer: the bootstrap cuts to them, and hosts check them again. */
export const VIEW_ANNOTATION_LIMITS = {
  selector: 300,
  text: 500,
  html: 1000,
} as const;

/** An element the person picked in a view, as the bootstrap describes it. */
export interface ViewAnnotation {
  /** A CSS selector that finds the element in the page. */
  selector: string;
  /** Its tag, lowercase. */
  tag: string;
  /** Its visible text, trimmed and cut. */
  text?: string;
  /** Its opening markup and start of content, cut. */
  html?: string;
  /** Where it sits in the page, CSS pixels. */
  rect: { x: number; y: number; width: number; height: number };
}

/** Whether a value is a well-formed {@link ViewAnnotation} within limits. */
export function isViewAnnotation(value: unknown): value is ViewAnnotation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const rect = v['rect'] as Record<string, unknown> | undefined;
  const within = (key: string, max: number, required: boolean): boolean => {
    const field = v[key];
    if (field === undefined) return !required;
    return typeof field === 'string' && field.length <= max && (!required || field.length > 0);
  };
  return (
    within('selector', VIEW_ANNOTATION_LIMITS.selector, true) &&
    typeof v['tag'] === 'string' &&
    /^[a-z][a-z0-9-]{0,40}$/.test(v['tag']) &&
    within('text', VIEW_ANNOTATION_LIMITS.text, false) &&
    within('html', VIEW_ANNOTATION_LIMITS.html, false) &&
    !!rect &&
    ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(rect[k]))
  );
}

/**
 * The composer text for annotations the person is about to send: one entry
 * per picked element with their note, readable by any agent. Desktop and
 * phone build it the same way (the phone mirrors this function in Dart).
 */
export function formatViewAnnotations(
  viewTitle: string,
  notes: { annotation: ViewAnnotation; note: string }[],
): string {
  const lines = [`On the view "${viewTitle}":`];
  notes.forEach(({ annotation, note }, index) => {
    lines.push('', `${index + 1}. \`${annotation.selector}\` (<${annotation.tag}>)`);
    if (annotation.text) lines.push(`   Text: ${annotation.text.replace(/\s+/g, ' ')}`);
    if (note.trim()) lines.push(`   Note: ${note.trim()}`);
  });
  return lines.join('\n');
}
