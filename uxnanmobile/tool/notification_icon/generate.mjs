// Regenerates the Android status-bar (small) push notification icon,
// `ic_stat_uxnan.png`, at every density from `ic_stat_uxnan.svg`.
//
//   cd uxnanmobile/tool/notification_icon
//   npm i @resvg/resvg-js sharp   # one-off; not part of the Flutter app deps
//   node generate.mjs
//
// Pipeline: render the SVG at 4x the target size (supersample for clean
// anti-aliasing), downscale with Lanczos, then flatten RGB to pure white so
// only the alpha channel carries the silhouette (all Android uses for a small
// icon). Writes straight into android/app/src/main/res/drawable-<dpi>/.
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(resolve(here, 'ic_stat_uxnan.svg'), 'utf8');
const resDir = resolve(here, '../../android/app/src/main/res');

// Android status-bar small-icon sizes, in px, per density bucket.
const sizes = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };

async function forceWhite(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}

for (const [dpi, px] of Object.entries(sizes)) {
  const big = new Resvg(svg, { fitTo: { mode: 'width', value: px * 4 } })
    .render()
    .asPng();
  const scaled = await sharp(big)
    .resize(px, px, { fit: 'contain', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const out = resolve(resDir, `drawable-${dpi}`, 'ic_stat_uxnan.png');
  writeFileSync(out, await forceWhite(scaled));
  console.log(`wrote drawable-${dpi}/ic_stat_uxnan.png (${px}x${px})`);
}
