//! The bridges of connected hosts (`02g` §5.18).
//!
//! A host whose account runs `uxnan-bridge` has conversations, headless runs
//! and a phone of its own, and they are that bridge's — not this machine's.
//! This keeps one link to each such bridge, the same client the local bridge
//! uses ([`Connection`]), reached the way [`crate::ssh::bridge`] describes: the
//! host engine reads its record, an SSH channel carries its socket.
//!
//! **A link lives exactly as long as the host engine it was found through.**
//! It starts when an engine comes up for a connection, and ends when that
//! engine is lost — a reconnect brings a new engine and with it a new link,
//! resuming the bridge's log where the last one stopped. There are no modes:
//! the host's bridge is the host's business, so the desktop attaches when there
//! is one and says so when there is none. Nothing here installs or starts one.
//!
//! While a host has no bridge the link looks again every
//! [`REDISCOVER_EVERY`] — one file read on the engine's channel, which costs the
//! host nothing — and at once on a retry, so one started there shows up.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex, Notify};

use super::connection::{ConnectError, Connection, Event, Resume};
use super::{is_method_name, BridgeCallError, Status, Unavailable};
use crate::ssh::conn::Connection as SshConnection;
use crate::ssh::engine::HostEngine;

/// Frontend event: a host bridge's status changed (`{ hostId, status }`).
pub const HOST_STATUS_EVENT: &str = "bridge:host-status";
/// Frontend event: a host bridge pushed a notification (`{ hostId, message }`).
pub const HOST_NOTIFICATION_EVENT: &str = "bridge:host-notification";

/// How often a host without a bridge is looked at again.
const REDISCOVER_EVERY: Duration = Duration::from_secs(30);
/// Longest wait between reconnects to a bridge that went away.
const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// One host bridge's status, as the frontend receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostBridgeStatus {
    pub host_id: String,
    pub status: Status,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostNotification {
    host_id: String,
    message: Value,
}

#[derive(Default)]
struct Link {
    status: Option<Status>,
    connection: Option<Arc<Connection>>,
    /// The engine this link rides, by its connection generation: a link of an
    /// older engine never overwrites a newer one's state.
    generation: u64,
    retry: Arc<Notify>,
}

/// Every connected host's bridge link, held in `AppState`.
pub struct HostBridges {
    /// This profile's name on a bridge — the same one it has on the local one.
    client_id: String,
    links: Mutex<HashMap<String, Link>>,
}

impl HostBridges {
    pub fn new(client_id: String) -> Arc<Self> {
        Arc::new(Self {
            client_id,
            links: Mutex::new(HashMap::new()),
        })
    }

    /// The status of every host that has, or had, a link this run.
    pub async fn statuses(&self) -> Vec<HostBridgeStatus> {
        let links = self.links.lock().await;
        let mut out: Vec<HostBridgeStatus> = links
            .iter()
            .filter_map(|(host_id, link)| {
                link.status.clone().map(|status| HostBridgeStatus {
                    host_id: host_id.clone(),
                    status,
                })
            })
            .collect();
        out.sort_by(|a, b| a.host_id.cmp(&b.host_id));
        out
    }

    /// Look again now, instead of at the next rediscovery.
    pub async fn retry(&self, host_id: &str) {
        if let Some(link) = self.links.lock().await.get(host_id) {
            link.retry.notify_one();
        }
    }

    /// Call a method on a host's bridge.
    pub async fn call(
        &self,
        host_id: &str,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, BridgeCallError> {
        if !is_method_name(method) {
            return Err(BridgeCallError::InvalidMethod);
        }
        let connection = self
            .links
            .lock()
            .await
            .get(host_id)
            .and_then(|l| l.connection.clone())
            .ok_or(BridgeCallError::NotConnected)?;
        connection
            .call(method, params, timeout)
            .await
            .map_err(BridgeCallError::Call)
    }

    async fn set<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        host_id: &str,
        generation: u64,
        status: Status,
    ) {
        let mut links = self.links.lock().await;
        let link = links.entry(host_id.to_string()).or_default();
        if link.generation > generation {
            return;
        }
        link.generation = generation;
        if link.status.as_ref() == Some(&status) {
            return;
        }
        link.status = Some(status.clone());
        drop(links);
        let _ = app.emit(
            HOST_STATUS_EVENT,
            HostBridgeStatus {
                host_id: host_id.to_string(),
                status,
            },
        );
    }

    async fn set_connection(&self, host_id: &str, generation: u64, c: Option<Arc<Connection>>) {
        let mut links = self.links.lock().await;
        let link = links.entry(host_id.to_string()).or_default();
        if link.generation <= generation {
            link.generation = generation;
            link.connection = c;
        }
    }

    async fn retry_signal(&self, host_id: &str) -> Arc<Notify> {
        let mut links = self.links.lock().await;
        Arc::clone(&links.entry(host_id.to_string()).or_default().retry)
    }
}

