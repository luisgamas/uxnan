//! AI-provider usage statistics — native reader for Settings → Providers.
//!
//! Reads quota/rate windows, plan/account and credit balance for the coding CLIs
//! the user activated, using each CLI's own stored token (→ the provider's
//! official usage API). Posture: only the CLI's local token is read — never
//! browser cookies or user-pasted API keys.
//!
//! The wire shape mirrors `shared/src/models/usage.ts` (serde camelCase) so the
//! bridge can serve the identical `agent/usageStats` payload to the phone later
//! (Phase 6). Only the providers passed in are read — inactive providers never
//! touch the network or disk.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A coding CLI whose usage we can read from local files / its stored token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageProvider {
    Codex,
    Claude,
    Copilot,
    Gemini,
    Grok,
}

/// Outcome of reading one provider's usage.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageStatus {
    /// Fresh quota/credit data was read.
    Ok,
    /// CLI is present but not signed in (no usable token).
    AuthRequired,
    /// CLI / its config directory is not present on this machine.
    NotInstalled,
    /// Read/network/parse failure — see `message`.
    Error,
}

/// How the data was obtained, for the UI's provenance label. Every wired
/// provider reads its quota from the CLI's own signed-in token.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageSource {
    Token,
}

/// The kind of billing relationship, so the UI can label an account beyond its
/// plan name. Derived per provider from its plan / billing signals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountType {
    Subscription,
    PayAsYouGo,
    Free,
    Team,
    Enterprise,
}

/// Classify a provider plan/tier slug into an [`AccountType`] by keyword. Anything
/// that isn't explicitly free / team / enterprise reads as a paid subscription
/// (the common case for a CLI signed in with a personal plan).
fn classify_plan(slug: &str) -> AccountType {
    let s = slug.to_lowercase();
    if s.contains("enterprise") {
        AccountType::Enterprise
    } else if s.contains("team") || s.contains("business") {
        AccountType::Team
    } else if s.contains("free") {
        AccountType::Free
    } else {
        AccountType::Subscription
    }
}

/// A single quota/rate window, expressed as a used-percentage with an optional
/// reset time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub id: String,
    pub label: String,
    pub used_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<i64>,
}

/// A monetary / credit balance, kept separate from the percentage windows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditBalance {
    pub used: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    pub currency: String,
    pub period: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<i64>,
    /// Amount still available this period, when the provider reports a remaining
    /// balance directly (e.g. Grok on-demand / prepaid).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available: Option<f64>,
}

/// One redeemable reset, for the per-credit detail (which one, when it expires).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetCreditEntry {
    /// Short label the provider gives the reset (e.g. "Full reset"), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// When this reset lapses (epoch ms), when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

/// Redeemable rate-limit "reset credits" a provider grants to roll a hit limit
/// back early (Codex). Distinct from [`CreditBalance`] (money): these are reset
/// tokens, not a monetary balance.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetCredits {
    /// How many resets can be redeemed right now.
    pub available: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_earned: Option<i64>,
    /// When the soonest still-available reset lapses (epoch ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_expires_at: Option<i64>,
    /// The individual available resets, soonest-expiring first, when the provider
    /// details them — so the UI can show which one and when each expires.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<ResetCreditEntry>>,
}

/// Plan / account identity, when the provider reports it.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// The kind of account (subscription / pay-as-you-go / …), derived per
    /// provider so the UI can identify it beyond the plan name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_type: Option<AccountType>,
}

impl Account {
    fn is_empty(&self) -> bool {
        self.email.is_none()
            && self.organization.is_none()
            && self.plan.is_none()
            && self.account_type.is_none()
    }
}

/// One provider's usage snapshot. Always produced (never an error result) — a
/// failure is reported via `status` + `message`, so a slow/broken provider never
/// sinks the others.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub provider: UsageProvider,
    pub status: UsageStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<UsageSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<Account>,
    pub windows: Vec<UsageWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit: Option<CreditBalance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_credits: Option<ResetCredits>,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl ProviderUsage {
    fn base(provider: UsageProvider, status: UsageStatus) -> Self {
        Self {
            provider,
            status,
            source: None,
            account: None,
            windows: Vec::new(),
            credit: None,
            reset_credits: None,
            updated_at: now_ms(),
            message: None,
        }
    }

    fn with_message(mut self, msg: impl Into<String>) -> Self {
        self.message = Some(msg.into());
        self
    }

    fn with_account(mut self, account: Account) -> Self {
        if !account.is_empty() {
            self.account = Some(account);
        }
        self
    }
}

// --- Public API -------------------------------------------------------------

/// Read usage for exactly the requested providers (the ones the user activated).
/// Each provider is read in turn and degrades gracefully to a status, so a slow
/// or broken provider never sinks the others. FOR-DEV: parallelize with a
/// `JoinSet` if the activated set grows large enough for latency to matter.
pub async fn read_usage(providers: Vec<UsageProvider>) -> Vec<ProviderUsage> {
    let home = home_dir();
    let mut out = Vec::with_capacity(providers.len());
    for p in providers {
        let usage = match &home {
            None => ProviderUsage::base(p, UsageStatus::Error)
                .with_message("cannot resolve the home directory"),
            Some(home) => read_one(p, home).await,
        };
        out.push(usage);
    }
    out
}

/// The subset of `providers` whose CLI / config is present on this machine — for
/// the catalog to enable only the available ones (mirrors `agents_detect`).
pub fn detect_present(providers: &[UsageProvider]) -> Vec<UsageProvider> {
    let home = home_dir();
    providers
        .iter()
        .copied()
        .filter(|p| match &home {
            Some(home) => is_present(*p, home),
            None => false,
        })
        .collect()
}

