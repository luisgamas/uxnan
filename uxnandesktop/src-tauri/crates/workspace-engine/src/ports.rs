//! What this machine is listening on — for a host, read by its engine there,
//! where it is a look at the machine rather than a command through its shell.
//!
//! **On Linux the kernel is asked directly** (`/proc/net/tcp`, `tcp6`): nothing
//! to install, nothing to spawn, and it answers inside a container whose image
//! has no `ss`. Elsewhere — and on a Linux whose `/proc` cannot be read — the
//! tool the system has is run directly (no shell between): `lsof` or BSD
//! `netstat` on macOS, `netstat -ano` on Windows, `ss` or `netstat` on Linux.
//!
//! **Four output shapes, one parser.** `ss`, Windows `netstat`, BSD `netstat` —
//! which spells an address `127.0.0.1.5173`, with a dot — and `lsof`. The
//! parser reads them all rather than being told which tool answered.

use serde::{Deserialize, Serialize};

use crate::Error;

/// One TCP port this machine is listening on.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
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

/// What this machine is listening on, now.
pub async fn listening() -> Result<Vec<ListeningPort>, Error> {
    #[cfg(target_os = "linux")]
    if let Ok(Some(found)) = tokio::task::spawn_blocking(from_proc).await {
        return Ok(found);
    }
    let text = tool_listing().await?;
    Ok(parse_listing(&text))
}

/// The listening sockets the kernel lists, or `None` when neither table can
/// be read.
#[cfg(target_os = "linux")]
fn from_proc() -> Option<Vec<ListeningPort>> {
    let v4 = std::fs::read_to_string("/proc/net/tcp").ok();
    let v6 = std::fs::read_to_string("/proc/net/tcp6").ok();
    if v4.is_none() && v6.is_none() {
        return None;
    }
    let mut bindings = Vec::new();
    for text in [v4, v6].into_iter().flatten() {
        bindings.extend(proc_listening(&text));
    }
    Some(fold(bindings))
}

/// The listening sockets of one `/proc/net/tcp{,6}` table: the local address
/// (`hex-ip:hex-port`, the address in the kernel's own byte order) of every
/// row in state `0A`, which is `LISTEN`.
pub fn proc_listening(text: &str) -> Vec<(u16, Bind)> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.get(3) != Some(&"0A") {
                return None;
            }
            let (ip, port) = fields.get(1)?.split_once(':')?;
            let port = u16::from_str_radix(port, 16).ok()?;
            if port == 0 {
                return None;
            }
            Some((port, proc_bind(ip)?))
        })
        .collect()
}

/// A `/proc` address as a binding. Each 32-bit word is printed as the number
/// in memory, so its bytes come back in network order through `to_ne_bytes`.
fn proc_bind(hex: &str) -> Option<Bind> {
    let words: Vec<u32> = (0..hex.len() / 8)
        .map(|i| u32::from_str_radix(&hex[i * 8..i * 8 + 8], 16))
        .collect::<Result<_, _>>()
        .ok()?;
    let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_ne_bytes()).collect();
    let ip: std::net::IpAddr = match bytes.len() {
        4 => std::net::Ipv4Addr::new(bytes[0], bytes[1], bytes[2], bytes[3]).into(),
        16 => {
            let v6 = std::net::Ipv6Addr::from(<[u8; 16]>::try_from(bytes).ok()?);
            // A v4 address wearing a v6 spelling is that v4 address.
            match v6.to_ipv4_mapped() {
                Some(v4) => v4.into(),
                None => v6.into(),
            }
        }
        _ => return None,
    };
    Some(if ip.is_loopback() {
        Bind::Loopback
    } else if ip.is_unspecified() {
        Bind::Wildcard
    } else {
        Bind::Specific(ip.to_string())
    })
}

/// What the system's own tool says, run directly: the first that answers.
async fn tool_listing() -> Result<String, Error> {
    let candidates: &[&[&str]] = if cfg!(windows) {
        &[&["netstat", "-ano", "-p", "tcp"]]
    } else if cfg!(target_os = "linux") {
        &[&["ss", "-ltnH"], &["netstat", "-ltn"]]
    } else {
        // macOS: `lsof` first. A process that is not the person's own shell —
        // a daemon, the engine — gets an empty socket table from `netstat`
        // there (measured), while `lsof` still lists its account's listening
        // sockets, which is what a dev server is. BSD netstat (no `-l`) after.
        &[
            &["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"],
            &["netstat", "-an", "-p", "tcp"],
        ]
    };
    for argv in candidates {
        let Ok(out) = crate::winproc::command(argv[0])
            .args(&argv[1..])
            .output()
            .await
        else {
            continue;
        };
        // Answered, and with something: an empty table from a tool that ran
        // is the case above, not a machine listening on nothing.
        if out.status.success() && !out.stdout.is_empty() {
            return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
        }
    }
    Err(Error::Invalid(
        "this machine has no tool that lists its listening ports".to_string(),
    ))
}