/// Start the link for a host engine that just came up. `home` is that
/// account's home directory, where the bridge keeps its record.
pub fn link<R: tauri::Runtime>(
    app: AppHandle<R>,
    bridges: Arc<HostBridges>,
    host_id: String,
    conn: Arc<SshConnection>,
    engine: Arc<HostEngine>,
    home: String,
) {
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = run(&app, &bridges, &host_id, &conn, &engine, &home) => {}
            _ = engine.lost() => {}
        }
        // The engine went with its connection: so does this link.
        let generation = engine.generation();
        if let Some(c) = bridges
            .links
            .lock()
            .await
            .get_mut(&host_id)
            .filter(|l| l.generation == generation)
            .and_then(|l| l.connection.take())
        {
            c.close();
        }
        bridges.set(&app, &host_id, generation, Status::Off).await;
    });
}

async fn run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    bridges: &HostBridges,
    host_id: &str,
    conn: &SshConnection,
    engine: &HostEngine,
    home: &str,
) {
    let generation = engine.generation();
    let record = crate::ssh::bridge::discovery_path(home);
    let retry = bridges.retry_signal(host_id).await;
    let mut resume: Option<Resume> = None;
    let mut backoff = Duration::from_millis(500);
    loop {
        bridges
            .set(app, host_id, generation, Status::Connecting)
            .await;
        let wait = match open(bridges, conn, engine, &record, resume.as_ref()).await {
            Ok((connection, mut events)) => {
                backoff = Duration::from_millis(500);
                let hello = connection.hello().clone();
                bridges
                    .set_connection(host_id, generation, Some(Arc::clone(&connection)))
                    .await;
                bridges
                    .set(
                        app,
                        host_id,
                        generation,
                        Status::Connected {
                            bridge_version: hello.bridge_version,
                            instance_id: hello.instance_id,
                            managed: false,
                        },
                    )
                    .await;
                while let Some(Event::Notification { message, .. }) = events.recv().await {
                    let _ = app.emit(
                        HOST_NOTIFICATION_EVENT,
                        HostNotification {
                            host_id: host_id.to_string(),
                            message,
                        },
                    );
                }
                resume = Some(connection.resume_point());
                bridges.set_connection(host_id, generation, None).await;
                // Promptly: a bridge that restarted (an update) is back soon.
                Duration::from_millis(500)
            }
            Err((reason, detail)) => {
                let absent = reason == Unavailable::NotRunning;
                bridges
                    .set(
                        app,
                        host_id,
                        generation,
                        Status::Unavailable {
                            reason,
                            detail: Some(detail),
                        },
                    )
                    .await;
                if absent {
                    REDISCOVER_EVERY
                } else {
                    let now = backoff;
                    backoff = (backoff * 2).min(MAX_BACKOFF);
                    now
                }
            }
        };
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = retry.notified() => {}
        }
    }
}

type Opened = (Arc<Connection>, mpsc::UnboundedReceiver<Event>);

async fn open(
    bridges: &HostBridges,
    conn: &SshConnection,
    engine: &HostEngine,
    record: &str,
    resume: Option<&Resume>,
) -> Result<Opened, (Unavailable, String)> {
    let discovery = match crate::ssh::bridge::discover(engine, record).await {
        Ok(Some(discovery)) => discovery,
        Ok(None) => {
            return Err((
                Unavailable::NotRunning,
                "no bridge is running on that host".to_string(),
            ))
        }
        Err(e) => return Err((Unavailable::Failed, e.to_string())),
    };
    let stream = crate::ssh::bridge::dial(conn, &discovery)
        .await
        // A record whose bridge is gone (killed, never cleaned up): there is
        // no bridge to talk to, which is what "not running" says.
        .map_err(|e| (Unavailable::NotRunning, e.to_string()))?;
    let (tx, rx) = mpsc::unbounded_channel();
    match Connection::open_over(stream, &discovery, &bridges.client_id, resume, tx).await {
        Ok(connection) => Ok((connection, rx)),
        Err(ConnectError::Rejected(status)) => Err((
            Unavailable::Rejected,
            format!("the host's bridge refused this app (HTTP {status})"),
        )),
        Err(err @ ConnectError::Refused(_)) => Err((Unavailable::NotRunning, err.to_string())),
        Err(err) => Err((Unavailable::Failed, err.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_host_without_a_link_is_not_connected_and_odd_methods_are_refused() {
        let bridges = HostBridges::new("desktop-0123456789ab".into());
        assert_eq!(
            bridges
                .call("h1", "bridge/status", Value::Null, Duration::from_secs(1))
                .await,
            Err(BridgeCallError::NotConnected)
        );
        assert_eq!(
            bridges
                .call("h1", "not a method", Value::Null, Duration::from_secs(1))
                .await,
            Err(BridgeCallError::InvalidMethod)
        );
        assert!(bridges.statuses().await.is_empty());
    }

    #[tokio::test]
    async fn an_older_engines_link_never_overwrites_a_newer_ones_state() {
        // A reconnect brings a new engine while the old link may still be
        // winding down: whatever the old one says last must not win.
        let app = tauri::test::mock_app();
        let bridges = HostBridges::new("desktop-0123456789ab".into());
        bridges.set(app.handle(), "h1", 2, Status::Connecting).await;
        bridges.set(app.handle(), "h1", 1, Status::Off).await;
        assert_eq!(
            bridges.statuses().await,
            vec![HostBridgeStatus {
                host_id: "h1".into(),
                status: Status::Connecting
            }]
        );
    }
}
