# FOR-HUMAN — uxnan-relay

Assets/configuration only a human can provide.

**There are no open human items for the relay.** It needs no credentials, keys or
config files: it only forwards sealed E2EE envelopes and carries no push traffic.
Background push is sent by the bridge straight to FCM, so the Firebase service
account and the iOS APNs key are tracked in **`bridge/FOR-HUMAN.md`** (and the
mobile client files in `uxnanmobile/FOR-HUMAN.md`).
