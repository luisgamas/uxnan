# R8 / ProGuard keep rules for uxnanmobile.
#
# ACTIVE — release minification is on (`isMinifyEnabled = true` in
# build.gradle.kts). These keep the reflectively-instantiated component
# registrars that R8 full mode would otherwise strip (stripping their no-arg
# constructors -> "NoSuchMethodException: <init>[]"), which breaks:
#   - ML Kit barcode scanning  -> mobile_scanner NPE on camera start
#     ("getClass() on a null object reference")
#   - Firebase / FCM           -> background push silently fails
#
# If a new reflective dep breaks only in `--release`, add its keep rule here and
# re-test a QR scan AND a background push before shipping.

# ── ML Kit (barcode scanning via mobile_scanner) ───────────────────────────
-keep class com.google.mlkit.** { *; }
-keep interface com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_** { *; }
-dontwarn com.google.mlkit.**

# ── Firebase (FCM push) ────────────────────────────────────────────────────
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# ── Component registrars (the classes whose <init>[] R8 was stripping) ─────
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }

# ── mobile_scanner plugin ──────────────────────────────────────────────────
-keep class dev.steenbakker.mobile_scanner.** { *; }

# ── Play In-App Update (in_app_update_flutter) ──────────────────────────────
# The com.google.android.play:app-update library is reached via a Play Store
# IPC/listener surface; keep its public classes so R8 full mode doesn't strip
# the in-app update flow (checkUpdateAndroid / startFlexibleUpdateAndroid /
# completeUpdateAndroid + the install-state listener) in --release.
-keep class com.google.android.play.core.** { *; }
-keep interface com.google.android.play.core.** { *; }
-dontwarn com.google.android.play.core.**