async fn read_one(provider: UsageProvider, home: &Path) -> ProviderUsage {
    match provider {
        UsageProvider::Codex => read_codex(home).await,
        UsageProvider::Claude => read_claude(home).await,
        UsageProvider::Copilot => read_copilot().await,
        UsageProvider::Gemini => read_gemini(home).await,
        UsageProvider::Grok => read_grok(home).await,
    }
}

fn is_present(provider: UsageProvider, home: &Path) -> bool {
    match provider {
        UsageProvider::Codex => home.join(".codex").join("auth.json").exists(),
        UsageProvider::Claude => {
            home.join(".claude").join(".credentials.json").exists()
                || home.join(".claude.json").exists()
        }
        UsageProvider::Gemini => home.join(".gemini").join("oauth_creds.json").exists(),
        UsageProvider::Copilot => crate::which::is_command_available("gh"),
        UsageProvider::Grok => home.join(".grok").join("auth.json").exists(),
    }
}

// --- Grok -------------------------------------------------------------------

async fn read_grok(home: &Path) -> ProviderUsage {
    let auth_path = home.join(".grok").join("auth.json");
    let Some(auth) = read_json(&auth_path) else {
        return ProviderUsage::base(UsageProvider::Grok, UsageStatus::NotInstalled)
            .with_message("Grok is not set up on this PC (~/.grok/auth.json missing)");
    };
    // Grok stores accounts under an issuer/client key. Select the first usable
    // signed-in account without exposing its key in errors or logs.
    let account = auth.as_object().and_then(|entries| {
        entries
            .values()
            .find(|entry| entry.get("key").and_then(|v| v.as_str()).is_some())
    });
    let Some(token) = account
        .and_then(|entry| entry.get("key"))
        .and_then(|v| v.as_str())
    else {
        return ProviderUsage::base(UsageProvider::Grok, UsageStatus::AuthRequired)
            .with_message("Grok has no usable signed-in credential — run `grok login`");
    };
    let email = account
        .and_then(|entry| entry.get("email"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return errored(UsageProvider::Grok, e),
    };
    let req = client
        .get("https://cli-chat-proxy.grok.com/v1/billing?format=credits")
        .bearer_auth(token)
        .header("accept", "application/json");
    let body = match fetch_json(req).await {
        Ok(v) => v,
        Err(HttpError::Unauthorized) => {
            return ProviderUsage::base(UsageProvider::Grok, UsageStatus::AuthRequired)
                .with_account(Account {
                    email,
                    ..Default::default()
                })
                .with_message("Grok credential expired — run the Grok CLI to refresh it");
        }
        Err(e) => {
            return http_error(UsageProvider::Grok, e).with_account(Account {
                email,
                ..Default::default()
            });
        }
    };

    let config = body.get("config").unwrap_or(&body);
    let tier = config
        .get("subscriptionTier")
        .or_else(|| config.get("subscription_tier"))
        .and_then(|v| v.as_str());
    let plan = tier.map(str::to_string);

    // Real $ balances Grok exposes (that a %-only reader misses): on-demand spend
    // vs cap, and any prepaid balance.
    let on_demand_used = grok_money(
        config
            .get("onDemandUsed")
            .or_else(|| config.get("on_demand_used")),
    );
    let on_demand_cap = grok_money(
        config
            .get("onDemandCap")
            .or_else(|| config.get("on_demand_cap")),
    );
    let prepaid = grok_money(
        config
            .get("prepaidBalance")
            .or_else(|| config.get("prepaid_balance")),
    );
    let has_ondemand = on_demand_used.is_some() || on_demand_cap.is_some();
    let account_type = match tier {
        Some(t) => Some(classify_plan(t)),
        None if has_ondemand || prepaid.is_some() => Some(AccountType::PayAsYouGo),
        None => None,
    };

    let mut usage =
        ProviderUsage::base(UsageProvider::Grok, UsageStatus::Ok).with_account(Account {
            email,
            plan,
            account_type,
            ..Default::default()
        });
    usage.source = Some(UsageSource::Token);
    usage.credit = grok_credit(on_demand_used, on_demand_cap, prepaid);

    if let Some(percent) = config
        .get("creditUsagePercent")
        .or_else(|| config.get("credit_usage_percent"))
        .and_then(number)
    {
        let period = config.get("currentPeriod");
        usage.windows.push(UsageWindow {
            id: "credits".to_string(),
            label: grok_period_label(period),
            used_percent: clamp_pct(percent),
            window_minutes: grok_period_minutes(period),
            resets_at: period
                .and_then(|p| p.get("end"))
                .and_then(epoch_ms)
                .or_else(|| config.get("billingPeriodEnd").and_then(epoch_ms)),
        });
    }
    if usage.windows.is_empty() && usage.credit.is_none() {
        usage = usage.with_message("signed in, but the Grok billing API returned no quota window");
    }
    usage
}

fn grok_period_label(period: Option<&serde_json::Value>) -> String {
    match period.and_then(|p| p.get("type")).and_then(|v| v.as_str()) {
        Some("USAGE_PERIOD_TYPE_DAILY") => "Daily".to_string(),
        Some("USAGE_PERIOD_TYPE_WEEKLY") => "Weekly".to_string(),
        Some("USAGE_PERIOD_TYPE_MONTHLY") => "Monthly".to_string(),
        _ => "Usage".to_string(),
    }
}

fn grok_period_minutes(period: Option<&serde_json::Value>) -> Option<u32> {
    match period.and_then(|p| p.get("type")).and_then(|v| v.as_str()) {
        Some("USAGE_PERIOD_TYPE_DAILY") => Some(1440),
        Some("USAGE_PERIOD_TYPE_WEEKLY") => Some(10080),
        Some("USAGE_PERIOD_TYPE_MONTHLY") => Some(43200),
        _ => None,
    }
}

/// A $ amount from a Grok billing field that may be a bare number or an object
/// wrapping it (`{val}` / `{value}` / `{amount}`).
fn grok_money(v: Option<&serde_json::Value>) -> Option<f64> {
    let v = v?;
    number(v)
        .or_else(|| v.get("val").and_then(number))
        .or_else(|| v.get("value").and_then(number))
        .or_else(|| v.get("amount").and_then(number))
}

/// Build a $ credit balance from Grok's on-demand (spend vs cap) or prepaid
/// (remaining balance) fields. `None` when neither carries a non-zero value.
fn grok_credit(used: Option<f64>, cap: Option<f64>, prepaid: Option<f64>) -> Option<CreditBalance> {
    let u = used.unwrap_or(0.0);
    let c = cap.unwrap_or(0.0);
    if u > 0.0 || c > 0.0 {
        return Some(CreditBalance {
            used: u,
            limit: cap,
            currency: "USD".to_string(),
            period: "On-demand".to_string(),
            resets_at: None,
            available: cap.map(|cc| (cc - u).max(0.0)),
        });
    }
    prepaid.filter(|b| *b > 0.0).map(|bal| CreditBalance {
        used: 0.0,
        limit: None,
        currency: "USD".to_string(),
        period: "Prepaid".to_string(),
        resets_at: None,
        available: Some(bal),
    })
}

// --- Codex ------------------------------------------------------------------

async fn read_codex(home: &Path) -> ProviderUsage {
    let auth_path = home.join(".codex").join("auth.json");
    let Some(auth) = read_json(&auth_path) else {
        return ProviderUsage::base(UsageProvider::Codex, UsageStatus::NotInstalled)
            .with_message("Codex is not set up on this PC (~/.codex/auth.json missing)");
    };
    let token = auth
        .get("tokens")
        .and_then(|t| t.get("access_token"))
        .and_then(|v| v.as_str());
    let Some(token) = token else {
        return ProviderUsage::base(UsageProvider::Codex, UsageStatus::AuthRequired)
            .with_message("Codex is not signed in with a ChatGPT account");
    };
    let account_id = auth
        .get("tokens")
        .and_then(|t| t.get("account_id"))
        .and_then(|v| v.as_str());

    let base = codex_base_url(home);
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return errored(UsageProvider::Codex, e),
    };
    let mut req = client.get(format!("{base}/wham/usage")).bearer_auth(token);
    if let Some(acc) = account_id {
        req = req.header("ChatGPT-Account-Id", acc);
    }
    let body = match fetch_json(req).await {
        Ok(v) => v,
        Err(e) => return http_error(UsageProvider::Codex, e),
    };

    let mut usage = ProviderUsage::base(UsageProvider::Codex, UsageStatus::Ok);
    usage.source = Some(UsageSource::Token);

    let plan_type = body.get("plan_type").and_then(|v| v.as_str());
    let plan = plan_type.map(prettify_plan);
    let account_type = plan_type.map(classify_plan);
    let email = body
        .get("email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    usage = usage.with_account(Account {
        email,
        plan,
        account_type,
        ..Default::default()
    });

    // Primary/secondary windows live under `rate_limit`; each carries
    // `used_percent`, `reset_at` (epoch seconds) and `limit_window_seconds`. The
    // label is derived from that length (a "go" plan's primary window is monthly,
    // not a 5-hour session), so it reads truthfully.
    if let Some(rl) = body.get("rate_limit").or_else(|| body.get("rate_limits")) {
        for key in ["primary_window", "secondary_window"] {
            if let Some(w) = rl.get(key) {
                if let Some(mut win) = window_from_value(key, "", w, None) {
                    win.label = label_for_minutes(win.window_minutes);
                    usage.windows.push(win);
                }
            }
        }
    }
    // Code-review + any additional windows are siblings of `rate_limit`.
    if let Some(w) = body.get("code_review_rate_limit") {
        if let Some(mut win) = window_from_value("code_review", "Code review", w, None) {
            win.label = "Code review".to_string();
            usage.windows.push(win);
        }
    }
    if let Some(arr) = body
        .get("additional_rate_limits")
        .and_then(|v| v.as_array())
    {
        for (i, w) in arr.iter().enumerate() {
            let label = w
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Extra")
                .to_string();
            if let Some(win) = window_from_value(&format!("extra{i}"), &label, w, None) {
                usage.windows.push(win);
            }
        }
    }

    if let Some(credits) = body.get("credits") {
        usage.credit = credit_from_value(credits, "Credits");
    }

    // Codex "reset credits" (reinicios): resets you can redeem to roll a hit
    // rate-limit back early. Prefer the dedicated endpoint (full per-credit detail:
    // a title + expiry each); the field in the usage response is count-only.
    usage.reset_credits = codex_reset_credits(&client, &base, token, account_id).await;
    if usage.reset_credits.is_none() {
        usage.reset_credits = body
            .get("rate_limit_reset_credits")
            .and_then(parse_reset_credits);
    }

    if usage.windows.is_empty() && usage.credit.is_none() && usage.reset_credits.is_none() {
        usage = usage.with_message("signed in, but the usage API returned no quota windows");
    }
    usage
}

