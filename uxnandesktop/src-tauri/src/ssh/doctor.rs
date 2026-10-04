//! A host's connection, step by step, for the host page's check.
//!
//! What the window shows as a checklist — the way there, whether it answers,
//! its key, the sign-in, the shell, the engine and the round trip — read from
//! what this app knows and one plain TCP probe, never a second sign-in: a check
//! that asked for a password to tell you the password works would be a check
//! nobody runs. Facts, not sentences: the window words them, in its language.

use std::time::{Duration, Instant};

use serde::Serialize;

/// How long the reachability probe waits for the first hop to answer.
const REACH_WAIT: Duration = Duration::from_secs(5);

/// The engine as it introduced itself.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DoctorEngine {
    pub version: String,
    pub protocol: u32,
    pub os: String,
    pub arch: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostDoctor {
    /// The way there: each bastion's label, then the host's.
    pub hops: Vec<String>,
    /// The first hop is reached through a `ProxyCommand`, which the TCP probe
    /// cannot stand in for.
    pub proxy_command: bool,
    /// The configuration could not be read into a route.
    pub route_error: Option<String>,
    /// How long the first hop took to accept a TCP connection.
    pub reach_ms: Option<u64>,
    pub reach_error: Option<String>,
    /// A key is on file for the host, or its configuration accepts new ones.
    pub key_settled: bool,
    /// A live session to the host right now.
    pub connected: bool,
    /// The shell its `sshd` starts, as it reported (`posix`, `cmd`, …).
    pub shell: Option<String>,
    pub engine: Option<DoctorEngine>,
    /// Why the engine is not running there.
    pub engine_error: Option<String>,
    /// One request to the engine and back, over the session.
    pub round_trip_ms: Option<u64>,
    /// The configuration forwards this machine's agent to the host.
    pub forward_agent: bool,
}

/// The route half of the check, filled from the host's resolved route.
pub async fn route_facts(host: &crate::model::SshHost, doctor: &mut HostDoctor) {
    match super::dial::route_for(host).await {
        Ok(route) => {
            doctor.hops = route.hops.iter().map(|h| h.label.clone()).collect();
            let first = &route.hops[0];
            let target = route.target();
            doctor.proxy_command = first.resolved.proxy_command.is_some();
            doctor.forward_agent = target.resolved.forward_agent;
            doctor.key_settled = target.key_is_settled();
            if !doctor.proxy_command {
                let (ms, error) = reach(&first.resolved.hostname, first.resolved.port).await;
                doctor.reach_ms = ms;
                doctor.reach_error = error;
            }
        }
        Err(e) => doctor.route_error = Some(e.to_string()),
    }
}

/// Open a TCP connection to `hostname:port` and close it: whether the machine
/// answers, and how quickly.
pub async fn reach(hostname: &str, port: u16) -> (Option<u64>, Option<String>) {
    let started = Instant::now();
    match tokio::time::timeout(REACH_WAIT, tokio::net::TcpStream::connect((hostname, port))).await {
        Ok(Ok(_)) => (Some(started.elapsed().as_millis() as u64), None),
        Ok(Err(e)) => (None, Some(e.to_string())),
        Err(_) => (
            None,
            Some(format!("no answer in {} s", REACH_WAIT.as_secs())),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_listening_port_answers_and_a_closed_one_says_why() {
        let held = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = held.local_addr().unwrap().port();
        let (ms, error) = reach("127.0.0.1", port).await;
        assert!(ms.is_some() && error.is_none(), "{error:?}");
        drop(held);
        let (ms, error) = reach("127.0.0.1", port).await;
        assert!(ms.is_none());
        assert!(error.is_some());
    }
}
