# Push & local notifications — setup, testing, multi-account

How notifications work in Uxnan, how to **activate** them from scratch against
your own Firebase account, how to **test** they work, and which files are safe to
commit. Push is **code-complete and gated**: everything builds and runs without
any Firebase config — notifications simply stay off until the credentials below
exist.

> **Bridge-first (2026-06-12).** The relay is **optional/self-hosted**, so
> background push is sent **directly by the bridge** via FCM on whatever
> transport the phone paired on (direct LAN / Tailscale / relay alike). The
> bridge owns the Firebase service account. A **self-hosted relay** can still
> hold the credential and deliver instead — that's the optional fallback,
> documented alongside the bridge-direct path below.

---

## 1. What you get

Two independent surfaces, both already wired in the app:

| Kind | When it fires | Needs Firebase? |
|---|---|---|
| **Local notification** | App is **open/foreground** and an agent turn completes or errors (driven by the bridge's `stream/turn/*` events), or a foreground FCM message arrives. Shown via `flutter_local_notifications`. | No — see note below |
| **Push (FCM)** | App is **backgrounded or terminated**: the bridge sends to FCM, FCM wakes the phone, tapping opens the thread. | Yes |

> **Note:** in the current build the app's `PushNotificationService.init()`
> initializes Firebase first and only then the local-notifications plugin, so on a
> device **with** Firebase config both surfaces light up together; **without** it,
> `init()` degrades gracefully and both stay off. (Decoupling local notifications
> from Firebase is tracked as a future nicety — not required for activation.)

---

## 2. The delivery flow

Default — **the bridge delivers directly** (no relay):

```
agent turn ends ─► bridge (PushService.onTurnEnd)
                     │  createBridgePushSender → FCM HTTP v1
                     │  (firebase-admin, service account on the bridge)
                     ▼
                   Firebase Cloud Messaging ─► phone (background) ─► tap opens thread
```

Optional fallback — **a self-hosted relay delivers** (only when the bridge holds
no FCM credential and `relayEnabled: true`):

```
agent turn ends ─► bridge ──POST /push/notify──► relay (PushRegistry → FCM sender)
                                                   │  FCM HTTP v1 (service account on the relay)
                                                   ▼
                                                 Firebase Cloud Messaging ─► phone
```

- The phone registers its FCM token over the live E2EE session
  (`notifications/register`) with the **bridge**, which keeps it for delivery.
- The bridge loads its service account at startup
  (`createBridgePushSender`): present → it delivers directly; absent → it logs
  `direct FCM disabled (relay fallback only)` and, if `relayEnabled` and the
  relay holds the credential, forwards delivery to the relay.

### Do I need the relay?

The relay is **optional and self-hosted** (`relayEnabled` defaults to `false` —
a fresh install is LAN/Tailscale-direct with no hosting). How that interacts with
notifications:

| Notification | Needs the relay? | Why |
|---|---|---|
| **Local** (app open/foreground) | **No** | The app raises them itself from the live E2EE session's `stream/turn/*` events — they ride the same direct (LAN/Tailscale) or relayed channel the app is already on. No FCM at all. |
| **Push / FCM** (app backgrounded or closed) | **No, by default** | When the bridge holds the Firebase service account (the **default** with `~/.uxnan/firebase-service-account.json` in place) it delivers directly via FCM on any transport. A self-hosted relay with the credential is only needed if you'd rather keep the key off the bridge. |

So with the **default bridge-direct setup you get push on every transport** —
local notifications while the app is open, background FCM push anywhere. The two
are complementary: local covers "app open", FCM covers "app backgrounded/closed"
(when the OS suspends the socket and live events stop arriving).

---

## 3. Current status

- **Android — LIVE.** Firebase project `uxnan-app`, app `dev.luisgamas.uxnanmobile`,
  `google-services.json` provisioned, Gradle plugin wired conditionally, the
  bridge service account + `UXNAN_FCM_SERVICE_ACCOUNT` set, FCM verified by dry-run.
- **iOS — PENDING.** App is registered in the same Firebase project and
  `GoogleService-Info.plist` is placed, but delivery needs an **APNs auth key**
  (a paid Apple Developer account) uploaded to Firebase, plus Xcode capabilities
  on macOS. No code changes are needed. See `uxnanmobile/FOR-HUMAN.md`.

The exact assets and where they live are tracked in
[`bridge/FOR-HUMAN.md`](../FOR-HUMAN.md) and `uxnanmobile/FOR-HUMAN.md`.

---

## 4. Activate from scratch (your own Firebase account)

Anyone else running Uxnan — or you, on a fresh machine — must link **their own**
Firebase project. Notifications are per-deployment: your Firebase project, your
client config, your service account. Nothing here is shared between users.

Prereqs: `firebase-tools` installed and logged in (`firebase login`), a Google
account. iOS additionally needs a paid Apple Developer account + macOS/Xcode.

### 4.1 Create the project + register the apps

```bash
# 1) Project (id must be >= 6 chars, globally unique)
firebase projects:create my-uxnan --display-name "uxnan"

# 2) Android app (FCM works directly)
firebase apps:create ANDROID "uxnan Android" \
  --package-name dev.luisgamas.uxnanmobile --project my-uxnan
firebase apps:sdkconfig ANDROID <ANDROID_APP_ID> --project my-uxnan \
  --out uxnanmobile/android/app/google-services.json

# 3) iOS app (optional now; needed for iOS push later)
firebase apps:create IOS "uxnan iOS" \
  --bundle-id dev.luisgamas.uxnanmobile --project my-uxnan
firebase apps:sdkconfig IOS <IOS_APP_ID> --project my-uxnan \
  --out uxnanmobile/ios/Runner/GoogleService-Info.plist
```

Cloud Messaging (FCM HTTP v1) is enabled by default on new projects.

> **Note on the bundle id:** Firebase does **not** let you change an existing
> app's package/bundle id (it is immutable). If you rename the app, register a
> **new** Firebase app under the new id and re-fetch its client config; the old
> app stays as an orphan and can be deleted in the Console.

### 4.2 Android Gradle — nothing to edit

The Google Services plugin is already wired **conditionally**: it sits on the
classpath in `android/settings.gradle.kts` (`apply false`) and is applied in
`android/app/build.gradle.kts` only `if (file("google-services.json").exists())`.
Drop the json in and the next build picks it up; remove it and the build still
works (push just off).

### 4.3 Bridge service account + env var

The bridge sends via the Firebase Admin SDK, which needs a **service-account key**.

- **Console path (simplest):** Firebase Console → Project settings → **Service
  accounts → Generate new private key** → save the JSON to
  `~/.uxnan/firebase-service-account.json` (`C:\Users\<you>\.uxnan\…` on Windows).
  This is the bridge's **default** location — no env var needed if you use it.
- To override the path, point the bridge at it:
  - Windows (persistent, user scope):
    `setx UXNAN_FCM_SERVICE_ACCOUNT "C:\Users\<you>\.uxnan\firebase-service-account.json"`
    (open a **new** terminal afterwards).
  - macOS/Linux: add `export UXNAN_FCM_SERVICE_ACCOUNT="$HOME/.uxnan/firebase-service-account.json"`
    to your shell profile.

`firebase-admin` is already a bridge `optionalDependency`, resolved from the
workspace root `node_modules` — no separate install needed. (A self-hosted relay
reads the **same** env var / path if you choose the relay-delivery fallback.)

### 4.4 iOS only — APNs (needs Apple Developer + macOS)

1. Apple Developer → Certificates, Identifiers & Profiles → **Keys → +** → enable
   **APNs** → download `AuthKey_XXXXXXXXXX.p8` (once). Record **Key ID** + **Team ID**.
2. Firebase Console → Project settings → **Cloud Messaging → Apple app
   configuration → APNs Authentication Key → Upload** the `.p8`.
3. Xcode → Runner target → Signing & Capabilities → **+ Push Notifications** and
   **+ Background Modes → Remote notifications**; ensure `GoogleService-Info.plist`
   is a member of the Runner target.

### 4.5 Re-provisioning on another machine (these files are NOT in git)

**For security, none of the config files are committed** — `.gitignore` excludes
`firebase-service-account.json`, `google-services.json`, `GoogleService-Info.plist`
and `*.p8`, so `git push` never carries them and a fresh clone on another PC won't
have them. Push stays gated until you re-create them locally on that machine. None
of the commands below hardcode secrets; where an identifier is needed, it's a
placeholder with a pointer to where you obtain it.

**Identifiers you'll need** (none are secret; substitute your own):
- `<project>` — your Firebase **project id**. Get it from the Firebase Console
  (Project settings → General) or `firebase projects:list`.
- `<android-app-id>` / `<ios-app-id>` — the app ids. Get them from the Firebase
  Console (Project settings → General → *Your apps*) or `firebase apps:list
  --project <project>`.

**1) Mobile client config** (`google-services.json` / `GoogleService-Info.plist`):