/// Fetch Codex's dedicated rate-limit-reset-credits endpoint and parse it. Same
/// auth as `/wham/usage`. `None` on any failure (best-effort enrichment).
async fn codex_reset_credits(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    account_id: Option<&str>,
) -> Option<ResetCredits> {
    let mut req = client
        .get(format!("{base}/wham/rate-limit-reset-credits"))
        .bearer_auth(token);
    if let Some(acc) = account_id {
        req = req.header("ChatGPT-Account-Id", acc);
    }
    let body = fetch_json(req).await.ok()?;
    parse_reset_credits(&body)
}

/// Parse a Codex reset-credits payload — either a bare count, or an object with
/// `available_count` / `total_earned_count` / `credits[]` (each `{status,
/// expires_at}`). `next_expires_at` is the explicit field, else the earliest
/// `expires_at` among still-available credits. `None` when there's nothing
/// meaningful to show (no available and none ever earned).
fn parse_reset_credits(v: &serde_json::Value) -> Option<ResetCredits> {
    // A bare number = the available count (no per-credit detail).
    if v.is_number() {
        let n = number(v)? as i64;
        return (n > 0).then_some(ResetCredits {
            available: n,
            total_earned: None,
            next_expires_at: None,
            entries: None,
        });
    }
    let total_earned = v
        .get("total_earned_count")
        .or_else(|| v.get("totalEarnedCount"))
        .and_then(number)
        .map(|n| n as i64);

    // Per-credit detail: the still-available resets, soonest-expiring first.
    let mut entries: Vec<ResetCreditEntry> = v
        .get("credits")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|c| {
                    c.get("status")
                        .and_then(|s| s.as_str())
                        .map(|s| s.eq_ignore_ascii_case("available"))
                        .unwrap_or(true)
                })
                .map(|c| ResetCreditEntry {
                    title: c.get("title").and_then(|v| v.as_str()).map(str::to_string),
                    expires_at: c
                        .get("expires_at")
                        .or_else(|| c.get("expiresAt"))
                        .and_then(epoch_ms),
                })
                .collect()
        })
        .unwrap_or_default();
    entries.sort_by_key(|e| e.expires_at.unwrap_or(i64::MAX));

    let available = v
        .get("available_count")
        .or_else(|| v.get("availableCount"))
        .and_then(number)
        .map(|n| n as i64)
        .unwrap_or_else(|| entries.len() as i64);
    let next_expires_at = entries.iter().find_map(|e| e.expires_at).or_else(|| {
        v.get("next_expires_at")
            .or_else(|| v.get("nextExpiresAt"))
            .and_then(epoch_ms)
    });
    if available <= 0 && total_earned.unwrap_or(0) <= 0 && entries.is_empty() {
        return None;
    }
    Some(ResetCredits {
        available,
        total_earned,
        next_expires_at,
        entries: (!entries.is_empty()).then_some(entries),
    })
}

