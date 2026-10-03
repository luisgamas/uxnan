# FOR-HUMAN — uxnan-relay

Assets/configuration only a human can provide.

**There are no open human items for the relay.** The repository holds no
Cloudflare account, token or key: each user's bridge deploys the relay into
that user's own account with a token the user types at setup time
(`uxnan-bridge relay setup`, see [`docs/deploy.md`](docs/deploy.md)). The relay
carries no push traffic — the Firebase service account and the iOS APNs key are
tracked in **`bridge/FOR-HUMAN.md`** (and the mobile client files in
`uxnanmobile/FOR-HUMAN.md`).

Optional, for developers only: running the test suite against a **deployed**
relay ([`docs/testing.md`](docs/testing.md) → *Against a relay deployed to
Cloudflare*) needs your own Cloudflare account and a test Worker. Nothing in CI
depends on it, and no such credential belongs in the repository.
