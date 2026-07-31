//! Local resource observability — CPU / memory / process attribution for uxnan
//! itself, its terminals and the agents running inside them.
//!
//! This is **not** telemetry and **not** a general task manager: the collector
//! only ever classifies the desktop process tree and the subtrees uxnan spawned
//! (PTY shells and whatever runs inside them), answering "what is consuming
//! resources on my behalf, and did anything outlive its owner?". Attribution is
//! evidence-based — pid + start time + parent chain plus the explicit PTY links
//! registered at spawn — and every figure carries a confidence
//! (`exact` / `inferred` / `unknown`) instead of pretending precision.
//!
//! Deliberate boundaries, mirrored by the tests:
//!
//! - **Demand-driven sampling.** The sampler is fully parked (no timer, no
//!   process-table walks, no retained `sysinfo` state) unless a consumer exists:
//!   the backend popover (1–2 s), a budget consumer (2–5 s, reserved for the
//!   future limits/orchestration engine) or the opt-in orphan sweep (15–30 s).
//!   Parked must cost nothing observable.
//! - **No content inspection.** Command lines, environment, sockets and file
//!   paths of processes are never read here (identity comes from pids and the
//!   registered links; the agent *name* comes from the existing detector). The
//!   UI never receives a command line, and the export sanitizes every id.
//! - **Absent data is never zero.** A metric the platform (or the first tick)
//!   cannot provide is `None`, not `0`.
//! - **Bounded memory.** Aggregated frames live in a circular buffer capped at
//!   ~10 minutes; nothing per-process is persisted.

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::{broadcast, Notify};

// --- cadence & retention constants ------------------------------------------

/// Sampling interval while the backend popover is open (the "live" view).
pub const POPOVER_INTERVAL: Duration = Duration::from_secs(2);
/// Sampling interval while a budget/orchestration consumer is subscribed.
pub const BUDGET_INTERVAL: Duration = Duration::from_secs(3);
/// Allowed band for the opt-in background orphan sweep (seconds).
pub const SWEEP_MIN_SECS: u32 = 15;
pub const SWEEP_MAX_SECS: u32 = 30;
/// How much aggregated history the circular buffer retains (seconds).
const BUFFER_MAX_SECONDS: u64 = 600;
/// Hard frame-count cap for the buffer (safety net alongside the time cap).
const BUFFER_MAX_FRAMES: usize = 640;
/// Window for the "short average" statistics (ms).
const SHORT_WINDOW_MS: u64 = 60_000;
/// A group missing from the latest frame is still reported as `ended` for this
/// long after its last appearance (ms).
const ENDED_WINDOW_MS: u64 = 90_000;
/// A UI subscription (lease) expires this long after its last renewal, so a
/// webview reload that never unsubscribed cannot pin the fast cadence forever.
const LEASE_TTL_MS: u64 = 90_000;
/// Closed-terminal links whose identity cannot be verified (no start time) are
/// dropped after this long instead of reporting an unverifiable orphan forever.
const ORPHAN_UNVERIFIED_RETENTION_MS: u64 = 600_000;
/// Start times within this many seconds count as the same process (different
/// clocks truncate the boot-relative arithmetic differently).
const START_TIME_TOLERANCE_SECS: u64 = 2;
/// A gap between frames larger than this many × the interval invalidates the
/// tick's rate metrics (CPU %, I/O per second) — they would average over the
/// parked window and publish a number no user ever saw.
const GAP_FACTOR: u32 = 3;
/// Export document schema version.
const EXPORT_SCHEMA_VERSION: u32 = 1;

/// Epoch milliseconds now.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// --- contract types ----------------------------------------------------------

/// Who a measured process (or aggregate) belongs to. `Bridge` and `Browser` are
/// reserved for the embedded bridge / the integrated browser once either owns
/// processes distinguishable without reading command lines; nothing produces
/// them yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceOwnerKind {
    Desktop,
    Workspace,
    Terminal,
    Agent,
    Bridge,
    Browser,
    Unknown,
}

/// How sure the attribution is. `Exact` = pid + start time verified against the
/// registered link; `Inferred` = parent-chain evidence below a verified root;
/// `Unknown` = identity could not be verified (e.g. a recycled pid).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttributionConfidence {
    Exact,
    Inferred,
    Unknown,
}

/// Direction of a group's memory over the buffered window.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Trend {
    Rising,
    Falling,
    Steady,
    #[default]
    Unknown,
}

/// What kind of consumer holds a sampling lease (drives the cadence).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsumerKind {
    /// The backend-popover live view (fast cadence, short-lived).
    Popover,
    /// A budget/limits or orchestration consumer (reserved; medium cadence).
    Budget,
}

/// Which metrics this build/platform can provide. `validated` is the honest
/// flag for "measured on real hardware": only Windows so far — the other
/// platforms run the same portable `sysinfo` code but their figures have not
/// been checked against reality, so surfaces should say "best effort".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceCapabilities {
    pub cpu: bool,
    pub memory: bool,
    pub virtual_memory: bool,
    pub io: bool,
    pub start_time: bool,
    pub validated: bool,
}

/// Capabilities of the running build.
pub fn capabilities() -> ResourceCapabilities {
    ResourceCapabilities {
        cpu: true,
        memory: true,
        virtual_memory: true,
        // sysinfo has no per-process I/O counters on the BSDs; everywhere else
        // it reads them (validated on Windows only — see `validated`).
        io: cfg!(any(
            target_os = "windows",
            target_os = "linux",
            target_os = "macos"
        )),
        start_time: true,
        validated: cfg!(target_os = "windows"),
    }
}

/// One process's facts for a single tick, as read from the OS. Deliberately
/// name-free: identity is the pid + start time, ownership is the parent chain.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProcRow {
    pub parent: Option<u32>,
    /// Process start time (seconds since epoch); `None` when the platform
    /// reports nothing (a raw `0` from the OS is mapped to `None`, never kept).
    pub start_time_secs: Option<u64>,
    /// CPU since the previous refresh, normalized to the whole machine (0–100).
    /// `None` on a process's first sighting — sysinfo reports `0.0` there, and
    /// absent data must not masquerade as an idle process.
    pub cpu_percent: Option<f32>,
    pub resident_bytes: u64,
    pub virtual_bytes: u64,
    /// Cumulative I/O totals (bytes), when the platform reports them.
    pub io_read_total: Option<u64>,
    pub io_write_total: Option<u64>,
}

/// The process table for one tick: pid → facts.
pub type ProcTable = HashMap<u32, ProcRow>;

/// Point-in-time metrics for one owner group. Every field that can be unknown
/// is an `Option`: a `None` renders as "—", never as zero.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSample {
    pub processes: u32,
    pub cpu_percent: Option<f32>,
    pub resident_bytes: Option<u64>,
    pub virtual_bytes: Option<u64>,
    pub io_read_bytes_per_sec: Option<f64>,
    pub io_write_bytes_per_sec: Option<f64>,
}

/// One owner group's aggregate within a single frame.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSample {
    pub kind: ResourceOwnerKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// The workspace an agent/terminal group belongs to, for grouping in the UI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    pub confidence: AttributionConfidence,
    #[serde(flatten)]
    pub metrics: MetricSample,
}

/// A subtree that outlived its closed owner, still alive on this tick.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanSample {
    pub kind: ResourceOwnerKind,
    pub id: String,
    pub pids: Vec<u32>,
    pub cpu_percent: Option<f32>,
    pub resident_bytes: Option<u64>,
    /// When the owner went away (epoch ms).
    pub since_ms: u64,
    pub confidence: AttributionConfidence,
}

/// One aggregated tick kept in the circular buffer. Never persisted.
#[derive(Debug, Clone)]
struct Frame {
    at_ms: u64,
    total: MetricSample,
    groups: Vec<GroupSample>,
    orphans: Vec<OrphanSample>,
}

/// Instant + short-average + peak + trend for one series, over the buffer.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSummary {
    pub processes: u32,
    pub cpu_percent: Option<f32>,
    pub cpu_avg_percent: Option<f32>,
    pub cpu_peak_percent: Option<f32>,
    pub resident_bytes: Option<u64>,
    pub resident_avg_bytes: Option<u64>,
    pub resident_peak_bytes: Option<u64>,
    pub virtual_bytes: Option<u64>,
    pub io_read_bytes_per_sec: Option<f64>,
    pub io_write_bytes_per_sec: Option<f64>,
    pub trend: Trend,
}

/// One owner group as the UI consumes it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub kind: ResourceOwnerKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    pub confidence: AttributionConfidence,
    /// The group vanished from the latest frame (its processes ended) but is
    /// still shown briefly so a just-finished agent doesn't silently disappear.
    pub ended: bool,
    #[serde(flatten)]
    pub metrics: MetricSummary,
}

/// Whether/why/how fast the sampler is running right now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SamplingState {
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_ms: Option<u64>,
    /// `"popover"` | `"budget"` | `"orphanSweep"` | `"off"`.
    pub reason: &'static str,
}

/// The consolidated document the UI (and the internal event stream) consumes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSummary {
    pub enabled: bool,
    pub capabilities: ResourceCapabilities,
    pub sampling: SamplingState,
    /// Time of the newest buffered frame; `None` = nothing sampled yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at_ms: Option<u64>,
    pub buffer_seconds: u32,
    /// Everything attributed to uxnan (desktop + terminals + agents) combined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<MetricSummary>,
    pub groups: Vec<GroupSummary>,
    pub orphans: Vec<OrphanSample>,
    /// Registered live terminal links (context for the UI).
    pub terminals_linked: u32,
}

// --- monitor configuration & registry ---------------------------------------

/// Runtime configuration, derived from [`crate::model::ResourceSettings`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorConfig {
    pub enabled: bool,
    pub orphan_sweep: bool,
    /// Clamped to [`SWEEP_MIN_SECS`]–[`SWEEP_MAX_SECS`].
    pub sweep_secs: u32,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            orphan_sweep: false,
            sweep_secs: 20,
        }
    }
}

impl From<&crate::model::ResourceSettings> for MonitorConfig {
    fn from(s: &crate::model::ResourceSettings) -> Self {
        Self {
            enabled: s.enabled,
            orphan_sweep: s.orphan_sweep,
            sweep_secs: s.orphan_sweep_seconds.clamp(SWEEP_MIN_SECS, SWEEP_MAX_SECS),
        }
    }
}

