# Push notification icon (`ic_stat_uxnan`)

The **status-bar (small) icon** Android shows for every push notification. It is
a **white silhouette of the Uxnan brand mark on a transparent background** — the
platform discards a small icon's colours and keeps only its **alpha channel**, so
a full-colour launcher icon renders as a plain white square (the bug this asset
fixes).

## Where the assets live

Density PNGs, one per bucket, all named `ic_stat_uxnan.png`:

| File | Size (px) | Density |
|---|---|---|
| `android/app/src/main/res/drawable-mdpi/ic_stat_uxnan.png`    | 24 × 24 | mdpi (~1×) |
| `android/app/src/main/res/drawable-hdpi/ic_stat_uxnan.png`    | 36 × 36 | hdpi (1.5×) |
| `android/app/src/main/res/drawable-xhdpi/ic_stat_uxnan.png`   | 48 × 48 | xhdpi (2×) |
| `android/app/src/main/res/drawable-xxhdpi/ic_stat_uxnan.png`  | 72 × 72 | xxhdpi (3×) |
| `android/app/src/main/res/drawable-xxxhdpi/ic_stat_uxnan.png` | 96 × 96 | xxxhdpi (4×) |

**Format:** 32-bit PNG (RGBA), pure white pixels (`#FFFFFF`) with a transparent
background; the shape is carried entirely by the alpha channel. No solid
background, no colour.

## Where it is wired

- **Foreground** (built in Dart by `flutter_local_notifications`) —
  `lib/infrastructure/notifications/push_notification_service.dart` passes the
  bare drawable name `ic_stat_uxnan` (the plugin resolves it with
  `getIdentifier(name, "drawable", pkg)`, so **no** `@drawable/` prefix) plus the
  `@color/notification_color` accent.
- **Background / killed** (built by the system from an FCM `notification` payload,
  before Dart runs) — `android/app/src/main/AndroidManifest.xml`
  `com.google.firebase.messaging.default_notification_icon` →
  `@drawable/ic_stat_uxnan`, `…default_notification_color` →
  `@color/notification_color` (`res/values/colors.xml`, brand primary `#1B6EF3`),
  `…default_notification_channel_id` → `uxnan_turns`.

Both paths therefore render the same icon and accent.

## Regenerating from the SVG

Edit `ic_stat_uxnan.svg` (white strokes, tight viewBox ≈ 83 % frame fill, centred
on 256,256 — matches `assets/images/logo_wnb.svg`), then:

```bash
cd uxnanmobile/tool/notification_icon
npm i @resvg/resvg-js sharp   # one-off; not part of the Flutter app deps
node generate.mjs             # overwrites all five drawable-*/ic_stat_uxnan.png
```

Any SVG rasteriser works if you prefer not to use Node — the icon is just the SVG
exported white-on-transparent at the five sizes above, e.g. per size:

```bash
# ImageMagick
magick -background none ic_stat_uxnan.svg -resize 48x48 drawable-xhdpi/ic_stat_uxnan.png
# rsvg-convert
rsvg-convert -w 48 -h 48 ic_stat_uxnan.svg -o drawable-xhdpi/ic_stat_uxnan.png
```

## Swapping in a different mark

Replace `ic_stat_uxnan.svg` with any **single-colour** artwork (keep it simple and
bold — fine line-art thins out at 24 px), keep the fill white on transparency, and
re-run the generator. Nothing else changes; the resource name and wiring stay put.