/// Redeem one Codex rate-limit reset ("reinicio"), rolling a hit limit back early.
/// POSTs to the consume endpoint with a fresh request id and returns the outcome
/// code (`reset` / `nothing_to_reset` / `no_credit` / `already_redeemed` / …), so
/// the caller can message + refresh. Uses the same stored token as the reader.
pub async fn codex_redeem_reset() -> Result<String, String> {
    let home = home_dir().ok_or("cannot resolve the home directory")?;
    let auth = read_json(&home.join(".codex").join("auth.json"))
        .ok_or("Codex is not set up on this PC")?;
    let token = auth
        .get("tokens")
        .and_then(|t| t.get("access_token"))
        .and_then(|v| v.as_str())
        .ok_or("Codex is not signed in with a ChatGPT account")?;
    let account_id = auth
        .get("tokens")
        .and_then(|t| t.get("account_id"))
        .and_then(|v| v.as_str());
    let base = codex_base_url(&home);
    let client = http_client()?;
    let redeem_id = uuid::Uuid::new_v4().to_string();
    let mut req = client
        .post(format!("{base}/wham/rate-limit-reset-credits/consume"))
        .bearer_auth(token)
        .header("content-type", "application/json")
        .body(serde_json::json!({ "redeem_request_id": redeem_id }).to_string());
    if let Some(acc) = account_id {
        req = req.header("ChatGPT-Account-Id", acc);
    }
    let body = fetch_json(req).await.map_err(|e| match e {
        HttpError::Unauthorized => {
            "the stored token was rejected — sign in again with Codex".to_string()
        }
        HttpError::Other(m) => m,
    })?;
    Ok(body
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string())
}

fn codex_base_url(home: &Path) -> String {
    // Honor a custom `chatgpt_base_url` in ~/.codex/config.toml (HTTPS only),
    // else the default backend. Parsed leniently to avoid a TOML dependency.
    let default = "https://chatgpt.com/backend-api".to_string();
    let Ok(text) = std::fs::read_to_string(home.join(".codex").join("config.toml")) else {
        return default;
    };
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("chatgpt_base_url") {
            if let Some(eq) = rest.split_once('=') {
                let val = eq.1.trim().trim_matches('"').trim_matches('\'');
                if let Some(base) = val.strip_suffix('/') {
                    if base.starts_with("https://") {
                        return base.to_string();
                    }
                } else if val.starts_with("https://") {
                    return val.to_string();
                }
            }
        }
    }
    default
}

// --- Claude -----------------------------------------------------------------