/// A live PTY link, registered at spawn: the explicit ownership evidence.
#[derive(Debug, Clone)]
struct TerminalLink {
    pid: u32,
    start_time_secs: Option<u64>,
    workspace: Option<String>,
    /// Agent command detected in this terminal (from the existing foreground
    /// detector), if any. Advisory: it refines the owner *kind*, not identity.
    agent: Option<String>,
    /// A later sample saw a different process under this pid (start-time
    /// mismatch): the link's evidence is void and its group reports `unknown`.
    recycled: bool,
}

/// A closed terminal remembered so its survivors can be detected. Members are
/// (pid, start time) pairs snapshotted from the last attribution before close.
#[derive(Debug, Clone)]
struct ClosedLink {
    kind: ResourceOwnerKind,
    id: String,
    members: Vec<(u32, Option<u64>)>,
    closed_at_ms: u64,
}

/// A consumer's sampling lease (renewed while its surface is open).
#[derive(Debug, Clone, Copy)]
struct Lease {
    kind: ConsumerKind,
    expires_at_ms: u64,
}

/// Per-pid state carried between ticks: identity + I/O totals for deltas.
#[derive(Debug, Clone, Copy)]
struct PrevSeen {
    start_time_secs: Option<u64>,
    io_read_total: Option<u64>,
    io_write_total: Option<u64>,
}

#[derive(Debug, Default)]
struct MonitorState {
    config: MonitorConfig,
    terminals: HashMap<String, TerminalLink>,
    closed: Vec<ClosedLink>,
    leases: HashMap<String, Lease>,
    frames: VecDeque<Frame>,
    /// pid → (start time, owner) from the newest attribution; feeds the member
    /// snapshot a closing terminal takes.
    last_attribution: HashMap<u32, (Option<u64>, OwnerRef)>,
    /// pid → previous identity + I/O totals (drives deltas; cleared on park).
    prev: HashMap<u32, PrevSeen>,
    last_frame_at_ms: Option<u64>,
    last_interval_ms: Option<u64>,
}

/// Who one process belongs to, resolved by [`attribute`].
#[derive(Debug, Clone, PartialEq)]
enum OwnerRef {
    Desktop {
        confidence: AttributionConfidence,
    },
    Terminal {
        pty_id: String,
        workspace: Option<String>,
        confidence: AttributionConfidence,
    },
    Agent {
        command: String,
        workspace: Option<String>,
        confidence: AttributionConfidence,
    },
}

// --- the monitor -------------------------------------------------------------

/// Owns the registry, the leases, the circular buffer and the derived
/// summaries. All methods lock briefly and never across an await.
pub struct ResourceMonitor {
    state: Mutex<MonitorState>,
    /// Wakes the sampler when the cadence may have changed (config, leases).
    notify: Notify,
    /// Internal event stream for future Rust-side consumers (budget engine,
    /// orchestration): every ingested frame's summary is broadcast here.
    events: broadcast::Sender<ResourceSummary>,
}

impl ResourceMonitor {
    pub fn new(config: MonitorConfig) -> Arc<Self> {
        let (events, _) = broadcast::channel(8);
        Arc::new(Self {
            state: Mutex::new(MonitorState {
                config,
                ..MonitorState::default()
            }),
            notify: Notify::new(),
            events,
        })
    }

    /// Apply new settings; wakes the sampler only when the config changed.
    pub fn apply_settings(&self, settings: &crate::model::ResourceSettings) {
        let next = MonitorConfig::from(settings);
        let changed = {
            let mut state = self.state.lock().unwrap();
            let changed = state.config != next;
            state.config = next;
            changed
        };
        if changed {
            self.notify.notify_waiters();
        }
    }

    /// Subscribe to the internal per-frame summary stream (Rust-side consumers).
    pub fn subscribe_events(&self) -> broadcast::Receiver<ResourceSummary> {
        self.events.subscribe()
    }

    /// Wait until the cadence may have changed.
    pub async fn changed(&self) {
        self.notify.notified().await;
    }

    // --- registry -------------------------------------------------------------

    /// Register a live terminal (called right after the PTY spawns). The start
    /// time should come from a one-shot probe of that pid; `None` degrades the
    /// link's confidence to `inferred` instead of failing.
    pub fn register_terminal(
        &self,
        pty_id: &str,
        pid: u32,
        start_time_secs: Option<u64>,
        workspace: Option<String>,
    ) {
        let mut state = self.state.lock().unwrap();
        state.terminals.insert(
            pty_id.to_string(),
            TerminalLink {
                pid,
                start_time_secs,
                workspace,
                agent: None,
                recycled: false,
            },
        );
    }

    /// Record (or clear) the agent detected in a terminal. Advisory — refines
    /// the owner kind of that subtree's processes on the next tick.
    pub fn set_terminal_agent(&self, pty_id: &str, agent: Option<String>) {
        let mut state = self.state.lock().unwrap();
        if let Some(link) = state.terminals.get_mut(pty_id) {
            link.agent = agent;
        }
    }

    /// A terminal closed: move its link to the closed list with a member
    /// snapshot (from the last attribution), so survivors show up as orphans.
    pub fn terminal_closed(&self, pty_id: &str, now_ms: u64) {
        let mut state = self.state.lock().unwrap();
        let Some(link) = state.terminals.remove(pty_id) else {
            return;
        };
        let mut members: Vec<(u32, Option<u64>)> = state
            .last_attribution
            .iter()
            .filter(|(_, (_, owner))| owner_is_terminal(owner, pty_id))
            .map(|(pid, (start, _))| (*pid, *start))
            .collect();
        if !members.iter().any(|(pid, _)| *pid == link.pid) {
            members.push((link.pid, link.start_time_secs));
        }
        let (kind, id) = match &link.agent {
            Some(agent) => (ResourceOwnerKind::Agent, agent.clone()),
            None => (ResourceOwnerKind::Terminal, pty_id.to_string()),
        };
        state.closed.push(ClosedLink {
            kind,
            id,
            members,
            closed_at_ms: now_ms,
        });
    }

    // --- leases ---------------------------------------------------------------

    /// Take or renew a sampling lease. Leases expire on their own (TTL), so a
    /// consumer that vanished without unsubscribing cannot pin the cadence.
    pub fn subscribe(&self, token: &str, kind: ConsumerKind, now_ms: u64) {
        {
            let mut state = self.state.lock().unwrap();
            state.leases.insert(
                token.to_string(),
                Lease {
                    kind,
                    expires_at_ms: now_ms + LEASE_TTL_MS,
                },
            );
        }
        self.notify.notify_waiters();
    }

    /// Release a sampling lease (idempotent).
    pub fn unsubscribe(&self, token: &str) {
        let removed = self.state.lock().unwrap().leases.remove(token).is_some();
        if removed {
            self.notify.notify_waiters();
        }
    }

    /// The interval + reason the sampler should run at, or `None` = fully
    /// parked. Prunes expired leases as a side effect.
    pub fn cadence(&self, now_ms: u64) -> Option<(Duration, &'static str)> {
        let mut state = self.state.lock().unwrap();
        state.leases.retain(|_, lease| lease.expires_at_ms > now_ms);
        resolve_cadence(
            state.config,
            state.leases.values().map(|l| l.kind).collect::<Vec<_>>(),
        )
    }

    /// Drop everything only sampling needs (delta state, the OS handle is the
    /// caller's), so a parked collector holds no per-process state at all.
    pub fn clear_transient(&self) {
        let mut state = self.state.lock().unwrap();
        state.prev.clear();
        state.last_frame_at_ms = None;
        state.last_interval_ms = None;
    }

    // --- sampling pipeline ----------------------------------------------------

    /// Ingest one process table: attribute, compute deltas, detect orphans,
    /// push the aggregated frame into the buffer and return the fresh summary
    /// (also broadcast to internal subscribers).
    pub fn ingest(&self, now_ms: u64, desktop_pid: u32, table: ProcTable) -> ResourceSummary {
        let mut state = self.state.lock().unwrap();
        let interval_ms = self
            .cadence_locked(&mut state, now_ms)
            .map(|(d, _)| d.as_millis() as u64);

        // A gap (parked window, missed ticks) invalidates rate metrics.
        let gap = match (state.last_frame_at_ms, interval_ms) {
            (Some(last), Some(interval)) => {
                now_ms.saturating_sub(last) > interval * GAP_FACTOR as u64
            }
            _ => true,
        };
        let elapsed_secs = state
            .last_frame_at_ms
            .map(|last| (now_ms.saturating_sub(last)) as f64 / 1000.0)
            .filter(|s| *s > 0.0);

        // Per-pid deltas + first-sight / identity rules.
        let mut rows: HashMap<u32, ProcRow> = HashMap::with_capacity(table.len());
        for (pid, mut row) in table {
            let prev = state.prev.get(&pid).copied();
            let same_identity = prev
                .map(|p| start_times_match(p.start_time_secs, row.start_time_secs))
                .unwrap_or(false);
            if gap || !same_identity {
                row.cpu_percent = None;
            }
            let (read_ps, write_ps) = if gap || !same_identity {
                (None, None)
            } else {
                (
                    io_rate(
                        prev.and_then(|p| p.io_read_total),
                        row.io_read_total,
                        elapsed_secs,
                    ),
                    io_rate(
                        prev.and_then(|p| p.io_write_total),
                        row.io_write_total,
                        elapsed_secs,
                    ),
                )
            };
            // Reuse the total fields to carry the computed per-second rates into
            // aggregation (the totals themselves never leave this function).
            let io_read_total = row.io_read_total;
            let io_write_total = row.io_write_total;
            state.prev.insert(
                pid,
                PrevSeen {
                    start_time_secs: row.start_time_secs,
                    io_read_total,
                    io_write_total,
                },
            );
            row.io_read_total = read_ps.map(|v| v as u64);
            row.io_write_total = write_ps.map(|v| v as u64);
            rows.insert(pid, row);
        }
        state.prev.retain(|pid, _| rows.contains_key(pid));

        // Attribution over the delta-adjusted table.
        let (attribution, recycled) = attribute(&rows, desktop_pid, &state.terminals);
        for pty_id in &recycled {
            if let Some(link) = state.terminals.get_mut(pty_id) {
                link.recycled = true;
            }
        }
        let (total, groups) = aggregate(&rows, &attribution, &state.terminals);

        // Orphans: closed links whose members are still alive.
        let orphans = check_orphans(&mut state.closed, &rows, now_ms);

        state.last_attribution = attribution
            .into_iter()
            .map(|(pid, owner)| {
                let start = rows.get(&pid).and_then(|r| r.start_time_secs);
                (pid, (start, owner))
            })
            .collect();

        state.frames.push_back(Frame {
            at_ms: now_ms,
            total,
            groups,
            orphans,
        });
        trim_frames(&mut state.frames, now_ms);
        state.last_frame_at_ms = Some(now_ms);
        state.last_interval_ms = interval_ms;

        let summary = build_summary(&state, now_ms);
        drop(state);
        let _ = self.events.send(summary.clone());
        summary
    }