```bash
# discover the app ids for your project
firebase apps:list --project <project>

# Android → writes uxnanmobile/android/app/google-services.json
firebase apps:sdkconfig ANDROID <android-app-id> --project <project> \
  --out uxnanmobile/android/app/google-services.json

# iOS → writes uxnanmobile/ios/Runner/GoogleService-Info.plist
firebase apps:sdkconfig IOS <ios-app-id> --project <project> \
  --out uxnanmobile/ios/Runner/GoogleService-Info.plist
```

**2) Bridge service-account key** (`firebase-service-account.json`): this is a
secret and **cannot** be re-downloaded — generate a **new** key on the new
machine and point the bridge at it:

- Firebase Console → Project settings → **Service accounts → Generate new private
  key** → save the JSON to `~/.uxnan/firebase-service-account.json`.
- Set `UXNAN_FCM_SERVICE_ACCOUNT` to that path if you don't use the default (see §4.3).
- Optionally revoke old/unused keys in Google Cloud Console → IAM & Admin →
  Service Accounts → the `firebase-adminsdk-…` account → **Keys**.

(See §7 for the full rationale on what is and isn't safe to commit.)

---

## 5. Test that it works

### 5.1 Credentials (no device needed)

A dry-run validates the service account + project against FCM without delivering:

```bash
node -e '
const admin = require("firebase-admin");
const cred = require(process.env.UXNAN_FCM_SERVICE_ACCOUNT
  || require("path").join(require("os").homedir(), ".uxnan", "firebase-service-account.json"));
const app = admin.initializeApp({ credential: admin.credential.cert(cred) }, "dryrun");
admin.messaging(app).send({ topic: "uxnan-validation",
  notification: { title: "check", body: "creds valid" } }, true)
  .then(id => console.log("OK", id))
  .catch(e => { console.error("FAIL", e.code, e.message); process.exit(1); });
'
```

You can also confirm the **bridge** loads the FCM sender by starting it with the
credential in place: it delivers directly. With no credential it logs
`push: no Firebase service account at <path> — direct FCM disabled (relay fallback only)`.

### 5.2 Real device (Android)

1. Build the app onto a device with the Firebase config present:
   `cd uxnanmobile && flutter clean && flutter pub get && flutter run`.
2. Pair with the bridge (QR) and open a thread.
3. **Local notification:** keep the app open and let an agent finish a turn — a
   "Turn completed" notification appears.
4. **Push:** background the app (home button), trigger another turn from the
   running agent; the bridge → FCM delivers a push. Tapping it opens the thread.
   (Requires the bridge running with a valid service account, or a self-hosted
   relay holding the credential.)

### 5.3 Troubleshooting

- Bridge logs `direct FCM disabled (relay fallback only)` → no service account at
  `~/.uxnan/firebase-service-account.json` and `UXNAN_FCM_SERVICE_ACCOUNT` is
  unset/wrong (reopen the terminal after `setx`), or the JSON path is wrong.
- `notify` returns `unauthorized` (relay fallback path) → the phone never completed
  `notifications/register` (no token yet, or push disabled in config).
- No Android notification at all → `google-services.json` missing/mismatched
  package name, or the OS notification permission was denied.

---

## 6. Multi-account / multi-machine

- **Another person using the project** links their **own** Firebase project and
  generates their **own** service account; substitute their app IDs in §4. The
  app's package/bundle id stays `dev.luisgamas.uxnanmobile` (or change it consistently in
  `android/app/build.gradle.kts`, `AndroidManifest`, the iOS bundle id, and the
  Firebase apps).
