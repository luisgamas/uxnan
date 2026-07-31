//! L3 — the resource monitor against real, spawned processes.
//!
//! The unit tests prove the attribution rules on synthetic tables; what they
//! cannot prove is that the same rules hold against the OS: that `sysinfo`
//! start times round-trip through the probe within tolerance, that a real
//! shell's child is discovered by parent-chain walking, and that a subtree
//! which outlives its closed owner is re-identified as an orphan and released
//! when it ends.
//!
//! The processes are the test's own (a throwaway `cmd /c ping` tree on
//! Windows, `sh -c "sleep …"` elsewhere) and are killed by pid on the way out
//! — never by name.

use std::process::{Child, Command, Stdio};
use std::time::Duration;

use uxnan_desktop_lib::resources::{
    AttributionConfidence, Collector, ConsumerKind, MonitorConfig, ResourceMonitor,
    ResourceOwnerKind, ResourceSummary,
};

/// Spawn a two-level tree: a shell whose child sleeps for ~30 s. Long enough
/// that the test never races its natural end; short enough that a leak from an
/// aborted run cleans itself up.
fn spawn_shell_tree() -> Child {
    if cfg!(windows) {
        Command::new("cmd.exe")
            .args(["/c", "ping -n 30 127.0.0.1 > NUL"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("cmd.exe should spawn")
    } else {
        Command::new("sh")
            .args(["-c", "sleep 30; true"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("sh should spawn")
    }
}

/// Kill one specific pid — only ever a pid this test created.
fn kill_pid(pid: u32) {
    if cfg!(windows) {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

fn workspace_group(
    summary: &ResourceSummary,
) -> Option<&uxnan_desktop_lib::resources::GroupSummary> {
    summary
        .groups
        .iter()
        .find(|g| g.kind == ResourceOwnerKind::Workspace && !g.ended)
}

#[test]
fn attributes_a_real_shell_tree_then_reports_its_survivor_as_an_orphan() {
    let monitor = ResourceMonitor::new(MonitorConfig::default());
    let mut shell = spawn_shell_tree();
    let shell_pid = shell.id();

    // The probe and the table must agree on the process's start time — that
    // agreement is the whole identity scheme.
    let start = Collector::probe_start_time(shell_pid);
    monitor.register_terminal("pty-int", shell_pid, start, Some("bench-ws".into()));
    monitor.subscribe("int-test", ConsumerKind::Popover, now());

    let mut collector = Collector::new();
    let me = std::process::id();

    // Sample until the child process is visible under the shell (spawning it
    // takes the OS a moment). The shell itself must be attributed immediately.
    let mut summary = monitor.ingest(now(), me, collector.collect());
    let mut child_pid: Option<u32> = None;
    for _ in 0..40 {
        if let Some(group) = workspace_group(&summary) {
            if group.metrics.processes >= 2 {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(250));
        summary = monitor.ingest(now(), me, collector.collect());
    }
    {
        let group =
            workspace_group(&summary).expect("the registered shell forms a workspace group");
        assert!(
            group.metrics.processes >= 2,
            "the shell's child never appeared under it (got {} processes)",
            group.metrics.processes
        );
        // pid + start time verified for the shell, parent-chain for the child:
        // the group's combined confidence is inferred when start times are
        // readable, and must never claim exact for the whole subtree.
        assert_ne!(group.confidence, AttributionConfidence::Unknown);
        assert!(
            group.metrics.resident_bytes.is_some(),
            "a live group reports memory"
        );
    }

    // Find the child's pid from the shell's process table entry (the survivor
    // we will assert on, and the one we must clean up).
    let table = collector.collect();
    for (pid, row) in &table {
        if row.parent == Some(shell_pid) {
            child_pid = Some(*pid);
        }
    }
    let child_pid = child_pid.expect("the shell has a child in the live table");

    // Close the terminal (snapshotting members), then kill only the shell.
    // The sleeping child survives its owner — the textbook orphan.
    monitor.terminal_closed("pty-int", now());
    let _ = shell.kill();
    let _ = shell.wait();
    std::thread::sleep(Duration::from_millis(500));

    let mut summary = monitor.ingest(now(), me, collector.collect());
    let mut found_orphan = false;
    for _ in 0..20 {
        if summary.orphans.iter().any(|o| o.pids.contains(&child_pid)) {
            found_orphan = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
        summary = monitor.ingest(now(), me, collector.collect());
    }
    // On Windows, killing the `cmd` shell leaves `ping` running; on Unix,
    // killing `sh` leaves `sleep`. Either way the child must be re-identified.
    assert!(
        found_orphan,
        "the surviving child was not reported as an orphan: {:?}",
        summary.orphans
    );
    let orphan = summary
        .orphans
        .iter()
        .find(|o| o.pids.contains(&child_pid))
        .unwrap();
    assert_eq!(
        orphan.confidence,
        AttributionConfidence::Exact,
        "identity is re-verified by start time, so the claim is exact"
    );

    // End the survivor: the orphan report must clear on the next sample.
    kill_pid(child_pid);
    std::thread::sleep(Duration::from_millis(500));
    let mut summary = monitor.ingest(now(), me, collector.collect());
    for _ in 0..20 {
        if summary.orphans.iter().all(|o| !o.pids.contains(&child_pid)) {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
        summary = monitor.ingest(now(), me, collector.collect());
    }
    assert!(
        summary.orphans.iter().all(|o| !o.pids.contains(&child_pid)),
        "a dead survivor must stop being reported"
    );
}

#[test]
fn probe_start_time_matches_the_full_table_read() {
    let mut shell = spawn_shell_tree();
    let pid = shell.id();
    let probed = Collector::probe_start_time(pid);

    let mut collector = Collector::new();
    let table = collector.collect();
    let in_table = table.get(&pid).and_then(|row| row.start_time_secs);

    // Clean up before asserting so a failure never leaks the tree.
    let _ = shell.kill();
    let _ = shell.wait();

    match (probed, in_table) {
        (Some(a), Some(b)) => assert!(
            a.abs_diff(b) <= 2,
            "probe ({a}) and table ({b}) disagree beyond tolerance"
        ),
        // A platform that reports no start time must do so consistently.
        (None, None) => {}
        other => panic!("probe and table disagree on availability: {other:?}"),
    }
}

#[test]
fn a_terminated_process_is_no_longer_attributed() {
    let monitor = ResourceMonitor::new(MonitorConfig::default());
    let mut shell = spawn_shell_tree();
    let shell_pid = shell.id();
    let start = Collector::probe_start_time(shell_pid);
    monitor.register_terminal("pty-gone", shell_pid, start, Some("ws".into()));
    monitor.subscribe("int-test-2", ConsumerKind::Popover, now());

    let mut collector = Collector::new();
    let me = std::process::id();
    let summary = monitor.ingest(now(), me, collector.collect());
    assert!(workspace_group(&summary).is_some());

    // Kill the whole tree, then sample: the live group disappears and the
    // summary reports it as ended instead (last-known metrics, honest flag).
    kill_pid(shell_pid);
    let _ = shell.kill();
    let _ = shell.wait();
    std::thread::sleep(Duration::from_millis(500));

    let mut summary = monitor.ingest(now(), me, collector.collect());
    for _ in 0..20 {
        if workspace_group(&summary).is_none() {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
        summary = monitor.ingest(now(), me, collector.collect());
    }
    assert!(
        workspace_group(&summary).is_none(),
        "a killed tree must not stay attributed as live"
    );
    assert!(
        summary
            .groups
            .iter()
            .any(|g| g.kind == ResourceOwnerKind::Workspace && g.ended),
        "the vanished group is reported as ended"
    );
}

fn now() -> u64 {
    uxnan_desktop_lib::resources::now_ms()
}