async fn read_claude(home: &Path) -> ProviderUsage {
    let creds_path = home.join(".claude").join(".credentials.json");
    let Some(creds) = read_json(&creds_path) else {
        return ProviderUsage::base(UsageProvider::Claude, UsageStatus::NotInstalled)
            .with_message("Claude Code is not signed in (~/.claude/.credentials.json missing)");
    };
    let oauth = creds.get("claudeAiOauth");
    let token = oauth
        .and_then(|o| o.get("accessToken"))
        .and_then(|v| v.as_str());
    let Some(token) = token else {
        return ProviderUsage::base(UsageProvider::Claude, UsageStatus::AuthRequired)
            .with_message("Claude Code has no OAuth access token");
    };
    let subscription_type = oauth
        .and_then(|o| o.get("subscriptionType"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let plan = subscription_type.as_deref().map(prettify_plan);
    let account_type = subscription_type.as_deref().map(classify_plan);

    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return errored(UsageProvider::Claude, e),
    };
    let req = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("accept", "application/json");
    let body = match fetch_json(req).await {
        Ok(v) => v,
        Err(e) => return http_error(UsageProvider::Claude, e),
    };

    let mut usage = ProviderUsage::base(UsageProvider::Claude, UsageStatus::Ok);
    usage.source = Some(UsageSource::Token);
    usage = usage.with_account(Account {
        plan,
        account_type,
        ..Default::default()
    });

    // The `limits[]` array is the modern, complete quota picture: each entry has a
    // `percent` (0–100), a `kind`/`group`, an ISO `resets_at`, and an optional
    // model `scope`. Prefer it; fall back to the individual `five_hour`/`seven_day`
    // keys for an older API shape.
    if let Some(limits) = body.get("limits").and_then(|v| v.as_array()) {
        for (i, l) in limits.iter().enumerate() {
            let Some(pct) = l.get("percent").and_then(number) else {
                continue;
            };
            let kind = l.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let group = l.get("group").and_then(|v| v.as_str()).unwrap_or("");
            let model = l
                .get("scope")
                .and_then(|s| s.get("model"))
                .and_then(|m| m.get("display_name"))
                .and_then(|v| v.as_str());
            let minutes = match group {
                "session" => Some(300u32),
                "weekly" => Some(10080),
                _ => None,
            };
            usage.windows.push(UsageWindow {
                id: if kind.is_empty() {
                    format!("limit{i}")
                } else {
                    kind.to_string()
                },
                label: claude_limit_label(kind, group, model),
                used_percent: clamp_pct(pct),
                window_minutes: minutes,
                resets_at: l.get("resets_at").and_then(epoch_ms),
            });
        }
    }
    if usage.windows.is_empty() {
        for (key, label, minutes) in [
            ("five_hour", "Session (5h)", Some(300u32)),
            ("seven_day", "Weekly", Some(10080)),
            ("seven_day_opus", "Opus (weekly)", Some(10080)),
            ("seven_day_sonnet", "Sonnet (weekly)", Some(10080)),
        ] {
            if let Some(w) = body.get(key) {
                if let Some(win) = claude_window(key, label, w, minutes) {
                    usage.windows.push(win);
                }
            }
        }
    }

    // Extra (pay-as-you-go) usage → a credit balance, when enabled.
    if let Some(extra) = body.get("extra_usage") {
        if extra.get("is_enabled").and_then(|v| v.as_bool()) == Some(true) {
            if let Some(used) = extra.get("used_credits").and_then(number) {
                usage.credit = Some(CreditBalance {
                    used,
                    limit: extra.get("monthly_limit").and_then(number),
                    currency: extra
                        .get("currency")
                        .and_then(|v| v.as_str())
                        .unwrap_or("USD")
                        .to_string(),
                    period: "Monthly credits".to_string(),
                    resets_at: None,
                    available: None,
                });
            }
        }
    }

    if usage.windows.is_empty() && usage.credit.is_none() {
        usage = usage.with_message("signed in, but the usage API returned no quota windows");
    }
    usage
}

/// A readable label for a Claude `limits[]` entry: a model-scoped window shows
/// the model (e.g. "Fable (weekly)"), else the window kind is title-cased.
fn claude_limit_label(kind: &str, group: &str, model: Option<&str>) -> String {
    if let Some(m) = model {
        let scope = if group.is_empty() { kind } else { group };
        return format!("{m} ({scope})");
    }
    match kind {
        "session" => "Session (5h)".to_string(),
        "weekly_all" => "Weekly".to_string(),
        "weekly_scoped" => "Weekly (scoped)".to_string(),
        _ => prettify_plan(kind),
    }
}

fn claude_window(
    id: &str,
    label: &str,
    w: &serde_json::Value,
    minutes: Option<u32>,
) -> Option<UsageWindow> {
    let util = w
        .get("utilization")
        .or_else(|| w.get("used"))
        .and_then(number)?;
    // `utilization` is a 0–1 fraction; normalize to a 0–100 percentage.
    let pct = if util <= 1.0 { util * 100.0 } else { util };
    let resets_at = w
        .get("resets_at")
        .or_else(|| w.get("resetsAt"))
        .and_then(epoch_ms);
    Some(UsageWindow {
        id: id.to_string(),
        label: label.to_string(),
        used_percent: clamp_pct(pct),
        window_minutes: minutes,
        resets_at,
    })
}

// --- Copilot ----------------------------------------------------------------

async fn read_copilot() -> ProviderUsage {
    let Some(token) = gh_auth_token().await else {
        return ProviderUsage::base(UsageProvider::Copilot, UsageStatus::AuthRequired)
            .with_message("no GitHub token from `gh auth token` — run `gh auth login`");
    };
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return errored(UsageProvider::Copilot, e),
    };
    let req = client
        .get("https://api.github.com/copilot_internal/user")
        .header("authorization", format!("token {token}"))
        .header("editor-version", "uxnan/1.0")
        .header("editor-plugin-version", "uxnan/1.0")
        .header("x-github-api-version", "2025-04-01")
        .header("accept", "application/json");
    let body = match fetch_json(req).await {
        Ok(v) => v,
        Err(e) => return http_error(UsageProvider::Copilot, e),
    };

    let mut usage = ProviderUsage::base(UsageProvider::Copilot, UsageStatus::Ok);
    usage.source = Some(UsageSource::Token);
    let copilot_plan = body.get("copilot_plan").and_then(|v| v.as_str());
    let plan = copilot_plan.map(prettify_plan);
    let account_type = copilot_plan.map(classify_plan);
    // Identity: the GitHub login, from the official /user endpoint (same token).
    let email = github_login(&client, &token).await;
    usage = usage.with_account(Account {
        email,
        plan,
        account_type,
        ..Default::default()
    });

    let reset = body.get("quota_reset_date").and_then(epoch_ms);
    if let Some(snaps) = body.get("quota_snapshots").and_then(|v| v.as_object()) {
        for (key, snap) in snaps {
            if snap.get("unlimited").and_then(|v| v.as_bool()) == Some(true) {
                continue;
            }
            let remaining_pct = snap
                .get("percent_remaining")
                .and_then(number)
                .unwrap_or(0.0);
            usage.windows.push(UsageWindow {
                id: key.clone(),
                label: prettify_plan(key),
                used_percent: clamp_pct(100.0 - remaining_pct),
                window_minutes: None,
                resets_at: reset,
            });
        }
    }

    if usage.windows.is_empty() {
        usage = usage.with_message("signed in, but no Copilot quota was returned for this account");
    }
    usage
}

