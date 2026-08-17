//! What the host is listening on, when the user asks.
//!
//! **Why this is a button and not a poll.** A command on a host costs seconds
//! because its `sshd` starts a shell for it (`02g` §5.3), so asking every few
//! seconds would keep one channel permanently busy on someone else's machine to
//! answer a question they usually are not asking. The ports a dev server
//! *announces* are picked up for free from what the terminal prints
//! (`super::portscan`); this is the deliberate second way in, for the servers
//! that announce nothing or were already running before uxnan opened.
//!
//! **Nothing is installed and nothing is assumed.** The command is chosen from
//! the shell the host reported ([`super::shellkind`]), and a host whose shell
//! could not be named is sent nothing at all — the caller says the ports were
//! not read, which is true, instead of showing a list it invented.
//!
//! **Three output shapes, one parser.** `ss` on modern Linux, `netstat` on
//! Windows, and BSD `netstat` on macOS — which spells an address `127.0.0.1.5173`
//! with a dot, not a colon. The parser reads all three rather than the command
//! being told which host it is on: `uname` would be one more round trip to
//! answer a question the output already answers.

use super::conn::Connection;
use super::shellkind::ShellKind;
use crate::error::AppError;

const BEGIN: &str = "__UXNAN_PORTS_BEGIN__";
const END: &str = "__UXNAN_PORTS_END__";

/// One TCP port the host is listening on.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    pub port: u16,
    /// Whether it is bound to loopback only. It changes what forwarding is
    /// *for*: a service on `0.0.0.0` is already reachable from this network by
    /// its own address, while a loopback one can be reached no other way — which
    /// is exactly the case a forward exists to solve.
    pub loopback: bool,
    /// Where to knock **on that machine**, and why this is not always
    /// `127.0.0.1`: a service bound to one specific address — a VPN interface,
    /// a LAN address — does not answer on the host's loopback at all, so a
    /// tunnel aimed there reaches nothing. Empty when the port is on a wildcard
    /// address, which loopback already covers.
    pub address: String,
}

/// Ask the host what it is listening on.
pub async fn listening(conn: &Connection, kind: ShellKind) -> Result<Vec<ListeningPort>, AppError> {
    if kind == ShellKind::Unknown {
        return Err(AppError::Invalid(
            "this host's shell could not be named, so nothing was sent to it".to_string(),
        ));
    }
    let out = conn.exec(&script(kind)).await?;
    Ok(parse(&out.stdout))
}

/// The command, per shell family.
///
/// Sequenced with the shell's own separator rather than `&&`, for the reason the
/// git script carries in its comment: a step that fails must not swallow the end
/// marker. Here the *first* step is expected to fail on plenty of hosts (`ss` is
/// not on macOS, and not on older Linux either), which is what the `||` chain is
/// for — it walks down to whatever that machine does have.
fn script(kind: ShellKind) -> String {
    let listing = match kind {
        // `-H` drops the header on `ss`; the two netstat fallbacks are for a
        // host without it (older Linux) and for macOS/BSD, whose netstat has no
        // `-l` at all.
        ShellKind::Posix => {
            "ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null || netstat -an -p tcp 2>/dev/null"
        }
        // One binary, both Windows shells: `Get-NetTCPConnection` exists only on
        // PowerShell and would need a second code path to say the same thing.
        ShellKind::Cmd | ShellKind::PowerShell => "netstat -ano -p tcp",
        ShellKind::Unknown => unreachable!("the caller refuses an unnamed shell"),
    };
    let sep = if kind == ShellKind::Cmd { " & " } else { " ; " };
    [
        format!("echo {BEGIN}"),
        listing.to_string(),
        format!("echo {END}"),
    ]
    .join(sep)
}

/// Read the ports out of whichever tool answered.
///
/// Everything outside the markers is discarded — a login banner or a shell
/// profile's chatter is not data (the same guard the inventory and the git
/// script use), and on `cmd` the marker's own line goes with it, because `cmd`
/// prints the space in front of its `&` separator.
fn parse(stdout: &str) -> Vec<ListeningPort> {
    let Some(start) = stdout.find(BEGIN) else {
        return Vec::new();
    };
    let body = &stdout[start + BEGIN.len()..];
    let body = match body.find(END) {
        Some(end) => &body[..end],
        None => body,
    };

    // The same port bound several times (IPv4 and IPv6, or several interfaces)
    // is one port to a person, so the bindings are folded per port.
    let mut order: Vec<u16> = Vec::new();
    let mut seen: std::collections::HashMap<u16, Vec<Bind>> = std::collections::HashMap::new();
    for line in body.lines() {
        let Some((port, bind)) = listening_line(line) else {
            continue;
        };
        let binds = seen.entry(port).or_insert_with(|| {
            order.push(port);
            Vec::new()
        });
        binds.push(bind);
    }

    let mut found: Vec<ListeningPort> = order
        .into_iter()
        .map(|port| {
            let binds = &seen[&port];
            // Reachable from outside if *any* binding is not loopback…
            let loopback = binds.iter().all(|b| matches!(b, Bind::Loopback));
            // …and a tunnel needs an explicit address only when **none** of the
            // bindings answers on the host's own loopback. A wildcard does; a
            // service pinned to one interface (a VPN address, a LAN address)
            // does not, and aiming a tunnel at `127.0.0.1` there reaches
            // nothing — which is the failure this field exists to prevent.
            let on_loopback = binds
                .iter()
                .any(|b| matches!(b, Bind::Loopback | Bind::Wildcard));
            let address = if on_loopback {
                String::new()
            } else {
                binds
                    .iter()
                    .find_map(|b| match b {
                        Bind::Specific(address) => Some(address.clone()),
                        _ => None,
                    })
                    .unwrap_or_default()
            };
            ListeningPort {
                port,
                loopback,
                address,
            }
        })
        .collect();
    found.sort();
    found
}