    /// The current summary from buffered frames (no fresh sample).
    pub fn summary(&self, now_ms: u64) -> ResourceSummary {
        let mut state = self.state.lock().unwrap();
        state.leases.retain(|_, lease| lease.expires_at_ms > now_ms);
        build_summary(&state, now_ms)
    }

    /// The sanitized diagnostics document for a manual export.
    pub fn export(&self, now_ms: u64) -> ResourceExport {
        let state = self.state.lock().unwrap();
        let summary = build_summary(&state, now_ms);
        sanitize_export(&summary, now_ms)
    }

    fn cadence_locked(
        &self,
        state: &mut MonitorState,
        now_ms: u64,
    ) -> Option<(Duration, &'static str)> {
        state.leases.retain(|_, lease| lease.expires_at_ms > now_ms);
        resolve_cadence(
            state.config,
            state.leases.values().map(|l| l.kind).collect::<Vec<_>>(),
        )
    }
}

fn owner_is_terminal(owner: &OwnerRef, pty_id: &str) -> bool {
    match owner {
        OwnerRef::Terminal { pty_id: id, .. } => id == pty_id,
        // Agent processes still belong to the terminal that hosts them.
        OwnerRef::Agent { .. } => false,
        OwnerRef::Desktop { .. } => false,
    }
}

// --- pure pipeline stages (unit-tested) --------------------------------------

/// Resolve the sampling cadence from config + live lease kinds.
/// Priority: popover (fastest) → budget → orphan sweep → parked.
fn resolve_cadence(
    config: MonitorConfig,
    leases: Vec<ConsumerKind>,
) -> Option<(Duration, &'static str)> {
    if !config.enabled {
        return None;
    }
    if leases.contains(&ConsumerKind::Popover) {
        return Some((POPOVER_INTERVAL, "popover"));
    }
    if leases.contains(&ConsumerKind::Budget) {
        return Some((BUDGET_INTERVAL, "budget"));
    }
    if config.orphan_sweep {
        let secs = config.sweep_secs.clamp(SWEEP_MIN_SECS, SWEEP_MAX_SECS);
        return Some((Duration::from_secs(secs as u64), "orphanSweep"));
    }
    None
}

/// Whether two optional start times identify the same process. Both unknown →
/// cannot verify (treated as *not* matching for identity-sensitive paths that
/// require proof, but links without a start time are handled explicitly).
fn start_times_match(a: Option<u64>, b: Option<u64>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a.abs_diff(b) <= START_TIME_TOLERANCE_SECS,
        _ => false,
    }
}

/// Attribute every relevant process to an owner.
///
/// - Registered PTY shells claim their subtree: the shell `exact` (pid + start
///   time verified; `inferred` when the platform gave no start time), each
///   descendant `inferred`. A detected agent turns the descendants' kind into
///   `Agent`.
/// - A start-time mismatch on a link's pid = recycled pid: nothing is claimed
///   and the pty id is reported so the link can be voided.
/// - The desktop tree is everything under our own pid *minus* claimed subtrees
///   (webview/gpu helpers land here). Unrelated processes are never classified.
fn attribute(
    table: &ProcTable,
    desktop_pid: u32,
    links: &HashMap<String, TerminalLink>,
) -> (HashMap<u32, OwnerRef>, Vec<String>) {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, row) in table {
        if let Some(parent) = row.parent {
            children.entry(parent).or_default().push(*pid);
        }
    }

    let mut owners: HashMap<u32, OwnerRef> = HashMap::new();
    let mut recycled: Vec<String> = Vec::new();

    for (pty_id, link) in links {
        if link.recycled {
            continue;
        }
        let Some(row) = table.get(&link.pid) else {
            continue; // shell gone; the group will show as ended
        };
        let shell_confidence = match (link.start_time_secs, row.start_time_secs) {
            (Some(_), Some(_)) if start_times_match(link.start_time_secs, row.start_time_secs) => {
                AttributionConfidence::Exact
            }
            (Some(_), Some(_)) => {
                recycled.push(pty_id.clone());
                continue; // different process under the same pid — claim nothing
            }
            // Missing evidence on either side: attribute, but honestly.
            _ => AttributionConfidence::Inferred,
        };
        owners.insert(
            link.pid,
            OwnerRef::Terminal {
                pty_id: pty_id.clone(),
                workspace: link.workspace.clone(),
                confidence: shell_confidence,
            },
        );
        // Claim descendants breadth-first (cycle-safe via the owners map).
        let mut queue: Vec<u32> = children.get(&link.pid).cloned().unwrap_or_default();
        let mut seen: HashSet<u32> = HashSet::new();
        while let Some(pid) = queue.pop() {
            if !seen.insert(pid) || owners.contains_key(&pid) {
                continue;
            }
            let owner = match &link.agent {
                Some(command) => OwnerRef::Agent {
                    command: command.clone(),
                    workspace: link.workspace.clone(),
                    confidence: AttributionConfidence::Inferred,
                },
                None => OwnerRef::Terminal {
                    pty_id: pty_id.clone(),
                    workspace: link.workspace.clone(),
                    confidence: AttributionConfidence::Inferred,
                },
            };
            owners.insert(pid, owner);
            if let Some(kids) = children.get(&pid) {
                queue.extend(kids.iter().copied());
            }
        }
    }

    // Desktop tree: our pid + descendants, never descending into claimed nodes.
    if table.contains_key(&desktop_pid) {
        owners.entry(desktop_pid).or_insert(OwnerRef::Desktop {
            confidence: AttributionConfidence::Exact,
        });
        let mut queue: Vec<u32> = children.get(&desktop_pid).cloned().unwrap_or_default();
        let mut seen: HashSet<u32> = HashSet::new();
        while let Some(pid) = queue.pop() {
            if !seen.insert(pid) || owners.contains_key(&pid) {
                continue;
            }
            owners.insert(
                pid,
                OwnerRef::Desktop {
                    confidence: AttributionConfidence::Inferred,
                },
            );
            if let Some(kids) = children.get(&pid) {
                queue.extend(kids.iter().copied());
            }
        }
    }

    (owners, recycled)
}

/// I/O bytes/second from two cumulative totals, `None` when either side (or the
/// elapsed window) is unknown.
fn io_rate(
    prev_total: Option<u64>,
    now_total: Option<u64>,
    elapsed_secs: Option<f64>,
) -> Option<f64> {
    let (prev, now, secs) = (prev_total?, now_total?, elapsed_secs?);
    Some(now.saturating_sub(prev) as f64 / secs)
}

/// Fold one process's metrics into an accumulating [`MetricSample`].
/// Rate metrics stay honest: one unknown member makes the group unknown for
/// that tick (a partial sum shown as a fact would under-report).
fn fold(acc: &mut MetricSample, row: &ProcRow, any_cpu_none: &mut bool, any_io_none: &mut bool) {
    acc.processes += 1;
    match row.cpu_percent {
        Some(cpu) => *acc.cpu_percent.get_or_insert(0.0) += cpu,
        None => *any_cpu_none = true,
    }
    *acc.resident_bytes.get_or_insert(0) += row.resident_bytes;
    *acc.virtual_bytes.get_or_insert(0) += row.virtual_bytes;
    // `io_*_total` carry per-second rates at this stage (see `ingest`).
    match row.io_read_total {
        Some(v) => *acc.io_read_bytes_per_sec.get_or_insert(0.0) += v as f64,
        None => *any_io_none = true,
    }
    match row.io_write_total {
        Some(v) => *acc.io_write_bytes_per_sec.get_or_insert(0.0) += v as f64,
        None => *any_io_none = true,
    }
}

/// Aggregate attributed processes into per-owner groups + the uxnan total.
/// Recycled links contribute an explicit `unknown` group with no metrics, so
/// the UI can say "identity lost" instead of silently dropping the terminal.
fn aggregate(
    table: &ProcTable,
    owners: &HashMap<u32, OwnerRef>,
    links: &HashMap<String, TerminalLink>,
) -> (MetricSample, Vec<GroupSample>) {
    #[derive(Default)]
    struct Accum {
        metrics: MetricSample,
        confidence: Option<AttributionConfidence>,
        workspace: Option<String>,
        any_cpu_none: bool,
        any_io_none: bool,
    }
    // Group keys: desktop → (Desktop, None); terminals fold into their
    // workspace → (Workspace, path) or (Terminal, pty id) when unassigned;
    // agents → (Agent, command).
    let mut accums: HashMap<(ResourceOwnerKind, Option<String>), Accum> = HashMap::new();
    let mut total = MetricSample::default();
    let mut total_cpu_none = false;
    let mut total_io_none = false;

    for (pid, owner) in owners {
        let Some(row) = table.get(pid) else { continue };
        let (key, confidence, workspace) = match owner {
            OwnerRef::Desktop { confidence } => {
                ((ResourceOwnerKind::Desktop, None), *confidence, None)
            }
            OwnerRef::Terminal {
                pty_id,
                workspace,
                confidence,
            } => match workspace {
                Some(ws) => (
                    (ResourceOwnerKind::Workspace, Some(ws.clone())),
                    *confidence,
                    Some(ws.clone()),
                ),
                None => (
                    (ResourceOwnerKind::Terminal, Some(pty_id.clone())),
                    *confidence,
                    None,
                ),
            },
            OwnerRef::Agent {
                command,
                workspace,
                confidence,
            } => (
                (ResourceOwnerKind::Agent, Some(command.clone())),
                *confidence,
                workspace.clone(),
            ),
        };
        let acc = accums.entry(key).or_default();
        fold(
            &mut acc.metrics,
            row,
            &mut acc.any_cpu_none,
            &mut acc.any_io_none,
        );
        fold(&mut total, row, &mut total_cpu_none, &mut total_io_none);
        acc.workspace = acc.workspace.take().or(workspace);
        // A group is only as sure as its least-sure member.
        acc.confidence = Some(match acc.confidence {
            Some(existing) => weakest(existing, confidence),
            None => confidence,
        });
    }

    let finish = |mut m: MetricSample, cpu_none: bool, io_none: bool| {
        if cpu_none {
            m.cpu_percent = None;
        }
        if io_none {
            m.io_read_bytes_per_sec = None;
            m.io_write_bytes_per_sec = None;
        }
        m
    };

    let mut groups: Vec<GroupSample> = accums
        .into_iter()
        .map(|((kind, id), acc)| GroupSample {
            kind,
            id,
            workspace: acc.workspace,
            confidence: acc.confidence.unwrap_or(AttributionConfidence::Unknown),
            metrics: finish(acc.metrics, acc.any_cpu_none, acc.any_io_none),
        })
        .collect();

    // Recycled links: an explicit unknown group with no metrics (never zeros).
    for (pty_id, link) in links {
        if link.recycled {
            groups.push(GroupSample {
                kind: ResourceOwnerKind::Terminal,
                id: Some(pty_id.clone()),
                workspace: link.workspace.clone(),
                confidence: AttributionConfidence::Unknown,
                metrics: MetricSample::default(),
            });
        }
    }

    groups.sort_by(|a, b| (kind_rank(a.kind), &a.id).cmp(&(kind_rank(b.kind), &b.id)));
    (finish(total, total_cpu_none, total_io_none), groups)
}