/// The GitHub token the Copilot CLI uses, via `gh auth token`. `None` when gh is
/// absent or reports no token.
async fn gh_auth_token() -> Option<String> {
    let output = tokio::process::Command::new("gh")
        .args(["auth", "token"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// The authenticated GitHub login, via the official `/user` endpoint using the
/// same token. Best-effort (identity label only); `None` on any failure.
async fn github_login(client: &reqwest::Client, token: &str) -> Option<String> {
    let req = client
        .get("https://api.github.com/user")
        .header("authorization", format!("token {token}"))
        .header("accept", "application/json")
        .header("x-github-api-version", "2022-11-28");
    let body = fetch_json(req).await.ok()?;
    body.get("login")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

// --- Gemini -----------------------------------------------------------------

async fn read_gemini(home: &Path) -> ProviderUsage {
    let creds_path = home.join(".gemini").join("oauth_creds.json");
    let Some(creds) = read_json(&creds_path) else {
        return ProviderUsage::base(UsageProvider::Gemini, UsageStatus::NotInstalled)
            .with_message("Gemini CLI is not signed in (~/.gemini/oauth_creds.json missing)");
    };
    let Some(token) = creds.get("access_token").and_then(|v| v.as_str()) else {
        return ProviderUsage::base(UsageProvider::Gemini, UsageStatus::AuthRequired)
            .with_message("Gemini CLI has no access token");
    };
    // Identity comes from the id_token JWT (no network needed).
    let email = creds
        .get("id_token")
        .and_then(|v| v.as_str())
        .and_then(jwt_email);

    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return errored(UsageProvider::Gemini, e),
    };
    // Best-effort: call the quota endpoint with the stored access token. We do
    // NOT refresh via harvested client secrets (fragile + provider-specific), so
    // an expired token degrades to `authRequired` rather than silently failing.
    let req = client
        .post("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota")
        .bearer_auth(token)
        .header("content-type", "application/json")
        .body("{}".to_string());
    let body = match fetch_json(req).await {
        Ok(v) => v,
        Err(HttpError::Unauthorized) => {
            return ProviderUsage::base(UsageProvider::Gemini, UsageStatus::AuthRequired)
                .with_account(Account {
                    email,
                    ..Default::default()
                })
                .with_message("Gemini access token expired — re-run the Gemini CLI to refresh it");
        }
        Err(e) => {
            return http_error(UsageProvider::Gemini, e).with_account(Account {
                email,
                ..Default::default()
            });
        }
    };

    let mut usage = ProviderUsage::base(UsageProvider::Gemini, UsageStatus::Ok);
    usage.source = Some(UsageSource::Token);
    usage = usage.with_account(Account {
        email,
        ..Default::default()
    });

    // `buckets[]` carry a remaining fraction per model; keep the lowest per model.
    if let Some(buckets) = body.get("buckets").and_then(|v| v.as_array()) {
        for (i, b) in buckets.iter().enumerate() {
            let remaining = b
                .get("remaining_fraction")
                .or_else(|| b.get("remainingFraction"))
                .and_then(number);
            if let Some(remaining) = remaining {
                let model = b
                    .get("model_id")
                    .or_else(|| b.get("modelId"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Quota")
                    .to_string();
                let resets_at = b
                    .get("reset_time")
                    .or_else(|| b.get("resetTime"))
                    .and_then(epoch_ms);
                usage.windows.push(UsageWindow {
                    id: format!("bucket{i}"),
                    label: model,
                    used_percent: clamp_pct((1.0 - remaining) * 100.0),
                    window_minutes: Some(1440),
                    resets_at,
                });
            }
        }
    }

    if usage.windows.is_empty() {
        usage = usage.with_message("signed in, but the quota API returned no buckets");
    }
    usage
}

// --- Shared helpers ---------------------------------------------------------

/// A distinct HTTP failure so callers can map 401 → `authRequired`.
enum HttpError {
    Unauthorized,
    Other(String),
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("uxnan-desktop")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Send a request and parse a JSON body, mapping 401/403 to `Unauthorized`.
async fn fetch_json(req: reqwest::RequestBuilder) -> Result<serde_json::Value, HttpError> {
    let resp = req
        .send()
        .await
        .map_err(|e| HttpError::Other(e.to_string()))?;
    let status = resp.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(HttpError::Unauthorized);
    }
    let text = resp
        .text()
        .await
        .map_err(|e| HttpError::Other(e.to_string()))?;
    if !status.is_success() {
        return Err(HttpError::Other(format!("HTTP {}", status.as_u16())));
    }
    serde_json::from_str(&text).map_err(|e| HttpError::Other(format!("invalid JSON: {e}")))
}

fn http_error(provider: UsageProvider, err: HttpError) -> ProviderUsage {
    match err {
        HttpError::Unauthorized => ProviderUsage::base(provider, UsageStatus::AuthRequired)
            .with_message("the stored token was rejected — sign in again with the CLI"),
        HttpError::Other(msg) => {
            ProviderUsage::base(provider, UsageStatus::Error).with_message(msg)
        }
    }
}

fn errored(provider: UsageProvider, msg: impl Into<String>) -> ProviderUsage {
    ProviderUsage::base(provider, UsageStatus::Error).with_message(msg)
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Build a window from a value carrying `used_percent` + `reset_at` +
/// `limit_window_seconds` (the Codex shape), with a fallback window length.
fn window_from_value(
    id: &str,
    label: &str,
    w: &serde_json::Value,
    min_default: Option<u32>,
) -> Option<UsageWindow> {
    let pct = w
        .get("used_percent")
        .or_else(|| w.get("usedPercent"))
        .and_then(number)?;
    let resets_at = w
        .get("reset_at")
        .or_else(|| w.get("resetAt"))
        .or_else(|| w.get("resets_at"))
        .and_then(epoch_ms);
    let minutes = w
        .get("limit_window_seconds")
        .or_else(|| w.get("limitWindowSeconds"))
        .and_then(number)
        .map(|s| (s / 60.0) as u32)
        .or(min_default);
    Some(UsageWindow {
        id: id.to_string(),
        label: label.to_string(),
        used_percent: clamp_pct(if pct <= 1.0 { pct * 100.0 } else { pct }),
        window_minutes: minutes,
        resets_at,
    })
}

fn credit_from_value(v: &serde_json::Value, period: &str) -> Option<CreditBalance> {
    let used = v
        .get("used")
        .or_else(|| v.get("balance"))
        .or_else(|| v.get("used_credits"))
        .and_then(number)?;
    let limit = v.get("limit").or_else(|| v.get("total")).and_then(number);
    let currency = v
        .get("currency")
        .and_then(|c| c.as_str())
        .unwrap_or("USD")
        .to_string();
    let resets_at = v
        .get("resets_at")
        .or_else(|| v.get("resetAt"))
        .and_then(epoch_ms);
    Some(CreditBalance {
        used,
        limit,
        currency,
        period: period.to_string(),
        resets_at,
        available: None,
    })
}

/// Number from a JSON value that may be a real number or a numeric string.
fn number(v: &serde_json::Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

/// Normalize a reset value to epoch milliseconds. Accepts a number (epoch
/// seconds or milliseconds — Codex) or an ISO-8601 datetime string (Claude).
fn epoch_ms(v: &serde_json::Value) -> Option<i64> {
    if let Some(s) = v.as_str() {
        if let Some(ms) = parse_iso8601_ms(s) {
            return Some(ms);
        }
    }
    let n = number(v)?;
    if n <= 0.0 {
        return None;
    }
    // ≥ ~2001 in ms, or seconds otherwise.
    Some(if n > 1e12 {
        n as i64
    } else {
        (n * 1000.0) as i64
    })
}

/// Parse an ISO-8601 / RFC-3339 datetime ("2026-07-07T18:00:00.000Z" or with a
/// "+HH:MM" offset) to epoch milliseconds, without a date-time dependency. Uses
/// Howard Hinnant's days-from-civil algorithm; returns `None` on any malformed
/// field.
fn parse_iso8601_ms(s: &str) -> Option<i64> {
    if s.len() < 19 {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let min: i64 = s.get(14..16)?.parse().ok()?;
    let sec: i64 = s.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    // days_from_civil (Hinnant): civil date → days since 1970-01-01 (UTC).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12; // Mar=0 … Feb=11
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let mut epoch = days * 86400 + hour * 3600 + min * 60 + sec;
    // A trailing "+HH:MM" / "-HH:MM" offset (anything past the date) shifts to UTC;
    // a "Z" (or none) is already UTC.
    if let Some(idx) = s.rfind(['+', '-']).filter(|&i| i > 10) {
        let sign = if &s[idx..=idx] == "+" { 1 } else { -1 };
        let oh: i64 = s.get(idx + 1..idx + 3)?.parse().ok()?;
        let om: i64 = s
            .get(idx + 4..idx + 6)
            .and_then(|x| x.parse().ok())
            .unwrap_or(0);
        epoch -= sign * (oh * 3600 + om * 60);
    }
    Some(epoch * 1000)
}

/// A truthful label for a window given its length in minutes (Codex reports a
/// window length, not a fixed name — a "go" plan's primary window is monthly).
fn label_for_minutes(minutes: Option<u32>) -> String {
    match minutes {
        Some(m) if m <= 60 => format!("{m}m window"),
        Some(300) => "Session (5h)".to_string(),
        Some(1440) => "Daily".to_string(),
        Some(10080) => "Weekly".to_string(),
        Some(43200) => "Monthly".to_string(),
        Some(m) => format!("{}h window", m / 60),
        None => "Usage".to_string(),
    }
}

fn clamp_pct(p: f64) -> f64 {
    p.clamp(0.0, 100.0)
}

/// Turn an identifier/plan slug ("chatgpt_pro", "premium_interactions") into a
/// readable label ("Chatgpt Pro", "Premium Interactions").
fn prettify_plan(s: &str) -> String {
    s.split(['_', '-', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extract the `email` claim from a JWT's payload without verifying it (used only
/// for display; the token is the CLI's own).
fn jwt_email(jwt: &str) -> Option<String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let payload = jwt.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    json.get("email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prettify_plan_titlecases_slugs() {
        assert_eq!(prettify_plan("chatgpt_pro"), "Chatgpt Pro");
        assert_eq!(
            prettify_plan("premium-interactions"),
            "Premium Interactions"
        );
        assert_eq!(prettify_plan("max"), "Max");
    }

    #[test]
    fn epoch_ms_normalizes_seconds_and_millis() {
        assert_eq!(
            epoch_ms(&serde_json::json!(1_700_000_000)),
            Some(1_700_000_000_000)
        );
        assert_eq!(
            epoch_ms(&serde_json::json!(1_700_000_000_000i64)),
            Some(1_700_000_000_000)
        );
        assert_eq!(epoch_ms(&serde_json::json!(0)), None);
    }

    #[test]
    fn clamp_pct_bounds() {
        assert_eq!(clamp_pct(-5.0), 0.0);
        assert_eq!(clamp_pct(140.0), 100.0);
        assert_eq!(clamp_pct(42.5), 42.5);
    }

    #[test]
    fn detect_present_filters_missing() {
        // A bogus home has none of the providers present.
        let empty = std::path::Path::new("/nonexistent-uxnan-home-xyz");
        assert!(!is_present(UsageProvider::Codex, empty));
        assert!(!is_present(UsageProvider::Gemini, empty));
        assert!(!is_present(UsageProvider::Grok, empty));
    }

    #[test]
    fn parse_iso8601_ms_handles_utc_and_offsets() {
        // 2026-07-07T18:00:00Z == 1_783_447_200_000 ms.
        assert_eq!(
            parse_iso8601_ms("2026-07-07T18:00:00.000Z"),
            Some(1_783_447_200_000)
        );
        // Same instant expressed with a +02:00 offset (local 20:00).
        assert_eq!(
            parse_iso8601_ms("2026-07-07T20:00:00+02:00"),
            Some(1_783_447_200_000)
        );
        assert_eq!(parse_iso8601_ms("not-a-date"), None);
        // epoch_ms also accepts the ISO string form.
        assert_eq!(
            epoch_ms(&serde_json::json!("2026-07-07T18:00:00Z")),
            Some(1_783_447_200_000)
        );
    }

    #[test]
    fn label_for_minutes_names_windows() {
        assert_eq!(label_for_minutes(Some(300)), "Session (5h)");
        assert_eq!(label_for_minutes(Some(10080)), "Weekly");
        assert_eq!(label_for_minutes(Some(43200)), "Monthly");
        assert_eq!(label_for_minutes(None), "Usage");
    }

    #[test]
    fn claude_limit_label_uses_model_scope() {
        assert_eq!(
            claude_limit_label("session", "session", None),
            "Session (5h)"
        );
        assert_eq!(claude_limit_label("weekly_all", "weekly", None), "Weekly");
        assert_eq!(
            claude_limit_label("weekly_scoped", "weekly", Some("Fable")),
            "Fable (weekly)"
        );
    }

    #[test]
    fn grok_period_helpers_map_known_windows() {
        let weekly = serde_json::json!({"type": "USAGE_PERIOD_TYPE_WEEKLY"});
        assert_eq!(grok_period_label(Some(&weekly)), "Weekly");
        assert_eq!(grok_period_minutes(Some(&weekly)), Some(10080));
        assert_eq!(grok_period_label(None), "Usage");
        assert_eq!(grok_period_minutes(None), None);
    }

    #[test]
    fn classify_plan_maps_keywords() {
        assert_eq!(classify_plan("chatgpt_pro"), AccountType::Subscription);
        assert_eq!(classify_plan("max"), AccountType::Subscription);
        assert_eq!(classify_plan("free"), AccountType::Free);
        assert_eq!(classify_plan("business"), AccountType::Team);
        assert_eq!(classify_plan("team"), AccountType::Team);
        assert_eq!(classify_plan("Enterprise"), AccountType::Enterprise);
    }

    #[test]
    fn parse_reset_credits_handles_shapes() {
        // A bare count.
        assert_eq!(
            parse_reset_credits(&serde_json::json!(3))
                .unwrap()
                .available,
            3
        );
        assert!(parse_reset_credits(&serde_json::json!(0)).is_none());
        // An object with credits[]: earliest available expiry wins; consumed ignored.
        let v = serde_json::json!({
            "available_count": 2, "total_earned_count": 5,
            "credits": [
                {"status":"available","expires_at": 1_700_000_100i64},
                {"status":"available","expires_at": 1_700_000_000i64},
                {"status":"consumed","expires_at": 1}
            ]
        });
        let rc = parse_reset_credits(&v).unwrap();
        assert_eq!(rc.available, 2);
        assert_eq!(rc.total_earned, Some(5));
        assert_eq!(rc.next_expires_at, Some(1_700_000_000_000));
        // Per-credit entries: only the available ones, soonest-expiring first.
        let entries = rc.entries.as_ref().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].expires_at, Some(1_700_000_000_000));
        assert_eq!(entries[1].expires_at, Some(1_700_000_100_000));
        // Nothing meaningful → None.
        assert!(parse_reset_credits(&serde_json::json!({"available_count":0})).is_none());
    }

    #[test]
    fn grok_credit_from_ondemand_and_prepaid() {
        // On-demand: used vs cap, with derived available.
        let c = grok_credit(Some(4.0), Some(10.0), None).unwrap();
        assert_eq!(c.used, 4.0);
        assert_eq!(c.limit, Some(10.0));
        assert_eq!(c.available, Some(6.0));
        assert_eq!(c.period, "On-demand");
        // Prepaid balance only.
        let p = grok_credit(None, None, Some(25.0)).unwrap();
        assert_eq!(p.available, Some(25.0));
        assert_eq!(p.period, "Prepaid");
        // Nothing to show.
        assert!(grok_credit(None, None, None).is_none());
        assert!(grok_credit(Some(0.0), Some(0.0), None).is_none());
    }

    #[test]
    fn grok_money_unwraps_objects() {
        assert_eq!(grok_money(Some(&serde_json::json!(4.5))), Some(4.5));
        assert_eq!(
            grok_money(Some(&serde_json::json!({"val": 7.0}))),
            Some(7.0)
        );
        assert_eq!(
            grok_money(Some(&serde_json::json!({"amount": "3.2"}))),
            Some(3.2)
        );
        assert_eq!(grok_money(None), None);
    }
}