- **You, on a second PC:** you need the same two things present locally — the
  mobile client config (re-fetch with `firebase apps:sdkconfig …`) and, on the
  bridge there, a service-account key + (optionally) the env var. See §7 for what
  travels with the repo and what does not.

---

## 7. What is safe to commit?

| File | Sensitivity | Commit to the repo? |
|---|---|---|
| `firebase-service-account.json` | **Secret — admin private key.** Grants the ability to send FCM (and other Admin SDK calls) for your project. | **Never.** Keep it in `~/.uxnan/` per machine. To use another PC, generate a fresh key there (or copy it over a secure channel). Rotate/revoke in GCP IAM if leaked. |
| `*.p8` (APNs key) | **Secret.** | **Never.** |
| `android/app/google-services.json` | **Low.** Client config (project id, app id, an API key). It already ships inside your APK, so it isn't a true secret — but the API key should be restricted in the GCP console. | Optional. **Currently gitignored.** In a **private** repo it's acceptable to commit for zero-setup clones; otherwise leave it out and re-fetch with `firebase apps:sdkconfig`. |
| `ios/Runner/GoogleService-Info.plist` | **Low** (same as above, for iOS). | Same as `google-services.json`. |

**Bottom line:** the **service-account key never goes in git** (it stays on this
PC and is re-created per machine). The two **client config files are low-risk**;
they're gitignored by default, but since this repo is private you *may* commit
them if you'd rather every clone work without re-downloading. They are trivial to
regenerate either way (`firebase apps:sdkconfig …`), so re-downloading on a new PC
is a one-line command — you never lose anything by keeping them out of git.

> Want the two client files committed (private repo, convenience)? Un-ignore just
> those two lines in `.gitignore` while keeping `firebase-service-account.json`
> and `*.p8` ignored. Ask and it can be flipped.
