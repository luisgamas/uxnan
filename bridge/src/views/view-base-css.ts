/**
 * The stylesheet the bridge puts in every view, before anything the agent
 * wrote: it makes a page that styles nothing look like part of the app, and
 * gives every page the same status colors and data palette on every client.
 *
 * - Every variable a page may use (`VIEW_THEME_VARIABLES` and
 *   `VIEW_PAGE_VARIABLES` in `@uxnan/shared`) has a light and a dark value
 *   here, so a page drawn with no host at all — `view_check`'s render — still
 *   looks right. A host overrides the ones its theme owns as inline styles on
 *   `:root`, which win over these.
 * - Dark applies when the bootstrap marks `:root` with
 *   `data-uxnan-theme="dark"` (the host's theme), or before any host answered,
 *   when the system prefers dark.
 * - Every rule, the variables included, sits in `:where()` (specificity
 *   zero) and the later dark rules win by order: any rule the agent writes
 *   wins over all of them.
 * - The categorical palette is checked for color-vision deficiency in this
 *   order (adjacent pairs, light on white and dark on #171717); slots 3-5 are
 *   under 3:1 on light, so charts always label their values or show a legend.
 */

type Palette = Record<string, string>;

const LIGHT: Palette = {
  'color-scheme': 'light',
  '--color-background-primary': '#ffffff',
  '--color-background-secondary': '#f5f5f4',
  '--color-text-primary': '#171717',
  '--color-text-secondary': '#5f5e5a',
  '--color-border-primary': '#e5e4df',
  '--color-ring-primary': '#2a78d6',
  '--color-background-info': '#e8f1fc',
  '--color-background-success': '#e7f4e7',
  '--color-background-warning': '#fdf3dc',
  '--color-background-danger': '#fbe9e9',
  '--color-text-info': '#1c5cab',
  '--color-text-success': '#006300',
  '--color-text-warning': '#8a5a00',
  '--color-text-danger': '#c62828',
  '--color-chart-1': '#2a78d6',
  '--color-chart-2': '#eb6834',
  '--color-chart-3': '#1baf7a',
  '--color-chart-4': '#eda100',
  '--color-chart-5': '#e87ba4',
  '--color-chart-6': '#008300',
};

const DARK: Palette = {
  'color-scheme': 'dark',
  '--color-background-primary': '#171717',
  '--color-background-secondary': '#232322',
  '--color-text-primary': '#f0efec',
  '--color-text-secondary': '#a9a8a1',
  '--color-border-primary': '#2f2f2d',
  '--color-ring-primary': '#3987e5',
  '--color-background-info': '#16263b',
  '--color-background-success': '#13291a',
  '--color-background-warning': '#2e2410',
  '--color-background-danger': '#3a1a1a',
  '--color-text-info': '#6da7ec',
  '--color-text-success': '#3fbf5a',
  '--color-text-warning': '#f2b53a',
  '--color-text-danger': '#f07070',
  '--color-chart-1': '#3987e5',
  '--color-chart-2': '#d95926',
  '--color-chart-3': '#199e70',
  '--color-chart-4': '#c98500',
  '--color-chart-5': '#d55181',
  '--color-chart-6': '#008300',
};

/** Defined from the page's own text and surface, so they follow whatever
 *  colors the host sends: a mark that is not the point, and a hairline. */
const DERIVED: Palette = {
  '--color-chart-muted':
    'color-mix(in srgb, var(--color-text-primary) 22%, var(--color-background-primary))',
  '--color-chart-grid':
    'color-mix(in srgb, var(--color-text-primary) 10%, var(--color-background-primary))',
  '--font-sans': 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  '--font-mono': 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  '--border-radius-sm': '6px',
  '--border-radius-md': '10px',
  '--border-radius-lg': '14px',
};

const declarations = (palette: Palette): string =>
  Object.entries(palette)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');

const TONES = ['info', 'success', 'warning', 'danger'] as const;

const ELEMENTS = [
  ':where(*,*::before,*::after){box-sizing:border-box}',
  ':where(html){background:var(--color-background-primary);color:var(--color-text-primary);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased}',
  ':where(body){margin:0;padding:16px}',
  ':where(h1,h2,h3,h4){margin:0 0 8px;line-height:1.3;font-weight:600}',
  ':where(h1){font-size:18px}:where(h2){font-size:16px}:where(h3){font-size:14px}:where(h4){font-size:13px}',
  ':where(p,ul,ol){margin:0 0 8px}',
  ':where(ul,ol){padding-left:20px}',
  ':where(small,.muted){color:var(--color-text-secondary)}',
  ':where(a){color:var(--color-text-info)}',
  ':where(code,kbd,samp,pre){font-family:var(--font-mono);font-size:.92em}',
  ':where(pre){margin:0 0 8px;padding:10px 12px;background:var(--color-background-secondary);border-radius:var(--border-radius-sm);overflow:auto}',
  ':where(hr){border:0;border-top:1px solid var(--color-border-primary);margin:12px 0}',
  ':where(img,canvas,video){max-width:100%}:where(img){height:auto}',
  ':where(table){width:100%;border-collapse:collapse;font-size:13px}',
  ':where(th){text-align:left;font-weight:600;font-size:12px;color:var(--color-text-secondary);padding:6px 10px;border-bottom:1px solid var(--color-border-primary)}',
  ':where(td){padding:7px 10px;border-bottom:1px solid var(--color-chart-grid)}',
  ':where(tr:last-child>td){border-bottom:0}',
  ':where(.num){text-align:right;font-variant-numeric:tabular-nums}',
  ':where(button,input,select,textarea){font:inherit;color:inherit}',
  ':where(button){padding:5px 12px;border:1px solid var(--color-border-primary);border-radius:var(--border-radius-sm);background:var(--color-background-secondary);cursor:pointer}',
  ':where(input,select,textarea){padding:5px 8px;border:1px solid var(--color-border-primary);border-radius:var(--border-radius-sm);background:var(--color-background-primary)}',
  ':where(:focus-visible){outline:2px solid var(--color-ring-primary);outline-offset:2px}',
  ':where(.tag){display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--color-background-secondary);color:var(--color-text-secondary)}',
  ...TONES.map(
    (tone) =>
      `:where(.tag[data-tone=${tone}]){background:var(--color-background-${tone});color:var(--color-text-${tone})}`,
  ),
];

export const VIEW_BASE_CSS = [
  `:where(:root){${declarations(LIGHT)};${declarations(DERIVED)}}`,
  `:where(:root[data-uxnan-theme=dark]){${declarations(DARK)}}`,
  `@media (prefers-color-scheme:dark){:where(:root:not([data-uxnan-theme])){${declarations(DARK)}}}`,
  ...ELEMENTS,
].join('\n');

/** The variables this stylesheet defines, for tests and `view_check`. */
export const VIEW_BASE_VARIABLES: readonly string[] = [
  ...Object.keys(LIGHT),
  ...Object.keys(DERIVED),
].filter((key) => key.startsWith('--'));
