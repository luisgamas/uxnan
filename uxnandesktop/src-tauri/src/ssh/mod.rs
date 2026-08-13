//! Remote hosts over SSH: the machine an agent runs on when it is not this one.
//!
//! The model is the one every mature remote client converges on — **the UI stays
//! local, the work happens on the host**. Agents run there, with the CLIs and the
//! credentials that host already has; uxnan is the control surface. Running a
//! local agent against a remotely-mounted filesystem is the arrangement this
//! deliberately does *not* implement: the agent's own tools (build, tests, git)
//! would execute here, against a network mount, which is the opposite of why
//! anyone reaches for a bigger machine.
//!
//! Trust posture, stated once so nothing downstream has to guess: an SSH host is
//! *"my machine, my account"*. A session is worth exactly what the user's shell
//! on that host is worth, so this layer does not claim to impose a permission
//! ceiling — that is a different (and much heavier) design, and pretending
//! otherwise in the UI would be a lie. What it does guarantee is that work lands
//! on the host the user *meant*: see [`crate::target`].
//!
//! Secrets: none are stored. A host record keeps alias, hostname, port, user and
//! a *reference* to an identity file — never a key, never a password. The
//! system's ssh-agent, the key file on disk and an in-memory prompt supply the
//! rest, which is also why `ForwardAgent` matters: it lets git on the remote use
//! the keys held here without a private key ever being copied.

pub mod config;
pub mod hostkey;