fn weakest(a: AttributionConfidence, b: AttributionConfidence) -> AttributionConfidence {
    use AttributionConfidence::*;
    match (a, b) {
        (Unknown, _) | (_, Unknown) => Unknown,
        (Inferred, _) | (_, Inferred) => Inferred,
        (Exact, Exact) => Exact,
    }
}

fn kind_rank(kind: ResourceOwnerKind) -> u8 {
    match kind {
        ResourceOwnerKind::Desktop => 0,
        ResourceOwnerKind::Workspace => 1,
        ResourceOwnerKind::Terminal => 2,
        ResourceOwnerKind::Agent => 3,
        ResourceOwnerKind::Bridge => 4,
        ResourceOwnerKind::Browser => 5,
        ResourceOwnerKind::Unknown => 6,
    }
}

/// Which closed-link members are still alive → orphan reports. Links whose
/// members all died are dropped; unverifiable links (no start time to prove
/// identity) are dropped after a retention window instead of claiming forever.
fn check_orphans(
    closed: &mut Vec<ClosedLink>,
    table: &ProcTable,
    now_ms: u64,
) -> Vec<OrphanSample> {
    let mut orphans = Vec::new();
    closed.retain(|link| {
        let mut alive: Vec<(u32, bool)> = Vec::new(); // (pid, identity verified)
        for (pid, start) in &link.members {
            let Some(row) = table.get(pid) else { continue };
            match (start, row.start_time_secs) {
                (Some(_), Some(_)) => {
                    if start_times_match(*start, row.start_time_secs) {
                        alive.push((*pid, true));
                    } // else: recycled pid — not our survivor
                }
                _ => alive.push((*pid, false)), // alive, but unprovable
            }
        }
        if alive.is_empty() {
            return false; // everything ended — the link served its purpose
        }
        let verified = alive.iter().all(|(_, v)| *v);
        if !verified && now_ms.saturating_sub(link.closed_at_ms) > ORPHAN_UNVERIFIED_RETENTION_MS {
            return false; // cannot prove identity and it's been too long — stop claiming
        }
        let mut cpu: Option<f32> = None;
        let mut cpu_unknown = false;
        let mut rss: u64 = 0;
        for (pid, _) in &alive {
            if let Some(row) = table.get(pid) {
                match row.cpu_percent {
                    Some(v) => *cpu.get_or_insert(0.0) += v,
                    None => cpu_unknown = true,
                }
                rss += row.resident_bytes;
            }
        }
        orphans.push(OrphanSample {
            kind: link.kind,
            id: link.id.clone(),
            pids: alive.iter().map(|(pid, _)| *pid).collect(),
            cpu_percent: if cpu_unknown { None } else { cpu },
            resident_bytes: Some(rss),
            since_ms: link.closed_at_ms,
            confidence: if verified {
                AttributionConfidence::Exact
            } else {
                AttributionConfidence::Unknown
            },
        });
        true
    });
    orphans
}

/// Drop frames past the time window and the hard count cap.
fn trim_frames(frames: &mut VecDeque<Frame>, now_ms: u64) {
    let horizon = now_ms.saturating_sub(BUFFER_MAX_SECONDS * 1000);
    while frames.front().map(|f| f.at_ms < horizon).unwrap_or(false) {
        frames.pop_front();
    }
    while frames.len() > BUFFER_MAX_FRAMES {
        frames.pop_front();
    }
}

/// Instant / short-average / peak / trend over one series of appearances.
fn metric_summary(appearances: &[(u64, &MetricSample)], now_ms: u64) -> MetricSummary {
    let Some((_, latest)) = appearances.last() else {
        return MetricSummary {
            trend: Trend::Unknown,
            ..MetricSummary::default()
        };
    };
    let short_horizon = now_ms.saturating_sub(SHORT_WINDOW_MS);
    let short: Vec<&MetricSample> = appearances
        .iter()
        .filter(|(at, _)| *at >= short_horizon)
        .map(|(_, m)| *m)
        .collect();

    let cpu_values: Vec<f32> = short.iter().filter_map(|m| m.cpu_percent).collect();
    let cpu_avg = if cpu_values.is_empty() {
        None
    } else {
        Some(cpu_values.iter().sum::<f32>() / cpu_values.len() as f32)
    };
    let rss_values: Vec<u64> = short.iter().filter_map(|m| m.resident_bytes).collect();
    let rss_avg = if rss_values.is_empty() {
        None
    } else {
        Some(rss_values.iter().sum::<u64>() / rss_values.len() as u64)
    };

    let cpu_peak = appearances
        .iter()
        .filter_map(|(_, m)| m.cpu_percent)
        .fold(None::<f32>, |peak, v| Some(peak.map_or(v, |p| p.max(v))));
    let rss_peak = appearances
        .iter()
        .filter_map(|(_, m)| m.resident_bytes)
        .max();

    MetricSummary {
        processes: latest.processes,
        cpu_percent: latest.cpu_percent,
        cpu_avg_percent: cpu_avg,
        cpu_peak_percent: cpu_peak,
        resident_bytes: latest.resident_bytes,
        resident_avg_bytes: rss_avg,
        resident_peak_bytes: rss_peak,
        virtual_bytes: latest.virtual_bytes,
        io_read_bytes_per_sec: latest.io_read_bytes_per_sec,
        io_write_bytes_per_sec: latest.io_write_bytes_per_sec,
        trend: trend_of(appearances),
    }
}

/// Memory trend over the buffered window: compare the two halves' mean RSS.
/// Fewer than 6 points is `unknown` — a trend from 3 samples is a coin flip.
fn trend_of(appearances: &[(u64, &MetricSample)]) -> Trend {
    let rss: Vec<u64> = appearances
        .iter()
        .filter_map(|(_, m)| m.resident_bytes)
        .collect();
    if rss.len() < 6 {
        return Trend::Unknown;
    }
    let mid = rss.len() / 2;
    let first = rss[..mid].iter().sum::<u64>() as f64 / mid as f64;
    let second = rss[mid..].iter().sum::<u64>() as f64 / (rss.len() - mid) as f64;
    if first <= 0.0 {
        return Trend::Unknown;
    }
    let ratio = second / first;
    if ratio > 1.05 {
        Trend::Rising
    } else if ratio < 0.95 {
        Trend::Falling
    } else {
        Trend::Steady
    }
}

/// Build the consolidated summary from the buffered frames + live state.
fn build_summary(state: &MonitorState, now_ms: u64) -> ResourceSummary {
    let sampling = match resolve_cadence(
        state.config,
        state.leases.values().map(|l| l.kind).collect::<Vec<_>>(),
    ) {
        Some((interval, reason)) => SamplingState {
            active: true,
            interval_ms: Some(interval.as_millis() as u64),
            reason,
        },
        None => SamplingState {
            active: false,
            interval_ms: None,
            reason: "off",
        },
    };

    let frames: Vec<&Frame> = state.frames.iter().collect();
    let latest = frames.last();

    // Total series.
    let total_series: Vec<(u64, &MetricSample)> =
        frames.iter().map(|f| (f.at_ms, &f.total)).collect();
    let total = latest.map(|_| metric_summary(&total_series, now_ms));

    // Group series, keyed by (kind, id).
    type Key = (ResourceOwnerKind, Option<String>);
    let mut series: HashMap<Key, Vec<(u64, &GroupSample)>> = HashMap::new();
    for frame in &frames {
        for group in &frame.groups {
            series
                .entry((group.kind, group.id.clone()))
                .or_default()
                .push((frame.at_ms, group));
        }
    }
    let current: HashSet<Key> = latest
        .map(|f| f.groups.iter().map(|g| (g.kind, g.id.clone())).collect())
        .unwrap_or_default();

    let mut groups: Vec<GroupSummary> = Vec::new();
    for (key, appearances) in &series {
        let last = appearances.last().expect("series entries are never empty");
        let ended = !current.contains(key);
        if ended && now_ms.saturating_sub(last.0) > ENDED_WINDOW_MS {
            continue; // long gone — not even worth an "ended" row
        }
        let metric_appearances: Vec<(u64, &MetricSample)> = appearances
            .iter()
            .map(|(at, g)| (*at, &g.metrics))
            .collect();
        groups.push(GroupSummary {
            kind: key.0,
            id: key.1.clone(),
            workspace: last.1.workspace.clone(),
            confidence: last.1.confidence,
            ended,
            metrics: metric_summary(&metric_appearances, now_ms),
        });
    }
    groups.sort_by(|a, b| {
        (a.ended, kind_rank(a.kind), &a.id).cmp(&(b.ended, kind_rank(b.kind), &b.id))
    });

    ResourceSummary {
        enabled: state.config.enabled,
        capabilities: capabilities(),
        sampling,
        updated_at_ms: latest.map(|f| f.at_ms),
        buffer_seconds: BUFFER_MAX_SECONDS as u32,
        total,
        groups,
        orphans: latest.map(|f| f.orphans.clone()).unwrap_or_default(),
        terminals_linked: state.terminals.len() as u32,
    }
}

// --- export (manual, sanitized) ----------------------------------------------