/// Where a listening socket is bound, in the only three shapes that change what
/// a tunnel has to do.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Bind {
    /// `127.0.0.1`, `::1` — reachable from the host itself and nowhere else.
    Loopback,
    /// `0.0.0.0`, `[::]` — every address, loopback included.
    Wildcard,
    /// One address of that machine, and only that one.
    Specific(String),
}

/// One line of `ss` / `netstat` output, if it describes a listening TCP socket.
fn listening_line(line: &str) -> Option<(u16, Bind)> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.len() < 4 {
        return None;
    }
    // Windows netstat and BSD netstat both name the state in the last field;
    // Linux netstat does too. `ss -ltnH` puts it first. Only listening sockets
    // are of interest, and a connection *to* a port would otherwise be read as
    // a service on it.
    let state_first = fields[0].eq_ignore_ascii_case("LISTEN");
    let state_last = fields
        .last()
        .is_some_and(|f| f.eq_ignore_ascii_case("LISTENING") || f.eq_ignore_ascii_case("LISTEN"));
    // Windows `netstat -ano` ends each line with the pid, so the state is the
    // field before it.
    let state_penultimate = fields.len() >= 2
        && fields[fields.len() - 2].eq_ignore_ascii_case("LISTENING")
        && fields[fields.len() - 1].chars().all(|c| c.is_ascii_digit());
    if !(state_first || state_last || state_penultimate) {
        return None;
    }

    // The local address is the first field that parses as one — `ss` puts it
    // fourth, Linux netstat fourth, Windows netstat second. Reading it by
    // position would mean knowing which tool answered, which is what this
    // parser exists to avoid.
    fields
        .iter()
        .skip(usize::from(state_first))
        .find_map(|field| address(field))
}

