//! What a run costs, measured the way the runner measures it.
//!
//! The number that matters is the **tree's**: an agent's own process is small,
//! and the memory is in what it spawned. Proving that needs a process that
//! really holds an allocation — a shell trick does not, which is how the first
//! version of this test passed while measuring nothing. So this test re-enters
//! its own binary: a parent that spawns an allocating child, both alive while
//! the measurement is taken.

use std::time::Duration;

use uxnan_desktop_lib::agentrun::{kill_tree, tree_memory_mb};

const ROLE: &str = "UXNAN_MEMORY_TEST_ROLE";
const MB: &str = "UXNAN_MEMORY_TEST_MB";

/// Re-entry point. `parent` spawns a `child` and waits; `child` holds the
/// allocation. Either way it prints a line the parent test can wait for, so
/// the measurement never races the allocation.
#[test]
fn memory_helper() {
    let Ok(role) = std::env::var(ROLE) else {
        return; // an ordinary test run
    };
    let mb: usize = std::env::var(MB)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(128);
    match role.as_str() {
        "parent" => {
            let exe = std::env::current_exe().expect("test binary");
            let mut child = std::process::Command::new(exe)
                .args(["memory_helper", "--exact", "--nocapture"])
                .env(ROLE, "child")
                .env(MB, mb.to_string())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::null())
                .spawn()
                .expect("spawn the allocating child");
            std::thread::sleep(Duration::from_secs(30));
            let _ = child.kill();
            // Reap it: a helper that leaves a zombie behind is a helper that
            // pollutes the process table the very sampler under test reads.
            let _ = child.wait();
        }
        _ => {
            // Touch every page: an untouched allocation is not resident, and
            // resident is what the sampler (and the machine) actually feels.
            let mut held = vec![0u8; mb * 1024 * 1024];
            for page in held.chunks_mut(4096) {
                page[0] = 1;
            }
            println!("HELD {mb}");
            std::thread::sleep(Duration::from_secs(30));
            // Keep it alive past the sleep so the compiler cannot drop it early.
            std::hint::black_box(&held);
        }
    }
}

#[test]
fn a_run_s_memory_is_the_whole_tree_s() {
    // The parent holds nothing; its child holds 128 MB. Measuring the parent
    // alone would report this run as nearly free — the sampler must walk down.
    let exe = std::env::current_exe().expect("test binary");
    let mut parent = std::process::Command::new(exe)
        .args(["memory_helper", "--exact", "--nocapture"])
        .env(ROLE, "parent")
        .env(MB, "128")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn the helper tree");
    let pid = parent.id();

    // Wait for the grandchild to say it is holding the memory.
    let stdout = parent.stdout.take().expect("piped stdout");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        use std::io::BufRead;
        for line in std::io::BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
        {
            if line.starts_with("HELD ") {
                let _ = tx.send(());
                return;
            }
        }
    });
    let held = rx.recv_timeout(Duration::from_secs(60)).is_ok();
    let measured = if held { tree_memory_mb(pid) } else { 0 };

    kill_tree(pid);
    let _ = parent.wait();

    assert!(held, "the helper never reported holding its allocation");
    assert!(
        measured >= 64,
        "the tree held {measured} MB; the child's 128 MB was not counted"
    );
}