/// The manual-export document. Everything identifying is anonymized before it
/// gets here (see [`sanitize_export`]); `fields` lists exactly what the file
/// contains so the consent dialog can show it before anything is saved.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceExport {
    pub schema_version: u32,
    pub exported_at_ms: u64,
    pub platform: &'static str,
    pub app_version: &'static str,
    pub capabilities: ResourceCapabilities,
    pub sampling: SamplingState,
    pub buffer_seconds: u32,
    pub fields: Vec<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<MetricSummary>,
    pub groups: Vec<GroupSummary>,
    pub orphans: Vec<OrphanSample>,
}

/// The flat field list shown by the consent dialog (kept in sync with the
/// export shape by the schema test below).
const EXPORT_FIELDS: &[&str] = &[
    "schemaVersion",
    "exportedAtMs",
    "platform",
    "appVersion",
    "capabilities",
    "sampling",
    "bufferSeconds",
    "kind",
    "id (anonymized: workspace-N / terminal-N / agent name)",
    "workspace (anonymized: workspace-N)",
    "confidence",
    "ended",
    "processes",
    "cpuPercent / cpuAvgPercent / cpuPeakPercent",
    "residentBytes / residentAvgBytes / residentPeakBytes",
    "virtualBytes",
    "ioReadBytesPerSec / ioWriteBytesPerSec",
    "trend",
    "pids (orphans only)",
    "sinceMs (orphans only)",
];

/// Agent commands safe to export verbatim: the known catalog names. An
/// explicit allow-list rather than a shape heuristic on purpose — a heuristic
/// cannot tell `claude` from a lowercase token like `ghp_…`, and the failure
/// mode of an out-of-date list is an anonymized label, never a leak.
const EXPORTABLE_AGENT_IDS: &[&str] = &[
    "claude",
    "codex",
    "gemini",
    "opencode",
    "pi",
    "agy",
    "goose",
    "grok",
    "zero",
    "openclaude",
    "aider",
    "cursor-agent",
];

/// Whether an agent command may appear verbatim in the export.
fn exportable_agent_id(id: &str) -> bool {
    EXPORTABLE_AGENT_IDS.contains(&id)
}

/// Strip every identifying string from a summary: workspace paths and terminal
/// ids become sequential opaque labels, agent commands survive only when they
/// are bare catalog-style names. PIDs stay (they are the point of a process
/// diagnostic and identify nothing outside this machine and boot).
fn sanitize_export(summary: &ResourceSummary, now_ms: u64) -> ResourceExport {
    /// Stable opaque label per distinct value (`workspace-1`, `terminal-2`, …).
    fn label(map: &mut HashMap<String, String>, prefix: &str, value: &str) -> String {
        if let Some(existing) = map.get(value) {
            return existing.clone();
        }
        let next = format!("{prefix}-{}", map.len() + 1);
        map.insert(value.to_string(), next.clone());
        next
    }

    struct Labels {
        workspaces: HashMap<String, String>,
        terminals: HashMap<String, String>,
        agents: HashMap<String, String>,
    }
    impl Labels {
        fn sanitize_id(&mut self, kind: ResourceOwnerKind, id: &str) -> String {
            match kind {
                ResourceOwnerKind::Workspace => label(&mut self.workspaces, "workspace", id),
                ResourceOwnerKind::Terminal => label(&mut self.terminals, "terminal", id),
                ResourceOwnerKind::Agent => {
                    if exportable_agent_id(id) {
                        id.to_string()
                    } else {
                        label(&mut self.agents, "agent", id)
                    }
                }
                _ => label(&mut self.agents, "owner", id),
            }
        }
    }
    let mut labels = Labels {
        workspaces: HashMap::new(),
        terminals: HashMap::new(),
        agents: HashMap::new(),
    };

    let mut groups = Vec::with_capacity(summary.groups.len());
    for g in &summary.groups {
        let id = g.id.as_deref().map(|id| labels.sanitize_id(g.kind, id));
        let workspace = g
            .workspace
            .as_deref()
            .map(|ws| label(&mut labels.workspaces, "workspace", ws));
        groups.push(GroupSummary {
            kind: g.kind,
            id,
            workspace,
            confidence: g.confidence,
            ended: g.ended,
            metrics: g.metrics.clone(),
        });
    }

    let mut orphans = Vec::with_capacity(summary.orphans.len());
    for o in &summary.orphans {
        orphans.push(OrphanSample {
            kind: o.kind,
            id: labels.sanitize_id(o.kind, &o.id),
            pids: o.pids.clone(),
            cpu_percent: o.cpu_percent,
            resident_bytes: o.resident_bytes,
            since_ms: o.since_ms,
            confidence: o.confidence,
        });
    }

    ResourceExport {
        schema_version: EXPORT_SCHEMA_VERSION,
        exported_at_ms: now_ms,
        platform: std::env::consts::OS,
        app_version: env!("CARGO_PKG_VERSION"),
        capabilities: summary.capabilities,
        sampling: summary.sampling.clone(),
        buffer_seconds: summary.buffer_seconds,
        fields: EXPORT_FIELDS.to_vec(),
        total: summary.total.clone(),
        groups,
        orphans,
    }
}

// --- the OS collector & sampler loop -----------------------------------------

/// Reads the live process table via `sysinfo`. Owns the `System` so the OS
/// handle (and its per-process bookkeeping) exists **only while sampling** —
/// dropping the collector is what makes "parked" cost nothing.
pub struct Collector {
    sys: sysinfo::System,
    cores: usize,
}

impl Default for Collector {
    fn default() -> Self {
        Self::new()
    }
}

impl Collector {
    pub fn new() -> Self {
        Self {
            sys: sysinfo::System::new(),
            cores: std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(1),
        }
    }

    /// One refresh → a [`ProcTable`]. Blocking (a full process-table walk);
    /// call from a blocking thread.
    pub fn collect(&mut self) -> ProcTable {
        self.sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            sysinfo::ProcessRefreshKind::nothing()
                .with_cpu()
                .with_memory()
                .with_disk_usage(),
        );
        let io_supported = capabilities().io;
        let mut table = ProcTable::with_capacity(self.sys.processes().len());
        for (pid, proc) in self.sys.processes() {
            let start = proc.start_time();
            let disk = proc.disk_usage();
            table.insert(
                pid.as_u32(),
                ProcRow {
                    parent: proc.parent().map(|p| p.as_u32()),
                    // 0 = "the OS gave nothing"; absent data is never zero.
                    start_time_secs: (start > 0).then_some(start),
                    // Normalized to the whole machine; `ingest` nulls the first
                    // sighting (sysinfo reports 0.0 there).
                    cpu_percent: Some(proc.cpu_usage() / self.cores as f32),
                    resident_bytes: proc.memory(),
                    virtual_bytes: proc.virtual_memory(),
                    io_read_total: io_supported.then_some(disk.total_read_bytes),
                    io_write_total: io_supported.then_some(disk.total_written_bytes),
                },
            );
        }
        table
    }

    /// Start time (seconds since epoch) of one pid, or `None` when the process
    /// is gone or the platform reports nothing. A one-shot, single-pid refresh.
    pub fn probe_start_time(pid: u32) -> Option<u64> {
        let mut sys = sysinfo::System::new();
        let target = sysinfo::Pid::from_u32(pid);
        sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::Some(&[target]),
            false,
            sysinfo::ProcessRefreshKind::nothing(),
        );
        sys.process(target)
            .map(|p| p.start_time())
            .filter(|s| *s > 0)
    }
}

/// A boxed future producing one process table (lets tests inject fake tables).
pub type TableFuture = Pin<Box<dyn Future<Output = ProcTable> + Send>>;

/// The adaptive sampler loop. Parked (no timer at all) while [`ResourceMonitor::cadence`]
/// says so; otherwise ticks at the resolved interval, re-resolving whenever the
/// monitor signals a change. Generic over the table source and the emitter so
/// the loop itself is testable with a fake clock.
pub async fn run_loop<S, E>(
    monitor: Arc<ResourceMonitor>,
    mut sample: S,
    mut on_park: impl FnMut(),
    mut emit: E,
) where
    S: FnMut() -> TableFuture,
    E: FnMut(&ResourceSummary),
{
    let desktop_pid = std::process::id();
    loop {
        let Some((interval, _reason)) = monitor.cadence(now_ms()) else {
            monitor.clear_transient();
            on_park();
            monitor.changed().await;
            continue;
        };
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = monitor.changed() => continue, // cadence changed — re-resolve
        }
        if monitor.cadence(now_ms()).is_none() {
            continue; // raced a shutdown of the last consumer
        }
        let table = sample().await;
        let summary = monitor.ingest(now_ms(), desktop_pid, table);
        emit(&summary);
    }
}

/// Spawn the production sampler: real `sysinfo` collection on a blocking
/// thread, summaries emitted to the webview as `resources:summary`.
pub fn spawn_collector(app: tauri::AppHandle, monitor: Arc<ResourceMonitor>) {
    let slot: Arc<Mutex<Option<Collector>>> = Arc::new(Mutex::new(None));
    let sample_slot = slot.clone();
    let park_slot = slot;
    tauri::async_runtime::spawn(run_loop(
        monitor,
        move || -> TableFuture {
            let slot = sample_slot.clone();
            Box::pin(async move {
                let mut collector = slot.lock().unwrap().take().unwrap_or_default();
                let (collector, table) = tokio::task::spawn_blocking(move || {
                    let table = collector.collect();
                    (collector, table)
                })
                .await
                .expect("resource sample task panicked");
                *slot.lock().unwrap() = Some(collector);
                table
            })
        },
        move || {
            // Parked: drop the OS handle so nothing per-process is retained.
            *park_slot.lock().unwrap() = None;
        },
        move |summary| {
            let _ = app.emit("resources:summary", summary);
        },
    ));
}

/// Register a terminal after probing its start time (fire-and-forget from
/// `pty_create`; the probe is a single-pid refresh on a blocking thread).
pub async fn register_terminal_probed(
    monitor: Arc<ResourceMonitor>,
    pty_id: String,
    pid: u32,
    workspace: Option<String>,
) {
    let start = tokio::task::spawn_blocking(move || Collector::probe_start_time(pid))
        .await
        .unwrap_or(None);
    monitor.register_terminal(&pty_id, pid, start, workspace);
}