/// An `address:port` (or BSD's `address.port`), as a port and where it is bound.
fn address(field: &str) -> Option<(u16, Bind)> {
    // A peer column is a wildcard (`0.0.0.0:*`, `*.*`, `[::]:*`) and is not a
    // port anybody listens on.
    if field.ends_with('*') {
        return None;
    }
    let (host, port) = field.rsplit_once([':', '.'])?;
    let port: u16 = port.parse().ok()?;
    if port == 0 {
        return None;
    }
    let host = host.trim_start_matches('[').trim_end_matches(']');
    // `::ffff:127.0.0.1` is a v4 address wearing a v6 spelling; taking the tail
    // covers it without a second branch.
    let bare = host.rsplit(':').next().unwrap_or(host);
    let bind = if bare.starts_with("127.") || bare == "::1" || bare == "localhost" || bare == "1" {
        Bind::Loopback
    } else if host.is_empty() || host == "0.0.0.0" || host == "::" || host == "*" {
        Bind::Wildcard
    } else {
        Bind::Specific(host.to_string())
    };
    Some((port, bind))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrap(body: &str) -> String {
        format!("{BEGIN}\n{body}\n{END}\n")
    }

    #[test]
    fn it_reads_ss_output_from_a_linux_host() {
        // Real `ss -ltnH` shape: state first, addresses fourth and fifth.
        let out = wrap(
            "LISTEN 0      4096         0.0.0.0:22        0.0.0.0:*\n\
             LISTEN 0      511        127.0.0.1:5173      0.0.0.0:*\n\
             LISTEN 0      4096            [::]:22           [::]:*",
        );
        assert_eq!(
            parse(&out),
            vec![
                ListeningPort {
                    port: 22,
                    loopback: false,
                    address: String::new()
                },
                ListeningPort {
                    port: 5173,
                    loopback: true,
                    address: String::new()
                },
            ]
        );
    }

    #[test]
    fn it_reads_windows_netstat_output() {
        // `netstat -ano -p tcp`: address second, state fifth, pid last. The pid
        // must not be mistaken for a port, and an ESTABLISHED row must not be
        // read as a service.
        let out = wrap(
            "  Proto  Local Address          Foreign Address        State           PID\n\
             \x20 TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234\n\
             \x20 TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9876\n\
             \x20 TCP    192.168.1.20:52210     93.184.216.34:443      ESTABLISHED     4242",
        );
        assert_eq!(
            parse(&out),
            vec![
                ListeningPort {
                    port: 135,
                    loopback: false,
                    address: String::new()
                },
                ListeningPort {
                    port: 5173,
                    loopback: true,
                    address: String::new()
                },
            ]
        );
    }

    #[test]
    fn it_reads_bsd_netstat_which_spells_a_port_with_a_dot() {
        // macOS has no `ss`, and its netstat writes `127.0.0.1.5173`. A parser
        // that only knew colons would report a machine with nothing listening.
        let out = wrap(
            "tcp4       0      0  127.0.0.1.5173         *.*                    LISTEN\n\
             tcp4       0      0  *.22                   *.*                    LISTEN",
        );
        assert_eq!(
            parse(&out),
            vec![
                ListeningPort {
                    port: 22,
                    loopback: false,
                    address: String::new()
                },
                ListeningPort {
                    port: 5173,
                    loopback: true,
                    address: String::new()
                },
            ]
        );
    }

    #[test]
    fn the_same_port_on_two_stacks_is_one_port() {
        // A dev server bound on both IPv4 and IPv6 is one server. And it counts
        // as reachable from outside if any of its addresses is.
        let out = wrap(
            "LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*\n\
             LISTEN 0 511 [::]:3000 [::]:*",
        );
        assert_eq!(
            parse(&out),
            vec![ListeningPort {
                port: 3000,
                loopback: false,
                address: String::new()
            }]
        );
    }

    #[test]
    fn a_shell_profile_talking_before_the_marker_is_not_data() {
        // The failure this rules out: a banner line that happens to contain
        // something colon-shaped being reported as a port on the host.
        let out = format!(
            "Welcome to host:9999\n{}",
            wrap("LISTEN 0 511 127.0.0.1:8080 0.0.0.0:*")
        );
        assert_eq!(
            parse(&out),
            vec![ListeningPort {
                port: 8080,
                loopback: true,
                address: String::new()
            }]
        );
    }

    #[test]
    fn a_port_pinned_to_one_interface_reports_where_to_knock() {
        // The case a real host hit: a service bound to the machine's VPN address
        // and nowhere else. Its own loopback answers nothing, so a tunnel aimed
        // at `127.0.0.1` there reaches nothing — the address has to travel.
        let out = wrap("LISTEN 0 511 100.101.102.103:8080 0.0.0.0:*");
        assert_eq!(
            parse(&out),
            vec![ListeningPort {
                port: 8080,
                loopback: false,
                address: "100.101.102.103".to_string()
            }]
        );
    }

    #[test]
    fn a_wildcard_binding_needs_no_address_even_next_to_a_pinned_one() {
        // `0.0.0.0` includes loopback, so the tunnel's default target works and
        // carrying an interface address would only make it fragile.
        let out = wrap(
            "LISTEN 0 511 100.101.102.103:8080 0.0.0.0:*\n\
             LISTEN 0 511 0.0.0.0:8080 0.0.0.0:*",
        );
        assert_eq!(
            parse(&out),
            vec![ListeningPort {
                port: 8080,
                loopback: false,
                address: String::new()
            }]
        );
    }

    #[test]
    fn no_marker_means_no_answer_rather_than_an_empty_machine() {
        // A command that never ran (no shell, a refused channel) must not read
        // as "this host is listening on nothing".
        assert!(parse("bash: ss: command not found\n").is_empty());
    }

    #[test]
    fn cmd_gets_its_own_separator() {
        // `;` is not a statement separator in cmd — it would end up as an
        // argument, and the marker line would never be printed.
        assert!(script(ShellKind::Cmd).contains(" & "));
        assert!(!script(ShellKind::Cmd).contains(" ; "));
        assert!(script(ShellKind::Posix).contains(" ; "));
    }

    /// Against the `sshd` of this machine: the command as it is really sent, and
    /// the output as that machine's netstat really writes it.
    ///
    /// The unit tests above are fed captured output, which proves the parser and
    /// nothing about the command. This is the half that has bitten this layer
    /// twice: a script that is valid until a real shell reads it.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn ports_live_reads_what_this_machine_is_listening_on() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the recorded key should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        // A port this test owns, so the answer can be checked against something
        // known rather than against whatever happens to run on this machine.
        let held = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let mine = held.local_addr().unwrap().port();

        let kind = crate::ssh::shellkind::classify(&conn).await;
        let ports = listening(&conn, kind).await.expect("the host answers");
        println!(
            "live: {} listening ports through a {} shell, mine is {mine}",
            ports.len(),
            kind.as_str()
        );

        assert!(
            ports.iter().any(|p| p.port == 22),
            "the sshd answering this test is itself a listening port"
        );
        let found = ports
            .iter()
            .find(|p| p.port == mine)
            .expect("the port this test holds");
        assert!(found.loopback, "it was bound to 127.0.0.1");
    }

    #[test]
    fn the_posix_script_walks_down_to_what_the_host_has() {
        // `ss` is absent on macOS and on older Linux, so the first step failing
        // is the expected case rather than an error.
        let posix = script(ShellKind::Posix);
        assert!(posix.contains("ss -ltnH"));
        assert!(posix.contains("netstat -ltn"));
        assert!(posix.contains("netstat -an -p tcp"));
    }
}
