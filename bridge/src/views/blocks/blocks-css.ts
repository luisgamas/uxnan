/**
 * The one stylesheet every block view shares. It reads only the host's theme
 * variables (`--color-*`, `--font-*`, `--border-radius-*`), so charts follow
 * light and dark on their own, and it never writes a literal colour: tints are
 * `color-mix` of a variable. Selectors are single `ux-` classes so the page's
 * own styles stay in charge of everything else.
 *
 * The look is the Uxnan desktop's: grayscale by default, colour only on data
 * marks and on small status glyphs, and blocks separated by hairlines rather
 * than by boxes with edge accents. No box shadows except the floating tooltip,
 * no gradients, no uppercase.
 */
export const VIEW_BLOCKS_CSS = String.raw`
.ux-blocks{display:flex;flex-direction:column;gap:20px;min-width:0;color:var(--color-text-primary)}
.ux-blocks *{box-sizing:border-box}
.ux-block{min-width:0}
.ux-title{margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:.01em;color:var(--color-text-primary);overflow-wrap:anywhere}

.ux-text p{margin:0 0 6px;font-size:13.5px;line-height:1.55;color:var(--color-text-primary);overflow-wrap:anywhere}
.ux-text p:last-child{margin-bottom:0}
.ux-text code{font-family:var(--font-mono);font-size:12.5px;background:var(--color-background-secondary);padding:1px 5px;border-radius:var(--border-radius-sm)}

.ux-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));overflow:hidden;border:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent);border-radius:var(--border-radius-md)}
.ux-stat{min-width:0;padding:10px 12px;margin:-1px 0 0 -1px;border-left:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent);border-top:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent)}
.ux-stat-label{font-size:12px;line-height:1.4;color:var(--color-text-secondary);overflow-wrap:anywhere}
.ux-stat-dot{display:inline-block;flex:none;width:6px;height:6px;margin-right:6px;border-radius:50%;background:var(--color-chart-1);vertical-align:1px}
.ux-stat-value{margin-top:2px;font-size:20px;font-weight:600;line-height:1.2;letter-spacing:-.01em;color:var(--color-text-primary);font-variant-numeric:proportional-nums;overflow-wrap:anywhere}
.ux-stat-detail{margin-top:4px;font-size:12px;line-height:1.4;color:var(--color-text-secondary);overflow-wrap:anywhere}
.ux-trend{display:inline-block;margin-right:4px;font-size:10px;line-height:1;vertical-align:1px}

.ux-c-success{color:var(--color-text-success)}
.ux-c-warning{color:var(--color-text-warning)}
.ux-c-danger{color:var(--color-text-danger)}
.ux-c-accent{color:var(--color-chart-1)}
.ux-c-muted{color:var(--color-text-secondary)}

.ux-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 8px;font-size:12px;line-height:1.4;color:var(--color-text-secondary)}
.ux-legend-item{display:inline-flex;align-items:center;gap:6px}
.ux-swatch{display:inline-block;flex:none;width:10px;height:10px;border-radius:3px}
.ux-swatch-line{display:inline-block;flex:none;width:10px;height:3px;border-radius:2px}
.ux-bg-accent{background:var(--color-chart-1)}
.ux-bg-base{background:color-mix(in srgb, var(--color-chart-muted) 55%, transparent)}

.ux-bars{display:grid;grid-template-columns:fit-content(40%) minmax(40px,1fr) max-content;row-gap:8px;column-gap:10px;align-items:center}
.ux-bar-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--color-text-primary)}
.ux-bar-track{position:relative;min-width:0;height:12px}
.ux-bar-track-base{height:20px}
.ux-zero{position:absolute;top:-2px;bottom:-2px;width:1px;background:var(--color-chart-grid)}
.ux-bar{position:absolute;top:0;height:12px}
.ux-bar-base{height:5px;background:color-mix(in srgb, var(--color-chart-muted) 55%, transparent)}
.ux-bar-track-base .ux-bar-main{top:8px}
.ux-bar-accent{background:var(--color-chart-1)}
.ux-bar-muted{background:var(--color-chart-muted)}
.ux-bar-value{font-size:12px;color:var(--color-text-secondary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.ux-delta{margin-left:6px}

.ux-line-grid{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:8px}
.ux-unit{grid-row:1;grid-column:1;margin-bottom:6px;font-size:11px;color:var(--color-text-secondary)}
.ux-yaxis{position:relative;grid-row:2;grid-column:1;width:max-content;height:200px;font-size:11px;color:var(--color-text-secondary);font-variant-numeric:tabular-nums}
.ux-ysizer{display:block;height:0;overflow:hidden;visibility:hidden;white-space:nowrap}
.ux-ytick{position:absolute;right:0;top:0;line-height:1;white-space:nowrap;transform:translateY(-50%)}
.ux-plot{position:relative;grid-row:2;grid-column:2;height:200px;min-width:0;touch-action:pan-y}
.ux-plot svg{display:block;width:100%;height:200px;overflow:visible}
.ux-grid-line{fill:none;stroke:var(--color-chart-grid);stroke-width:1;vector-effect:non-scaling-stroke}
.ux-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.ux-area{stroke:none;fill-opacity:.1}
.ux-dot{position:absolute;box-sizing:content-box;width:8px;height:8px;border-radius:50%;border:2px solid var(--color-background-primary);transform:translate(-50%,-50%)}
.ux-xaxis{grid-row:3;grid-column:2;position:relative;height:16px;margin-top:6px;font-size:11px;color:var(--color-text-secondary)}
.ux-xl{position:absolute;top:0;white-space:nowrap;transform:translateX(-50%)}
.ux-xl-first{transform:none}
.ux-xl-last{transform:translateX(-100%)}
.ux-hover{position:absolute;top:0;right:0;bottom:0;left:0;pointer-events:none}
.ux-cross{position:absolute;top:0;bottom:0;width:1px;background:var(--color-text-secondary)}
.ux-hdot{position:absolute;box-sizing:content-box;width:8px;height:8px;border-radius:50%;border:2px solid var(--color-background-primary);transform:translate(-50%,-50%)}

.ux-stack{display:flex;gap:2px;height:10px;border-radius:var(--border-radius-sm);overflow:hidden}
.ux-seg{display:block;min-width:0}
.ux-breakdown-list{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.ux-breakdown-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;column-gap:8px;font-size:13px;line-height:1.4}
.ux-breakdown-label{min-width:0;color:var(--color-text-primary);overflow-wrap:anywhere}
.ux-breakdown-value{text-align:right;white-space:nowrap;font-size:12px;color:var(--color-text-secondary);font-variant-numeric:tabular-nums}
.ux-breakdown-pct{min-width:40px;text-align:right;white-space:nowrap;font-size:12px;color:var(--color-text-secondary);font-variant-numeric:tabular-nums}

.ux-table-wrap{min-width:0;overflow-x:auto}
.ux-table{width:100%;border-collapse:collapse;font-size:13px;color:var(--color-text-primary)}
.ux-table th{padding:6px 10px;border-bottom:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent);font-size:12px;font-weight:500;text-align:left;color:var(--color-text-secondary);white-space:nowrap}
.ux-table td{padding:7px 10px;border-bottom:1px solid var(--color-chart-grid);vertical-align:top;overflow-wrap:anywhere}
.ux-table tr:last-child td{border-bottom:0}
.ux-table .ux-num{text-align:right;font-variant-numeric:tabular-nums}
.ux-table .ux-na{color:var(--color-text-secondary)}
.ux-hl td{background:color-mix(in srgb, var(--color-text-primary) 5%, transparent);font-weight:600}

.ux-list{margin:0;padding-left:20px;font-size:13px;color:var(--color-text-primary)}
.ux-list li{margin:0 0 6px}
.ux-list li:last-child{margin-bottom:0}
.ux-item-detail{display:block;margin-top:1px;font-size:12px;line-height:1.4;color:var(--color-text-secondary);overflow-wrap:anywhere}
.ux-steps,.ux-checks{list-style:none;margin:0;padding:0;font-size:13px}
.ux-step{position:relative;min-width:0;padding:0 0 12px 28px}
.ux-step:last-child{padding-bottom:0}
.ux-checks .ux-step{padding-bottom:8px}
.ux-checks .ux-step:last-child{padding-bottom:0}
.ux-step-title{font-size:13px;font-weight:500;line-height:1.4;color:var(--color-text-primary);overflow-wrap:anywhere}
.ux-step-detail{margin-top:1px;font-size:12px;line-height:1.4;color:var(--color-text-secondary);overflow-wrap:anywhere}
.ux-steps .ux-step:not(:last-child)::before{content:"";position:absolute;left:9px;top:22px;bottom:0;width:1px;background:var(--color-chart-grid)}
.ux-marker{position:absolute;top:0;left:0;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--color-background-primary);border:1.5px solid var(--color-chart-muted);color:var(--color-text-secondary)}
.ux-marker svg{width:10px;height:10px}
.ux-m-done{border-color:var(--color-text-success);color:var(--color-text-success)}
.ux-m-failed{border-color:var(--color-text-danger);color:var(--color-text-danger)}
.ux-m-current{border-color:var(--color-chart-1)}
.ux-m-current::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--color-chart-1)}

.ux-callout{display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:8px;align-items:start;padding:10px 12px;border:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent);border-radius:var(--border-radius-md);background:color-mix(in srgb, var(--color-background-secondary) 60%, transparent);color:var(--color-text-primary)}
.ux-glyph{display:block;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.ux-callout-icon{grid-column:1;grid-row:1;width:16px;height:16px;margin-top:2px}
.ux-callout-info .ux-callout-icon{color:var(--color-text-info)}
.ux-callout-success .ux-callout-icon{color:var(--color-text-success)}
.ux-callout-warning .ux-callout-icon{color:var(--color-text-warning)}
.ux-callout-danger .ux-callout-icon{color:var(--color-text-danger)}
.ux-callout-title{grid-column:2;font-size:13px;font-weight:600;line-height:20px;color:var(--color-text-primary);overflow-wrap:anywhere}
.ux-callout-text{grid-column:2;font-size:13px;line-height:1.5;color:var(--color-text-primary);white-space:pre-line;overflow-wrap:anywhere}

.ux-compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.ux-card{min-width:0;padding:12px;border:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent);border-radius:var(--border-radius-md);background:transparent}
.ux-card-hl{border-color:color-mix(in srgb, var(--color-text-primary) 28%, transparent)}
.ux-card-head{display:flex;align-items:center;gap:6px;min-width:0}
.ux-card-title{min-width:0;font-size:13px;font-weight:600;line-height:1.4;color:var(--color-text-primary);overflow-wrap:anywhere}
.ux-card-check{width:14px;height:14px;color:var(--color-chart-1)}
.ux-card-sub{margin-top:2px;font-size:12px;line-height:1.4;color:var(--color-text-secondary);overflow-wrap:anywhere}
.ux-points{margin:10px 0 0;padding:0}
.ux-point{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-top:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent)}
.ux-point:first-child{border-top:0}
.ux-point dt,.ux-point dd{margin:0;min-width:0;overflow-wrap:anywhere}
.ux-point dt{font-size:12px;color:var(--color-text-secondary)}
.ux-point dd{font-size:13px;text-align:right;color:var(--color-text-primary)}

.ux-choices-prompt{margin:0 0 8px;font-size:13px;color:var(--color-text-primary)}
.ux-choice-row{display:flex;flex-wrap:wrap;gap:8px}
.ux-choice{font:inherit;font-size:12.5px;font-weight:500;line-height:16px;display:inline-flex;align-items:center;min-height:28px;max-width:100%;padding:0 10px;border-radius:var(--border-radius-sm);border:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent);background:transparent;color:var(--color-text-primary);text-align:left;cursor:pointer;overflow-wrap:anywhere}
.ux-choice:hover{background:color-mix(in srgb, var(--color-text-primary) 5%, transparent)}
.ux-choice:focus-visible{outline:2px solid var(--color-ring-primary);outline-offset:1px}

.ux-tip{position:fixed;z-index:10;max-width:240px;padding:6px 8px;border:1px solid color-mix(in srgb, var(--color-border-primary) 70%, transparent);border-radius:var(--border-radius-sm);background:var(--color-background-primary);box-shadow:0 4px 16px color-mix(in srgb, var(--color-text-primary) 10%, transparent);font-size:12px;line-height:1.4;color:var(--color-text-primary);pointer-events:none}
.ux-tip[hidden]{display:none}
.ux-tip-title{margin-bottom:4px;font-weight:600}
.ux-tip-row{display:flex;align-items:center;gap:6px;white-space:nowrap}
.ux-tip-name{color:var(--color-text-secondary)}
.ux-tip-value{margin-left:auto;padding-left:12px;font-variant-numeric:tabular-nums}
.ux-tip-swatch{flex:none;width:8px;height:8px;border-radius:2px}
`;
