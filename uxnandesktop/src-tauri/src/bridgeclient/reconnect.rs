//! When to try a bridge again — the one policy both supervisors follow (this
//! machine's bridge in `mod.rs`, a host's in `hosts.rs`).
//!
//! A connection that ended after it had been up for a while is retried
//! promptly: the bridge restarted (an update) or the socket was superseded,
//! and the chat should not stay dark. One that ended right after its hello is
//! a failure like any refused attempt, and waits out a growing backoff. Before
//! that distinction a connection the bridge dropped at once — every time, for
//! the same reason (a response over the frame limit, asked again by the resync
//! that follows every connect) — was reopened at once, about twice a second,
//! for as long as the app ran, and each round cost the bridge the whole
//! response again.

use std::time::Duration;

/// The wait after a connection that was up long enough to count as healthy.
pub const PROMPT_RETRY: Duration = Duration::from_millis(500);
/// How long a connection must have been up for its end not to count as a failure.
pub const STABLE_AFTER: Duration = Duration::from_secs(10);
/// The first wait after a failure.
const FIRST_BACKOFF: Duration = Duration::from_millis(500);
/// Longest wait between attempts.
pub const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// The reconnect policy's state for one supervisor.
#[derive(Debug, Clone)]
pub struct Reconnect {
    next: Duration,
}

impl Default for Reconnect {
    fn default() -> Self {
        Self {
            next: FIRST_BACKOFF,
        }
    }
}

impl Reconnect {
    /// The wait after an attempt that did not connect; each one doubles the next.
    pub fn after_failure(&mut self) -> Duration {
        let wait = self.next;
        self.next = (self.next * 2).min(MAX_BACKOFF);
        wait
    }

    /// The wait after a connection that was up for [lived] ended: prompt, and
    /// the backoff starts over, when it was healthy; a failure otherwise.
    pub fn after_close(&mut self, lived: Duration) -> Duration {
        if lived >= STABLE_AFTER {
            self.next = FIRST_BACKOFF;
            PROMPT_RETRY
        } else {
            self.after_failure()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_back_off_up_to_the_cap() {
        let mut policy = Reconnect::default();
        let waits: Vec<_> = (0..8).map(|_| policy.after_failure()).collect();
        assert_eq!(waits[0], Duration::from_millis(500));
        assert_eq!(waits[1], Duration::from_secs(1));
        assert_eq!(waits[2], Duration::from_secs(2));
        assert_eq!(*waits.last().unwrap(), MAX_BACKOFF);
    }

    #[test]
    fn a_connection_that_dies_at_once_backs_off_like_a_failure() {
        let mut policy = Reconnect::default();
        let waits: Vec<_> = (0..4)
            .map(|_| policy.after_close(Duration::from_millis(300)))
            .collect();
        assert_eq!(
            waits,
            vec![
                Duration::from_millis(500),
                Duration::from_secs(1),
                Duration::from_secs(2),
                Duration::from_secs(4),
            ]
        );
    }

    #[test]
    fn a_healthy_connection_is_retried_promptly_and_resets_the_backoff() {
        let mut policy = Reconnect::default();
        policy.after_failure();
        policy.after_failure();
        assert_eq!(policy.after_close(STABLE_AFTER), PROMPT_RETRY);
        assert_eq!(policy.after_failure(), Duration::from_millis(500));
    }
}