// --- tests -------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn row(parent: Option<u32>, start: Option<u64>) -> ProcRow {
        ProcRow {
            parent,
            start_time_secs: start,
            cpu_percent: Some(1.0),
            resident_bytes: 100,
            virtual_bytes: 1000,
            io_read_total: Some(0),
            io_write_total: Some(0),
        }
    }

    fn link(
        pid: u32,
        start: Option<u64>,
        workspace: Option<&str>,
        agent: Option<&str>,
    ) -> TerminalLink {
        TerminalLink {
            pid,
            start_time_secs: start,
            workspace: workspace.map(str::to_string),
            agent: agent.map(str::to_string),
            recycled: false,
        }
    }

    fn monitor_with(config: MonitorConfig) -> Arc<ResourceMonitor> {
        ResourceMonitor::new(config)
    }

    fn enabled_config() -> MonitorConfig {
        MonitorConfig {
            enabled: true,
            orphan_sweep: false,
            sweep_secs: 20,
        }
    }

    // --- cadence -------------------------------------------------------------

    #[test]
    fn cadence_is_parked_by_default() {
        assert_eq!(resolve_cadence(enabled_config(), vec![]), None);
    }

    #[test]
    fn cadence_prefers_popover_over_budget_over_sweep() {
        let mut config = enabled_config();
        config.orphan_sweep = true;
        assert_eq!(
            resolve_cadence(config, vec![ConsumerKind::Budget, ConsumerKind::Popover]),
            Some((POPOVER_INTERVAL, "popover"))
        );
        assert_eq!(
            resolve_cadence(config, vec![ConsumerKind::Budget]),
            Some((BUDGET_INTERVAL, "budget"))
        );
        assert_eq!(
            resolve_cadence(config, vec![]),
            Some((Duration::from_secs(20), "orphanSweep"))
        );
    }

    #[test]
    fn cadence_clamps_the_sweep_interval() {
        let mut config = enabled_config();
        config.orphan_sweep = true;
        config.sweep_secs = 5;
        assert_eq!(
            resolve_cadence(config, vec![]),
            Some((Duration::from_secs(SWEEP_MIN_SECS as u64), "orphanSweep"))
        );
        config.sweep_secs = 300;
        assert_eq!(
            resolve_cadence(config, vec![]),
            Some((Duration::from_secs(SWEEP_MAX_SECS as u64), "orphanSweep"))
        );
    }

    #[test]
    fn disabled_config_parks_even_with_consumers() {
        let config = MonitorConfig {
            enabled: false,
            orphan_sweep: true,
            sweep_secs: 20,
        };
        assert_eq!(resolve_cadence(config, vec![ConsumerKind::Popover]), None);
    }

    #[test]
    fn expired_leases_are_pruned() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t1", ConsumerKind::Popover, 1_000);
        assert!(monitor.cadence(2_000).is_some());
        // Past the TTL the lease no longer holds the sampler awake.
        assert_eq!(monitor.cadence(1_000 + LEASE_TTL_MS + 1), None);
    }

    #[test]
    fn unsubscribe_releases_the_lease() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t1", ConsumerKind::Popover, 1_000);
        monitor.unsubscribe("t1");
        assert_eq!(monitor.cadence(1_001), None);
    }

    // --- attribution ---------------------------------------------------------

    #[test]
    fn shell_is_exact_and_descendants_inferred() {
        let mut table = ProcTable::new();
        table.insert(1, row(None, Some(10))); // desktop
        table.insert(100, row(Some(1), Some(50))); // shell
        table.insert(200, row(Some(100), Some(60))); // child
        table.insert(300, row(Some(200), Some(70))); // grandchild
        let mut links = HashMap::new();
        links.insert(
            "pty-1".to_string(),
            link(100, Some(50), Some("C:\\ws"), None),
        );

        let (owners, recycled) = attribute(&table, 1, &links);
        assert!(recycled.is_empty());
        assert_eq!(
            owners.get(&100),
            Some(&OwnerRef::Terminal {
                pty_id: "pty-1".into(),
                workspace: Some("C:\\ws".into()),
                confidence: AttributionConfidence::Exact,
            })
        );
        for pid in [200, 300] {
            match owners.get(&pid) {
                Some(OwnerRef::Terminal { confidence, .. }) => {
                    assert_eq!(*confidence, AttributionConfidence::Inferred)
                }
                other => panic!("pid {pid} not attributed to the terminal: {other:?}"),
            }
        }
        assert_eq!(
            owners.get(&1),
            Some(&OwnerRef::Desktop {
                confidence: AttributionConfidence::Exact
            })
        );
    }

    #[test]
    fn detected_agent_reclassifies_the_subtree_not_the_shell() {
        let mut table = ProcTable::new();
        table.insert(100, row(None, Some(50)));
        table.insert(200, row(Some(100), Some(60)));
        let mut links = HashMap::new();
        links.insert(
            "pty-1".to_string(),
            link(100, Some(50), Some("/ws"), Some("claude")),
        );

        let (owners, _) = attribute(&table, 1, &links);
        assert!(matches!(owners.get(&100), Some(OwnerRef::Terminal { .. })));
        assert_eq!(
            owners.get(&200),
            Some(&OwnerRef::Agent {
                command: "claude".into(),
                workspace: Some("/ws".into()),
                confidence: AttributionConfidence::Inferred,
            })
        );
    }

    #[test]
    fn recycled_pid_claims_nothing_and_is_reported() {
        let mut table = ProcTable::new();
        // Same pid as the link, started at a very different time: another process.
        table.insert(100, row(None, Some(9_999)));
        table.insert(200, row(Some(100), Some(9_999)));
        let mut links = HashMap::new();
        links.insert("pty-1".to_string(), link(100, Some(50), None, None));

        let (owners, recycled) = attribute(&table, 1, &links);
        assert_eq!(recycled, vec!["pty-1".to_string()]);
        assert!(!owners.contains_key(&100));
        assert!(!owners.contains_key(&200));
    }

    #[test]
    fn start_time_tolerance_still_matches() {
        let mut table = ProcTable::new();
        table.insert(100, row(None, Some(52)));
        let mut links = HashMap::new();
        links.insert("pty-1".to_string(), link(100, Some(50), None, None));
        let (owners, recycled) = attribute(&table, 1, &links);
        assert!(recycled.is_empty());
        assert!(matches!(
            owners.get(&100),
            Some(OwnerRef::Terminal {
                confidence: AttributionConfidence::Exact,
                ..
            })
        ));
    }

    #[test]
    fn missing_start_time_degrades_to_inferred_not_exact() {
        let mut table = ProcTable::new();
        table.insert(100, row(None, None));
        let mut links = HashMap::new();
        links.insert("pty-1".to_string(), link(100, Some(50), None, None));
        let (owners, recycled) = attribute(&table, 1, &links);
        assert!(recycled.is_empty());
        assert!(matches!(
            owners.get(&100),
            Some(OwnerRef::Terminal {
                confidence: AttributionConfidence::Inferred,
                ..
            })
        ));
    }

    #[test]
    fn desktop_tree_excludes_claimed_terminal_subtrees() {
        let mut table = ProcTable::new();
        table.insert(1, row(None, Some(10))); // desktop
        table.insert(2, row(Some(1), Some(20))); // webview helper
        table.insert(100, row(Some(1), Some(50))); // shell (child of desktop!)
        table.insert(200, row(Some(100), Some(60))); // shell's child
        let mut links = HashMap::new();
        links.insert("pty-1".to_string(), link(100, Some(50), None, None));

        let (owners, _) = attribute(&table, 1, &links);
        assert!(matches!(owners.get(&2), Some(OwnerRef::Desktop { .. })));
        assert!(matches!(owners.get(&100), Some(OwnerRef::Terminal { .. })));
        assert!(matches!(owners.get(&200), Some(OwnerRef::Terminal { .. })));
    }

    #[test]
    fn unrelated_processes_are_never_classified() {
        let mut table = ProcTable::new();
        table.insert(1, row(None, Some(10)));
        table.insert(9_000, row(None, Some(5))); // someone else's process
        let (owners, _) = attribute(&table, 1, &HashMap::new());
        assert!(!owners.contains_key(&9_000));
    }

    // --- deltas & honesty ----------------------------------------------------

    #[test]
    fn io_rate_needs_both_totals_and_a_window() {
        assert_eq!(io_rate(None, Some(10), Some(1.0)), None);
        assert_eq!(io_rate(Some(10), None, Some(1.0)), None);
        assert_eq!(io_rate(Some(10), Some(30), None), None);
        assert_eq!(io_rate(Some(10), Some(30), Some(2.0)), Some(10.0));
    }

    #[test]
    fn first_sighting_reports_no_cpu_or_io() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t", ConsumerKind::Popover, 1_000);
        let mut table = ProcTable::new();
        table.insert(std::process::id(), row(None, Some(10)));
        let summary = monitor.ingest(1_000, std::process::id(), table);
        let total = summary.total.expect("a total exists");
        assert_eq!(total.cpu_percent, None, "first sight must not report CPU");
        assert_eq!(total.io_read_bytes_per_sec, None);
        // Memory is a point-in-time read and is available immediately.
        assert_eq!(total.resident_bytes, Some(100));
    }

    #[test]
    fn second_tick_reports_cpu_and_io_deltas() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t", ConsumerKind::Popover, 1_000);
        let me = std::process::id();
        let mut t1 = ProcTable::new();
        t1.insert(me, row(None, Some(10)));
        monitor.ingest(1_000, me, t1);

        let mut t2 = ProcTable::new();
        let mut r = row(None, Some(10));
        r.cpu_percent = Some(3.5);
        r.io_read_total = Some(2_000);
        r.io_write_total = Some(1_000);
        t2.insert(me, r);
        let summary = monitor.ingest(3_000, me, t2);
        let total = summary.total.expect("a total exists");
        assert_eq!(total.cpu_percent, Some(3.5));
        assert_eq!(total.io_read_bytes_per_sec, Some(1_000.0)); // 2000 B over 2 s
        assert_eq!(total.io_write_bytes_per_sec, Some(500.0));
    }

    #[test]
    fn a_gap_invalidates_rates_but_not_memory() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t", ConsumerKind::Popover, 1_000);
        let me = std::process::id();
        let mut t1 = ProcTable::new();
        t1.insert(me, row(None, Some(10)));
        monitor.ingest(1_000, me, t1.clone());
        monitor.ingest(3_000, me, t1.clone());
        // Renew the lease, then a long gap (parked window) before the next tick.
        monitor.subscribe("t", ConsumerKind::Popover, 500_000);
        let summary = monitor.ingest(500_000, me, t1);
        let total = summary.total.expect("a total exists");
        assert_eq!(total.cpu_percent, None, "a gap must invalidate CPU");
        assert_eq!(total.io_read_bytes_per_sec, None);
        assert_eq!(total.resident_bytes, Some(100));
    }

    #[test]
    fn identity_change_resets_deltas() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t", ConsumerKind::Popover, 1_000);
        let me = std::process::id();
        let mut t1 = ProcTable::new();
        t1.insert(me, row(None, Some(10)));
        monitor.ingest(1_000, me, t1);
        // Same pid, different start time: a different process.
        let mut t2 = ProcTable::new();
        t2.insert(me, row(None, Some(999)));
        let summary = monitor.ingest(3_000, me, t2);
        let total = summary.total.expect("a total exists");
        assert_eq!(total.cpu_percent, None);
        assert_eq!(total.io_read_bytes_per_sec, None);
    }

    // --- aggregation ---------------------------------------------------------

    #[test]
    fn groups_fold_terminals_into_workspaces_and_agents_apart() {
        let mut table = ProcTable::new();
        table.insert(1, row(None, Some(10))); // desktop
        table.insert(100, row(Some(1), Some(50))); // shell in ws A
        table.insert(101, row(Some(1), Some(51))); // second shell in ws A
        table.insert(200, row(Some(100), Some(60))); // agent process under shell 100
        let mut links = HashMap::new();
        links.insert(
            "pty-1".to_string(),
            link(100, Some(50), Some("A"), Some("codex")),
        );
        links.insert("pty-2".to_string(), link(101, Some(51), Some("A"), None));

        let (owners, _) = attribute(&table, 1, &links);
        let (total, groups) = aggregate(&table, &owners, &links);

        assert_eq!(total.processes, 4);
        let desktop = groups
            .iter()
            .find(|g| g.kind == ResourceOwnerKind::Desktop)
            .unwrap();
        assert_eq!(desktop.metrics.processes, 1);
        let ws = groups
            .iter()
            .find(|g| g.kind == ResourceOwnerKind::Workspace && g.id.as_deref() == Some("A"))
            .unwrap();
        // The two shells; the agent process is its own group.
        assert_eq!(ws.metrics.processes, 2);
        let agent = groups
            .iter()
            .find(|g| g.kind == ResourceOwnerKind::Agent && g.id.as_deref() == Some("codex"))
            .unwrap();
        assert_eq!(agent.metrics.processes, 1);
        assert_eq!(agent.workspace.as_deref(), Some("A"));
        assert_eq!(agent.confidence, AttributionConfidence::Inferred);
    }

    #[test]
    fn one_unknown_member_makes_the_group_rate_unknown() {
        let mut table = ProcTable::new();
        let mut fresh = row(Some(1), Some(50));
        fresh.cpu_percent = None; // first sighting
        table.insert(100, row(None, Some(10)));
        table.insert(200, fresh);
        let mut links = HashMap::new();
        links.insert("pty-1".to_string(), link(100, Some(10), Some("A"), None));
        // 200 is a child of 1 — irrelevant; rebuild: make 200 child of 100.
        table.get_mut(&200).unwrap().parent = Some(100);

        let (owners, _) = attribute(&table, 999, &links);
        let (_, groups) = aggregate(&table, &owners, &links);
        let ws = groups
            .iter()
            .find(|g| g.kind == ResourceOwnerKind::Workspace)
            .unwrap();
        assert_eq!(ws.metrics.processes, 2);
        assert_eq!(
            ws.metrics.cpu_percent, None,
            "partial sums must not pose as facts"
        );
        assert!(ws.metrics.resident_bytes.is_some(), "memory is still known");
    }

    #[test]
    fn recycled_link_shows_an_unknown_group_without_metrics() {
        let table = ProcTable::new();
        let mut links = HashMap::new();
        let mut l = link(100, Some(50), Some("A"), None);
        l.recycled = true;
        links.insert("pty-1".to_string(), l);
        let (owners, _) = attribute(&table, 1, &links);
        let (_, groups) = aggregate(&table, &owners, &links);
        let g = groups
            .iter()
            .find(|g| g.id.as_deref() == Some("pty-1"))
            .expect("recycled link surfaces as a group");
        assert_eq!(g.confidence, AttributionConfidence::Unknown);
        assert_eq!(g.metrics.processes, 0);
        assert_eq!(
            g.metrics.resident_bytes, None,
            "no metrics — and never zeros"
        );
    }

    // --- orphans -------------------------------------------------------------

    #[test]
    fn surviving_members_of_a_closed_terminal_become_orphans() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t", ConsumerKind::Popover, 1_000);
        let me = 1;
        let mut table = ProcTable::new();
        table.insert(me, row(None, Some(10)));
        table.insert(100, row(Some(me), Some(50)));
        table.insert(200, row(Some(100), Some(60)));
        monitor.register_terminal("pty-1", 100, Some(50), Some("A".into()));
        monitor.ingest(1_000, me, table.clone());

        monitor.terminal_closed("pty-1", 2_000);
        // Shell died, its child survived.
        table.remove(&100);
        let summary = monitor.ingest(3_000, me, table.clone());
        assert_eq!(summary.orphans.len(), 1);
        let orphan = &summary.orphans[0];
        assert_eq!(orphan.pids, vec![200]);
        assert_eq!(orphan.confidence, AttributionConfidence::Exact);
        assert_eq!(orphan.since_ms, 2_000);

        // Survivor ends → the orphan disappears and the link is dropped.
        table.remove(&200);
        let summary = monitor.ingest(5_000, me, table);
        assert!(summary.orphans.is_empty());
    }

    #[test]
    fn a_recycled_pid_is_not_reported_as_a_survivor() {
        let mut closed = vec![ClosedLink {
            kind: ResourceOwnerKind::Terminal,
            id: "pty-1".into(),
            members: vec![(200, Some(60))],
            closed_at_ms: 1_000,
        }];
        let mut table = ProcTable::new();
        table.insert(200, row(None, Some(9_999))); // same pid, other process
        let orphans = check_orphans(&mut closed, &table, 2_000);
        assert!(orphans.is_empty());
        assert!(closed.is_empty(), "nothing left to watch");
    }

    #[test]
    fn unverifiable_survivors_degrade_to_unknown_and_expire() {
        let mut closed = vec![ClosedLink {
            kind: ResourceOwnerKind::Agent,
            id: "claude".into(),
            members: vec![(200, None)],
            closed_at_ms: 1_000,
        }];
        let mut table = ProcTable::new();
        table.insert(200, row(None, None));
        let orphans = check_orphans(&mut closed, &table, 2_000);
        assert_eq!(orphans.len(), 1);
        assert_eq!(orphans[0].confidence, AttributionConfidence::Unknown);
        // Long after retention it stops claiming.
        let orphans = check_orphans(
            &mut closed,
            &table,
            2_000 + ORPHAN_UNVERIFIED_RETENTION_MS + 1,
        );
        assert!(orphans.is_empty());
        assert!(closed.is_empty());
    }

    // --- buffer & summaries --------------------------------------------------

    fn frame_at(at_ms: u64, rss: u64) -> Frame {
        Frame {
            at_ms,
            total: MetricSample {
                processes: 1,
                cpu_percent: Some(2.0),
                resident_bytes: Some(rss),
                virtual_bytes: Some(10 * rss),
                io_read_bytes_per_sec: None,
                io_write_bytes_per_sec: None,
            },
            groups: vec![],
            orphans: vec![],
        }
    }

    #[test]
    fn the_buffer_is_bounded_by_time_and_count() {
        let mut frames: VecDeque<Frame> = VecDeque::new();
        for i in 0..(BUFFER_MAX_FRAMES + 100) {
            frames.push_back(frame_at(i as u64, 1));
        }
        trim_frames(&mut frames, BUFFER_MAX_FRAMES as u64 + 100);
        assert!(frames.len() <= BUFFER_MAX_FRAMES);

        let mut frames: VecDeque<Frame> = VecDeque::new();
        frames.push_back(frame_at(0, 1));
        frames.push_back(frame_at(BUFFER_MAX_SECONDS * 1000 + 5_000, 1));
        trim_frames(&mut frames, BUFFER_MAX_SECONDS * 1000 + 5_000);
        assert_eq!(frames.len(), 1, "frames older than the window are dropped");
    }

    #[test]
    fn summary_reports_instant_average_peak_and_trend() {
        let frames: Vec<Frame> = (0..10u64)
            .map(|i| frame_at(i * 2_000, 100 + i * 20))
            .collect();
        let series: Vec<(u64, &MetricSample)> =
            frames.iter().map(|f| (f.at_ms, &f.total)).collect();
        let m = metric_summary(&series, 18_000);
        assert_eq!(m.resident_bytes, Some(280)); // latest
        assert_eq!(m.resident_peak_bytes, Some(280));
        assert_eq!(m.cpu_percent, Some(2.0));
        assert_eq!(m.trend, Trend::Rising);
    }

    #[test]
    fn trend_needs_enough_points_and_detects_direction() {
        let rising: Vec<Frame> = (0..8u64).map(|i| frame_at(i, 100 + i * 50)).collect();
        let series: Vec<(u64, &MetricSample)> =
            rising.iter().map(|f| (f.at_ms, &f.total)).collect();
        assert_eq!(trend_of(&series), Trend::Rising);

        let falling: Vec<Frame> = (0..8u64).map(|i| frame_at(i, 1_000 - i * 100)).collect();
        let series: Vec<(u64, &MetricSample)> =
            falling.iter().map(|f| (f.at_ms, &f.total)).collect();
        assert_eq!(trend_of(&series), Trend::Falling);

        let flat: Vec<Frame> = (0..8u64).map(|i| frame_at(i, 500)).collect();
        let series: Vec<(u64, &MetricSample)> = flat.iter().map(|f| (f.at_ms, &f.total)).collect();
        assert_eq!(trend_of(&series), Trend::Steady);

        let few: Vec<Frame> = (0..3u64).map(|i| frame_at(i, 500)).collect();
        let series: Vec<(u64, &MetricSample)> = few.iter().map(|f| (f.at_ms, &f.total)).collect();
        assert_eq!(trend_of(&series), Trend::Unknown);
    }

    #[test]
    fn a_vanished_group_is_reported_as_ended_then_dropped() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t", ConsumerKind::Popover, 1_000);
        let me = 1;
        monitor.register_terminal("pty-1", 100, Some(50), Some("A".into()));
        let mut table = ProcTable::new();
        table.insert(me, row(None, Some(10)));
        table.insert(100, row(Some(me), Some(50)));
        monitor.ingest(1_000, me, table.clone());

        table.remove(&100); // shell exits
        let summary = monitor.ingest(3_000, me, table.clone());
        let ws = summary
            .groups
            .iter()
            .find(|g| g.kind == ResourceOwnerKind::Workspace)
            .expect("the workspace group lingers as ended");
        assert!(ws.ended);
        assert_eq!(ws.metrics.resident_bytes, Some(100), "last-known metrics");

        // Renew the lease far in the future and tick again: past the ended
        // window the group is gone entirely.
        monitor.subscribe("t", ConsumerKind::Popover, 500_000);
        let summary = monitor.ingest(3_000 + ENDED_WINDOW_MS + 10_000, me, table);
        assert!(summary
            .groups
            .iter()
            .all(|g| g.kind != ResourceOwnerKind::Workspace));
    }

    #[test]
    fn summary_reports_sampling_state_and_link_count() {
        let monitor = monitor_with(enabled_config());
        let s = monitor.summary(1_000);
        assert!(!s.sampling.active);
        assert_eq!(s.sampling.reason, "off");
        assert!(s.updated_at_ms.is_none());
        assert!(s.total.is_none());

        monitor.subscribe("t", ConsumerKind::Popover, 1_000);
        monitor.register_terminal("pty-1", 100, Some(50), None);
        let s = monitor.summary(1_001);
        assert!(s.sampling.active);
        assert_eq!(s.sampling.interval_ms, Some(2_000));
        assert_eq!(s.terminals_linked, 1);
    }

    #[test]
    fn ingest_broadcasts_to_internal_subscribers() {
        let monitor = monitor_with(enabled_config());
        monitor.subscribe("t", ConsumerKind::Popover, 1_000);
        let mut rx = monitor.subscribe_events();
        let mut table = ProcTable::new();
        table.insert(1, row(None, Some(10)));
        monitor.ingest(1_000, 1, table);
        let received = rx.try_recv().expect("a summary is broadcast per frame");
        assert_eq!(received.updated_at_ms, Some(1_000));
    }

    #[test]
    fn apply_settings_wakes_only_on_change() {
        let monitor = monitor_with(enabled_config());
        let settings = crate::model::ResourceSettings {
            enabled: true,
            orphan_sweep: true,
            orphan_sweep_seconds: 7, // clamped to 15
        };
        monitor.apply_settings(&settings);
        assert_eq!(
            monitor.cadence(1_000),
            Some((Duration::from_secs(15), "orphanSweep"))
        );
        let settings = crate::model::ResourceSettings {
            enabled: false,
            orphan_sweep: true,
            orphan_sweep_seconds: 20,
        };
        monitor.apply_settings(&settings);
        assert_eq!(monitor.cadence(1_001), None);
    }

    // --- the loop ------------------------------------------------------------

    #[tokio::test(start_paused = true)]
    async fn the_loop_parks_without_consumers_and_wakes_on_subscribe() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let monitor = monitor_with(enabled_config());
        let samples = Arc::new(AtomicUsize::new(0));
        let samples_in_loop = samples.clone();
        let loop_monitor = monitor.clone();
        let handle = tokio::spawn(run_loop(
            loop_monitor,
            move || -> TableFuture {
                samples_in_loop.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { ProcTable::new() })
            },
            || {},
            |_| {},
        ));

        // Parked: even after a long virtual wait, nothing was sampled.
        tokio::time::sleep(Duration::from_secs(120)).await;
        assert_eq!(
            samples.load(Ordering::SeqCst),
            0,
            "parked must sample nothing"
        );

        // A popover consumer wakes it at the fast cadence. (The lease is
        // renewed against the real clock, which tokio's pause doesn't move.)
        monitor.subscribe("t", ConsumerKind::Popover, now_ms());
        tokio::time::sleep(Duration::from_secs(7)).await;
        assert!(
            samples.load(Ordering::SeqCst) >= 2,
            "an active popover lease must drive samples"
        );

        handle.abort();
    }

    // --- export sanitization (the golden test) -------------------------------

    /// Every JSON key the export may contain. A new field must be added here
    /// *consciously* — that is the moment to ask whether it can leak anything.
    const ALLOWED_EXPORT_KEYS: &[&str] = &[
        "schemaVersion",
        "exportedAtMs",
        "platform",
        "appVersion",
        "capabilities",
        "cpu",
        "memory",
        "virtualMemory",
        "io",
        "startTime",
        "validated",
        "sampling",
        "active",
        "intervalMs",
        "reason",
        "bufferSeconds",
        "fields",
        "total",
        "groups",
        "orphans",
        "kind",
        "id",
        "workspace",
        "confidence",
        "ended",
        "processes",
        "cpuPercent",
        "cpuAvgPercent",
        "cpuPeakPercent",
        "residentBytes",
        "residentAvgBytes",
        "residentPeakBytes",
        "virtualBytes",
        "ioReadBytesPerSec",
        "ioWriteBytesPerSec",
        "trend",
        "pids",
        "sinceMs",
    ];

    fn collect_keys(value: &serde_json::Value, keys: &mut HashSet<String>) {
        match value {
            serde_json::Value::Object(map) => {
                for (k, v) in map {
                    keys.insert(k.clone());
                    collect_keys(v, keys);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    collect_keys(item, keys);
                }
            }
            _ => {}
        }
    }

    /// A summary poisoned with the kinds of values that must never leave the
    /// machine: home paths, tokens, env-var spellings, file names.
    fn hostile_summary() -> ResourceSummary {
        let hostile_ids = [
            "C:\\Users\\bob\\secret-project",
            "/home/alice/.ssh/id_ed25519",
            "/Users/carol/Documents/taxes.xlsx",
            "ghp_abcdefghijklmnop",
            "Bearer sk-ans-1234567890",
            "%USERPROFILE%\\creds.json",
            "$HOME/.config/token",
        ];
        let group = |kind: ResourceOwnerKind, id: &str, ws: Option<&str>| GroupSummary {
            kind,
            id: Some(id.to_string()),
            workspace: ws.map(str::to_string),
            confidence: AttributionConfidence::Exact,
            ended: false,
            metrics: MetricSummary {
                processes: 1,
                resident_bytes: Some(1),
                trend: Trend::Unknown,
                ..MetricSummary::default()
            },
        };
        ResourceSummary {
            enabled: true,
            capabilities: capabilities(),
            sampling: SamplingState {
                active: false,
                interval_ms: None,
                reason: "off",
            },
            updated_at_ms: Some(1),
            buffer_seconds: 600,
            total: None,
            groups: vec![
                group(
                    ResourceOwnerKind::Workspace,
                    hostile_ids[0],
                    Some(hostile_ids[0]),
                ),
                group(
                    ResourceOwnerKind::Terminal,
                    hostile_ids[1],
                    Some(hostile_ids[2]),
                ),
                group(ResourceOwnerKind::Agent, hostile_ids[3], None),
                group(ResourceOwnerKind::Agent, hostile_ids[4], None),
                // A legitimate bare agent name survives verbatim.
                group(ResourceOwnerKind::Agent, "cursor-agent", None),
            ],
            orphans: vec![OrphanSample {
                kind: ResourceOwnerKind::Agent,
                id: hostile_ids[5].to_string(),
                pids: vec![4242],
                cpu_percent: None,
                resident_bytes: Some(1),
                since_ms: 1,
                confidence: AttributionConfidence::Unknown,
            }],
            terminals_linked: 1,
        }
    }

    #[test]
    fn export_strips_every_identifying_string() {
        let export = sanitize_export(&hostile_summary(), 2_000);
        let json = serde_json::to_string_pretty(&export).unwrap();

        // No path shapes, no home spellings, no token prefixes — the patterns
        // that have historically leaked from diagnostics.
        for needle in [
            "C:\\",
            "C:\\\\",
            "/home/",
            "/Users/",
            ".ssh",
            "taxes",
            "ghp_",
            "sk-ans",
            "Bearer",
            "USERPROFILE",
            "$HOME",
            "secret",
            "creds",
            "id_ed25519",
        ] {
            assert!(!json.contains(needle), "export leaked {needle:?}:\n{json}");
        }
        // Anonymized labels took their place; the safe agent name survived.
        assert!(json.contains("workspace-1"));
        assert!(json.contains("terminal-1"));
        assert!(json.contains("agent-1"));
        assert!(json.contains("cursor-agent"));
        // PIDs are allowed in an explicit diagnostic export.
        assert!(json.contains("4242"));
    }

    #[test]
    fn export_contains_only_allow_listed_keys() {
        let export = sanitize_export(&hostile_summary(), 2_000);
        let value = serde_json::to_value(&export).unwrap();
        let mut keys = HashSet::new();
        collect_keys(&value, &mut keys);
        for key in &keys {
            assert!(
                ALLOWED_EXPORT_KEYS.contains(&key.as_str()),
                "export gained an un-reviewed key {key:?} — add it to ALLOWED_EXPORT_KEYS only after checking it cannot leak"
            );
        }
    }

    #[test]
    fn export_lists_its_fields_for_the_consent_dialog() {
        let export = sanitize_export(&hostile_summary(), 2_000);
        assert!(!export.fields.is_empty());
        assert!(export.fields.iter().any(|f| f.contains("anonymized")));
    }

    #[test]
    fn exportable_agent_ids_are_known_catalog_names_only() {
        assert!(exportable_agent_id("claude"));
        assert!(exportable_agent_id("cursor-agent"));
        assert!(exportable_agent_id("agy"));
        assert!(!exportable_agent_id(""));
        assert!(!exportable_agent_id("C:\\tools\\agent.exe"));
        assert!(!exportable_agent_id("/usr/bin/agent"));
        assert!(!exportable_agent_id("my agent"));
        // A lowercase token *shaped* like a name still isn't in the catalog —
        // the reason this is an allow-list and not a heuristic.
        assert!(!exportable_agent_id("ghp_abcdefghijklmnop"));
        assert!(!exportable_agent_id("Claude")); // catalog ids are lowercase
    }

    // --- registry lifecycle --------------------------------------------------

    #[test]
    fn closing_an_unknown_terminal_is_a_noop() {
        let monitor = monitor_with(enabled_config());
        monitor.terminal_closed("nope", 1_000);
        assert!(monitor.summary(1_000).orphans.is_empty());
    }

    #[test]
    fn set_agent_on_unknown_terminal_is_a_noop() {
        let monitor = monitor_with(enabled_config());
        monitor.set_terminal_agent("nope", Some("claude".into()));
        // Nothing to assert beyond "no panic"; the registry stays empty.
        assert_eq!(monitor.summary(1_000).terminals_linked, 0);
    }
}
