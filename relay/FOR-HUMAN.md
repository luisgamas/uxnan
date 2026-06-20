# FOR-HUMAN — uxnan-relay

Assets/configuration only a human can provide. The relay must always build and
run **without** these; push (Phase 6) simply stays disabled until they're set.

> **Direction (2026-06-12): the relay is now OPTIONAL/self-hosted, and push is
> moving to the bridge.** Background push will be sent by the **bridge** directly
> (works on direct LAN / Tailscale / relay alike — see `bridge/FOR-HUMAN.md`),
> so the Firebase service account moves there. The relay push setup below stays
> valid **only if you self-host a hosted relay and prefer to keep the credential
> on it**. For the default bridge-first setup, provide the credential to the
> bridge instead.

---

## ✅ STATUS (2026-06-09): Android push LIVE — iOS pending

Push is **activated for Android** end-to-end on this PC:

- Firebase project **`uxnan-app`** (project number `97810225919`), Cloud
  Messaging (FCM HTTP v1) enabled. Path chosen: **FCM-for-both**.
- Relay service account: `firebase-adminsdk-fbsvc@uxnan-app.iam.gserviceaccount.com`,
  key at **`C:\Users\<you>\.uxnan\firebase-service-account.json`** (gitignored).
- Env var **`UXNAN_FCM_SERVICE_ACCOUNT`** set persistently (Windows *User* scope)
  → points at the key above. New terminals/relay launches pick it up; restart any
  already-running shell so it sees the variable.
- `firebase-admin` resolves from the workspace root `node_modules` (declared as a
  relay `optionalDependency`) — no extra install needed.
- Verified: `createDefaultPushSender` loads the **FCM sender** (not the noop) and a
  real FCM **dry-run** send to project `uxnan-app` succeeded.

**Still pending — iOS APNs** (needs a paid Apple Developer account; the `.p8`
upload itself is done in the Firebase console, doable from any OS, but creating
the key requires Apple enrollment). See the iOS checklist below and
`uxnanmobile/FOR-HUMAN.md`. No relay code changes are needed for iOS — once the
APNs key is uploaded to Firebase, the existing FCM path delivers to iOS too.

---

## Phase 6 — Push notifications (Firebase / APNs)

Push flow (architecture §5.10.2): bridge detects a turn completed → `POST
/push/notify` to the relay → the relay delivers to the device via FCM (Android)
or APNs (iOS) → the mobile app opens the thread.

### Recommended path: **FCM for BOTH platforms** (least setup)
Firebase Cloud Messaging can deliver to Android directly and to iOS by routing
through your uploaded APNs key. Then the **relay only needs ONE credential** (a
Firebase service account); the APNs key is uploaded to Firebase, not to the relay.

#### 1. Create the Firebase project
- [ ] Go to <https://console.firebase.google.com> → **Add project** (e.g. `uxnan`).
- [ ] Enable **Cloud Messaging** (Build → Cloud Messaging / it's on by default).

#### 2. Service account for the relay (Android + the FCM API)
- [ ] Firebase Console → **Project settings → Service accounts → Generate new
      private key** → download the JSON.
- [ ] **Where to put it on this PC:** `~/.uxnan/firebase-service-account.json`
      (i.e. `C:\Users\<you>\.uxnan\firebase-service-account.json`).
      **Never commit it** (already covered by `.gitignore` patterns; keep it out
      of the repo).
- [ ] **Config (env var the relay will read):**
      `UXNAN_FCM_SERVICE_ACCOUNT=C:\Users\<you>\.uxnan\firebase-service-account.json`
- [ ] Note your **Firebase project id** (Project settings → General).

#### 3. APNs key for iOS (uploaded to Firebase in the recommended path)
- [ ] Apple Developer account → <https://developer.apple.com/account> → **Certificates,
      Identifiers & Profiles → Keys → +** → enable **Apple Push Notifications service
      (APNs)** → Continue → download `AuthKey_XXXXXXXXXX.p8` (you can download it ONCE).
- [ ] Record the **Key ID** (10 chars) and your **Team ID** (Membership page).
- [ ] App bundle id is `dev.luisgamas.uxnanmobile` (matches the mobile app).
- [ ] **Recommended path:** Firebase Console → Project settings → **Cloud
      Messaging → Apple app configuration → APNs Authentication Key → Upload** the
      `.p8` with its Key ID + Team ID. (Then the relay sends iOS push via FCM too.)

### Alternative path: relay talks to APNs directly (no Firebase for iOS)
Only if you prefer not to route iOS through FCM. The relay would then need the
`.p8` locally and build APNs HTTP/2 JWTs itself:
- [ ] Put the key at `~/.uxnan/apns/AuthKey_XXXXXXXXXX.p8` (do not commit).
- [ ] Env: `UXNAN_APNS_KEY_PATH`, `UXNAN_APNS_KEY_ID`, `UXNAN_APNS_TEAM_ID`,
      `UXNAN_APNS_BUNDLE_ID=dev.luisgamas.uxnanmobile`,
      `UXNAN_APNS_ENV=sandbox|production`.

### Mobile-app side (tracked separately, on the `uxnanmobile` branch)
The phone must register for push and obtain an FCM token. The mobile app needs
Firebase client config files from the **same** Firebase project:
- [ ] Android: `google-services.json` → `uxnanmobile/android/app/`.
- [ ] iOS: `GoogleService-Info.plist` → `uxnanmobile/ios/Runner/`.
- [ ] (These are FOR-HUMAN items for the mobile repo; listed here only as a
      cross-reference so the same Firebase project is used end-to-end.)

### Tools to install on this PC (when implementing Phase 6)
- [ ] `firebase-admin` (npm, relay dependency) — sends via FCM HTTP v1 using the
      service account. (Added at implementation time, not now.)
- [ ] Direct-APNs path only: `jsonwebtoken` (npm) for the APNs JWT, or a library
      like `apns2`. Node's built-in `http2` covers the transport.
- [ ] Optional: `firebase-tools` (npm, global) for poking FCM from the CLI.

### How to test push WITHOUT physical devices
- **FCM dry-run:** `firebase-admin`'s `messaging().send(message, /* dryRun */ true)`
  validates the message + credentials without delivering — good for CI/local.
- **Relay logic without creds:** the `/push/*` endpoints, dedupe and
  notification-secret validation are implemented behind a `PushSender` interface
  so they're unit-tested with a fake sender (no Firebase needed). See
  `relay/FOR-DEV.md`.
- **Real delivery:** needs a real Android/iOS build registered to the Firebase
  project + a device token; do this once the mobile push module is wired.

### Open items checklist
- [x] Firebase project created (`uxnan-app`) + Cloud Messaging enabled.
- [x] Service account JSON generated → `~/.uxnan/firebase-service-account.json` +
      `UXNAN_FCM_SERVICE_ACCOUNT` set (Windows User scope).
- [x] Decide path: **FCM-for-both** (chosen). Relay `PushSender` already
      implements it (FCM HTTP v1 via `firebase-admin`).
- [x] Mobile `google-services.json` (Android) + `GoogleService-Info.plist` (iOS)
      added in the mobile repo (same project) — see `uxnanmobile/FOR-HUMAN.md`.
- [ ] **iOS only:** APNs auth key created (Apple Developer) and uploaded to
      Firebase → Cloud Messaging → Apple app configuration. Needed before iOS
      devices receive push; Android is unaffected.
