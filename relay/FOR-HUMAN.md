# FOR-HUMAN — uxnan-relay

Assets/configuration only a human can provide. The relay always builds and runs
**without** these; the optional push fallback simply stays disabled until they're set.

## Push moved to the bridge

The product is **bridge-first** and the relay is now **optional/self-hosted**.
Background push is sent **by the bridge** directly (works over LAN / Tailscale /
relay alike), so the Firebase service account belongs to the **bridge** — the
canonical push setup checklist lives in **`bridge/FOR-HUMAN.md`** (and the mobile
client files in `uxnanmobile/FOR-HUMAN.md`).

You only need to give the relay a Firebase credential if you **self-host a hosted
relay and want it to deliver push as a fallback**. In that case set
`UXNAN_FCM_SERVICE_ACCOUNT` to a Firebase service-account JSON (same project as
the bridge/mobile); without it the relay runs fine with delivery disabled.

## Still pending (anywhere): iOS APNs key

- [ ] **iOS APNs auth key** — create it in the Apple Developer console (needs a
      **paid** Apple Developer enrollment), then upload the `.p8` to Firebase →
      Cloud Messaging → Apple app configuration (Key ID + Team ID, bundle id
      `dev.luisgamas.uxnanmobile`). No relay code changes are needed; once uploaded,
      the existing FCM path delivers to iOS too. Android push is already live.

Everything else (Firebase project `uxnan-app`, FCM-for-both decision, Android
service account, mobile client config files) is **done** — tracked in
`bridge/FOR-HUMAN.md` / `uxnanmobile/FOR-HUMAN.md`.
