# FOR-HUMAN — uxnan-relay

Assets/configuration only a human can provide. The relay must always build and
run **without** these; push (Phase 6) simply stays disabled until they're set.

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
- [ ] App bundle id is `com.uxnan.mobile` (matches the mobile app).
- [ ] **Recommended path:** Firebase Console → Project settings → **Cloud
      Messaging → Apple app configuration → APNs Authentication Key → Upload** the
      `.p8` with its Key ID + Team ID. (Then the relay sends iOS push via FCM too.)

### Alternative path: relay talks to APNs directly (no Firebase for iOS)
Only if you prefer not to route iOS through FCM. The relay would then need the
`.p8` locally and build APNs HTTP/2 JWTs itself:
- [ ] Put the key at `~/.uxnan/apns/AuthKey_XXXXXXXXXX.p8` (do not commit).
- [ ] Env: `UXNAN_APNS_KEY_PATH`, `UXNAN_APNS_KEY_ID`, `UXNAN_APNS_TEAM_ID`,
      `UXNAN_APNS_BUNDLE_ID=com.uxnan.mobile`,
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
- [ ] Firebase project created + Cloud Messaging enabled.
- [ ] Service account JSON downloaded → `~/.uxnan/firebase-service-account.json` +
      `UXNAN_FCM_SERVICE_ACCOUNT` set.
- [ ] APNs auth key created and uploaded to Firebase (recommended) or placed
      locally (direct path).
- [ ] Mobile `google-services.json` / `GoogleService-Info.plist` added (mobile repo).
- [ ] Decide: **FCM-for-both** (recommended) vs **direct APNs**. Tell the agent so
      the relay's `PushSender` is implemented for the chosen path.