/// The listening ports in `ss` / `netstat` output, whichever answered.
pub fn parse_listing(text: &str) -> Vec<ListeningPort> {
    fold(text.lines().filter_map(listening_line).collect())
}

/// One port per port: the same one bound several times (IPv4 and IPv6, or
/// several interfaces) is one port to a person.
fn fold(bindings: Vec<(u16, Bind)>) -> Vec<ListeningPort> {
    let mut order: Vec<u16> = Vec::new();
    let mut seen: std::collections::HashMap<u16, Vec<Bind>> = std::collections::HashMap::new();
    for (port, bind) in bindings {
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
pub enum Bind {
    /// `127.0.0.1`, `::1` — reachable from the host itself and nowhere else.
    Loopback,
    /// `0.0.0.0`, `[::]` — every address, loopback included.
    Wildcard,
    /// One address of that machine, and only that one.
    Specific(String),
}

/// One line of `ss` / `netstat` / `lsof` output, if it describes a listening
/// TCP socket.
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
    // `lsof` names it last too, in parentheses.
    let state_last = fields.last().is_some_and(|f| {
        f.eq_ignore_ascii_case("LISTENING")
            || f.eq_ignore_ascii_case("LISTEN")
            || f.eq_ignore_ascii_case("(LISTEN)")
    });
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
        body.to_string()
    }

    fn parse(text: &str) -> Vec<ListeningPort> {
        parse_listing(text)
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
    fn it_reads_lsof_which_puts_the_state_in_parentheses() {
        // `lsof -nP -iTCP -sTCP:LISTEN`, what macOS answers a daemon with.
        let out = "COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME\n\
                   rapportd  540 gamas    8u  IPv4 0x1f2e3d4c5b6a7980      0t0  TCP *:49152 (LISTEN)\n\
                   node     1234 gamas   20u  IPv6 0x1f2e3d4c5b6a7981      0t0  TCP [::1]:5173 (LISTEN)\n\
                   node     1234 gamas   21u  IPv4 0x1f2e3d4c5b6a7982      0t0  TCP 127.0.0.1:5173 (LISTEN)";
        assert_eq!(
            parse(out),
            vec![
                ListeningPort {
                    port: 5173,
                    loopback: true,
                    address: String::new()
                },
                ListeningPort {
                    port: 49152,
                    loopback: false,
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
    fn the_kernel_table_is_read_in_its_own_byte_order() {
        // Captured from a Linux host: 127.0.0.1:5173 and 0.0.0.0:22 listening,
        // a connection that is not, and on the v6 table ::1:631 and a v4
        // address in v6 spelling.
        let v4 = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n\
                   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1\n\
                   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2 1\n\
                   2: 0100007F:1435 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 3 1";
        let v6 = "  sl  local_address                         remote_address                        st\n\
                   0: 00000000000000000000000001000000:0277 00000000000000000000000000000000:0000 0A\n\
                   1: 0000000000000000FFFF00000100007F:1F90 00000000000000000000000000000000:0000 0A";
        if cfg!(target_endian = "little") {
            assert_eq!(
                proc_listening(v4),
                vec![(5173, Bind::Loopback), (22, Bind::Wildcard)]
            );
            assert_eq!(
                proc_listening(v6),
                vec![(631, Bind::Loopback), (8080, Bind::Loopback)]
            );
        }
    }

    /// The real thing, on whatever machine runs the tests: a port this test
    /// holds is found, bound to loopback — through `/proc` on Linux, the
    /// system's `netstat` on macOS and Windows.
    #[tokio::test]
    async fn this_machine_says_it_listens_on_a_port_the_test_holds() {
        let held = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mine = held.local_addr().unwrap().port();
        let ports = listening().await.expect("this machine answers");
        let found = ports
            .iter()
            .find(|p| p.port == mine)
            .unwrap_or_else(|| panic!("{mine} not among {ports:?}"));
        assert!(found.loopback, "it was bound to 127.0.0.1");
    }
}
