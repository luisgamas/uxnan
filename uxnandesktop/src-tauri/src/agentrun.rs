//! Headless (print-mode) agent runs for the orchestration engine (spec `02d`
//! §3, Stage B).
//!
//! Where the broadcast/interactive path types a message into a live agent's PTY
//! and can only read the coarse hook `summary`, a **headless** run drives the
//! same local CLI **non-interactively** (`agent -p …`, a one-shot subprocess) and
//! **owns the process** — so it captures the agent's full stdout *and* a verified
//! exit code. That verified completion (exit 0 = done, exit≠0 = failed) is what
//! lets the run engine chain steps robustly and detect failures, instead of
//! trusting a cooperative "I'm done" signal.
//!
//! Built on [`crate::agentcli`] (`resolve` + `build_args`) and the windowless
//! spawn ([`crate::winproc`]), with a hard timeout, a prompt cap for the agents
//! whose only channel is the command line, and a **cap on what is kept of each
//! output stream** (see [`MAX_STREAM_BYTES`]).
//!
//! A run can be **named** ([`RunHandle`]) and then **cancelled**
//! ([`cancel`]) — the one place that ends a headless run before its time,
//! shared by the caller who asks and by the timeout that gives up. Ending it
//! means ending its **whole process tree** ([`kill_tree`]): an agent CLI is a
//! parent of the tools it spawns, and killing only the process we hold leaves
//! them running with nobody watching. **This is the one
//! one-shot runner**: AI commit messages and AI PR bodies
//! ([`crate::aicommit`]) and automation steps go through it too, so they all get
//! the same prompt-delivery handling instead of each re-deriving it.
//!
//! How each CLI is handed its prompt is not incidental: an `argv` prompt is
//! bounded by the OS, and a chained step planting the previous step's whole
//! output hits that ceiling easily — losing the tail of its own context in
//! silence. Agents that read stdin (Claude, Codex, OpenCode, Pi) or a prompt
//! file (Grok, Zero) therefore get the whole thing.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

use crate::agentcli;
use crate::error::AppError;

/// Cap on a prompt passed as a CLI **argument**. Windows' `CreateProcess`
/// command line is bounded (~32 KiB total), so this only applies to the agents
/// that accept the prompt no other way; everything else takes it via stdin or a
/// prompt file and is uncapped (see [`agentcli::prompt_delivery`]).
const MAX_PROMPT_BYTES: usize = 28_000;

/// Default wall-clock budget for a headless run when the caller doesn't pin one.
/// Headless steps can be real work (not just a model probe), so this is generous.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(600);

/// How much of **one** stream (stdout, stderr) a headless run keeps in memory.
///
/// The process is an agent's, and an agent that loops prints without end. The
/// previous capture read both pipes to EOF (`wait_with_output`), so a runaway
/// step grew in memory until the timeout killed it — unwatched, with the app
/// closed, on the machine the person is using for something else. Past this cap
/// the pipe is still **drained and discarded**, because a full pipe blocks the
/// child and a blocked child never exits; only what is *kept* is bounded.
///
/// What is kept is the **head and the tail** (half each): the head is where a
/// CLI says why it refused to start, the tail is where an agent puts its
/// answer — which is also what a chained step plants in the next prompt.
/// Between them the text says how much was dropped, and the result carries the
/// true size of each stream, so nothing is silently smaller than it was.
///
/// 512 KiB per stream is far above any real answer (a long one is tens of KiB)
/// and bounds a full concurrency budget of steps at a few MiB.
const MAX_STREAM_BYTES: usize = 512 * 1024;

/// Every headless run in flight, by the name its caller gave it: the pid to end
/// if that name is cancelled, and whether the cancel already happened (so the
/// run reports *cancelled* rather than a mysterious failure).
///
/// Process-wide because the thing it tracks is process-wide — the children this
/// process owns. A run with no name is not registered and cannot be cancelled;
/// the app names every step it dispatches.
static JOBS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, Job>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

#[derive(Debug, Clone, Copy)]
struct Job {
    pid: u32,
    cancelled: bool,
}

/// Cancel the named run: end its process tree now. Returns whether a run by
/// that name was in flight — a cancel of something already finished is not an
/// error, it is a race the caller does not have to think about.
///
/// The run's own future then returns [`AppError::Cancelled`], so a step that a
/// person stopped is never recorded as a step that failed.
pub fn cancel(job: &str) -> bool {
    let pid = {
        let mut jobs = JOBS.lock().expect("jobs");
        match jobs.get_mut(job) {
            Some(entry) => {
                entry.cancelled = true;
                entry.pid
            }
            None => return false,
        }
    };
    kill_tree(pid);
    true
}

/// Whether the named run was cancelled while it ran.
fn was_cancelled(job: &str) -> bool {
    JOBS.lock()
        .expect("jobs")
        .get(job)
        .is_some_and(|entry| entry.cancelled)
}

/// End `pid` and every process descended from it, deepest first.
///
/// One implementation for every platform, over the process table this app
/// already samples (`sysinfo`): a snapshot is taken, the descendants of `pid`
/// are walked from it, and each is asked to end — children before their parent,
/// so a parent cannot spawn more while its children are being ended. Killing
/// only the process we hold is what left an agent's tools (a `git`, a language
/// server, another agent) running after a cancel.
///
/// Best-effort by nature: a process may exit between the snapshot and the kill,
/// and one that ignores termination outlives it. Both are fine here — the
/// caller's own child is always ended, so the run always finishes.
pub fn kill_tree(pid: u32) {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    // parent → children, from the one snapshot: the walk must not race the
    // table it walks.
    let mut children: std::collections::HashMap<u32, Vec<u32>> = std::collections::HashMap::new();
    for (child, proc) in sys.processes() {
        if let Some(parent) = proc.parent() {
            children
                .entry(parent.as_u32())
                .or_default()
                .push(child.as_u32());
        }
    }
    // Depth-first, collecting before killing, so the order is deepest-first.
    let mut order = Vec::new();
    let mut stack = vec![pid];
    while let Some(current) = stack.pop() {
        order.push(current);
        if let Some(kids) = children.get(&current) {
            stack.extend(kids.iter().copied());
        }
        // A tree deeper or wider than this is a runaway of its own; stop
        // walking rather than spin forever on a cycle a borrowed table could
        // (in principle) show.
        if order.len() > 4096 {
            break;
        }
    }
    for victim in order.into_iter().rev() {
        if let Some(proc) = sys.process(Pid::from_u32(victim)) {
            proc.kill();
        }
    }
}

/// The captured result of a headless run — the raw output plus the **verified**
/// process exit code (the run engine's completion signal).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeadlessResult {
    pub stdout: String,
    pub stderr: String,
    /// Process exit code, or `None` if the process was terminated by a signal.
    pub exit_code: Option<i32>,
    /// What the agent actually wrote, in bytes — which is more than `stdout`
    /// holds once the cap bit.
    pub stdout_bytes: usize,
    /// As `stdout_bytes`, for stderr.
    pub stderr_bytes: usize,
    /// Either stream went past [`MAX_STREAM_BYTES`], so its text is head+tail
    /// with the gap noted inside it.
    pub truncated: bool,
}

/// Run `agent_id` in print-mode against `prompt` in `cwd`, capturing stdout,
/// stderr and the exit code. `model` empty → the CLI's default model.
/// `autonomous` adds the CLI's auto-approve flag (see
/// [`agentcli::build_args`]) — required for a step that must actually use
/// tools, and opt-in for exactly that reason.
/// `timeout_ms` overrides [`DEFAULT_TIMEOUT`]. A non-zero exit is **not** an
/// error here (it's returned in `exit_code` so the engine can decide); only a
/// spawn failure, timeout, or an unsupported/uninstalled agent is an `Err`.
/// `extra` are CLI arguments beyond the model and the autonomy posture, placed
/// before the prompt (see [`agentcli::build_args`]) — how the title runner pins
/// Codex to its lowest reasoning effort.
#[allow(clippy::too_many_arguments)]
pub async fn run_headless(
    agent_id: &str,
    model: &str,
    prompt: &str,
    cwd: &str,
    timeout_ms: Option<u64>,
    autonomous: bool,
    extra: &[String],
    job: Option<&str>,
) -> Result<HeadlessResult, AppError> {
    let Some(resolved) = agentcli::resolve(agent_id) else {
        return Err(AppError::Agent(format!(
            "agent '{agent_id}' is not installed"
        )));
    };
    let timeout = timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT);

    // How the prompt travels decides whether it can be long at all. Only the
    // argv path is capped; stdin and a prompt file carry the whole thing, which
    // is what a chained step planting a previous step's full output needs.
    match agentcli::prompt_delivery(agent_id) {
        agentcli::PromptDelivery::Stdin => {
            let args = build(
                agent_id,
                model,
                agentcli::PromptSource::Stdin,
                autonomous,
                extra,
            )?;
            run(&resolved, &args, cwd, timeout, Some(prompt), job).await
        }
        agentcli::PromptDelivery::File => {
            let file = PromptFile::write(prompt)?;
            let args = build(
                agent_id,
                model,
                agentcli::PromptSource::File(&file.path_str),
                autonomous,
                extra,
            )?;
            // The file must outlive the run; `PromptFile` removes it on drop.
            run(&resolved, &args, cwd, timeout, None, job).await
        }
        agentcli::PromptDelivery::Argv => {
            let capped = truncate_prompt(prompt, MAX_PROMPT_BYTES);
            let args = build(
                agent_id,
                model,
                agentcli::PromptSource::Argv(&capped),
                autonomous,
                extra,
            )?;
            run(&resolved, &args, cwd, timeout, None, job).await
        }
    }
}

fn build(
    agent_id: &str,
    model: &str,
    prompt: agentcli::PromptSource<'_>,
    autonomous: bool,
    extra: &[String],
) -> Result<Vec<String>, AppError> {
    agentcli::build_args(agent_id, model, prompt, autonomous, extra)
        .ok_or_else(|| AppError::Agent(format!("unsupported agent '{agent_id}'")))
}

/// A temporary file holding a prompt, removed when it goes out of scope so a
/// timed-out or panicking run can't leave the user's prompts lying around in
/// `%TEMP%`.
struct PromptFile {
    path: std::path::PathBuf,
    path_str: String,
}

impl PromptFile {
    fn write(prompt: &str) -> Result<Self, AppError> {
        let path = std::env::temp_dir().join(format!("uxnan-prompt-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, prompt.as_bytes())
            .map_err(|e| AppError::Agent(format!("could not stage the prompt: {e}")))?;
        Ok(Self {
            path_str: path.to_string_lossy().to_string(),
            path,
        })
    }
}

impl Drop for PromptFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Spawn the resolved agent windowless, with a hard timeout and `kill_on_drop`;
/// capture stdout/stderr/exit. Returns the raw capture (exit code included)
/// rather than gating on success — the run engine decides what a non-zero exit
/// means, and `aicommit` turns it into an error carrying the CLI's stderr.
///
/// `stdin_prompt` is written to the child and the pipe then closed, which is how
/// the CLIs that read their prompt from stdin know the input is complete. When
/// it is `None` stdin is closed outright, so nothing can ever sit waiting on it.
async fn run(
    resolved: &agentcli::Resolved,
    args: &[String],
    cwd: &str,
    timeout: Duration,
    stdin_prompt: Option<&str>,
    job: Option<&str>,
) -> Result<HeadlessResult, AppError> {
    use tokio::io::AsyncWriteExt;

    // `winproc::command` also strips the inherited terminal identity
    // (`launchenv`): a headless run belongs to no terminal, so it must not carry
    // an `UXNAN_AGENT_ID` — its CLI's own hook would report the run as that
    // terminal's agent, on whichever app owns the inherited hook server.
    let mut cmd = crate::winproc::command(&resolved.program);
    cmd.args(&resolved.prepend)
        .args(args)
        .stdin(if stdin_prompt.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !cwd.trim().is_empty() {
        // FOR-DEV: a `\\wsl$` worktree here runs the Windows CLI against the 9P
        // share (slow). Route WSL worktrees through `wsl.exe -d <distro>` with the
        // in-distro CLI (see `crate::wsl` + `git.rs`'s WSL path). See FOR-DEV.md.
        cmd.current_dir(cwd);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to start the agent: {e}")))?;
    // Named runs can be cancelled; the guard takes the name out of the registry
    // however this function leaves — returning, erroring, or being dropped.
    let _registration = job.and_then(|name| child.id().map(|pid| Registration::new(name, pid)));

    if let Some(text) = stdin_prompt {
        // Take the handle so it drops here: the close is the CLI's EOF, and
        // without it the agent would wait for more input forever.
        if let Some(mut sink) = child.stdin.take() {
            sink.write_all(text.as_bytes())
                .await
                .map_err(|e| AppError::Agent(format!("could not send the prompt: {e}")))?;
            sink.shutdown().await.ok();
        }
    }

    // Drain both pipes on their own tasks, keeping at most `MAX_STREAM_BYTES`
    // of each: reading must continue past the cap (a full pipe would block the
    // child), and it must happen *while* the child runs, not after it exits.
    let out_task = tokio::spawn(drain(child.stdout.take(), MAX_STREAM_BYTES));
    let err_task = tokio::spawn(drain(child.stderr.take(), MAX_STREAM_BYTES));

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(res) => res.map_err(|e| AppError::Agent(e.to_string()))?,
        Err(_) => {
            // Out of time: end the whole tree, not just the process we hold —
            // the same ending a cancel gives it — so the tools the agent
            // spawned do not outlive the run that started them.
            if let Some(pid) = child.id() {
                kill_tree(pid);
            }
            let _ = child.start_kill();
            out_task.abort();
            err_task.abort();
            return Err(AppError::Agent(format!(
                "the agent timed out after {}s",
                timeout.as_secs()
            )));
        }
    };
    // Ended by a cancel, not by its own hand: say so, so the step reads as
    // stopped rather than failed.
    if job.is_some_and(was_cancelled) {
        out_task.abort();
        err_task.abort();
        return Err(AppError::Cancelled);
    }

    let out = out_task.await.unwrap_or_default();
    let err = err_task.await.unwrap_or_default();
    Ok(HeadlessResult {
        stdout: out.text,
        stderr: err.text,
        exit_code: status.code(),
        stdout_bytes: out.bytes,
        stderr_bytes: err.bytes,
        truncated: out.truncated || err.truncated,
    })
}

/// Keeps a named run in [`JOBS`] for as long as it runs, and takes it out
/// again however the run ends — including a panic or a dropped future, which is
/// what a plain "remove at the end" misses.
struct Registration {
    name: String,
}

impl Registration {
    fn new(name: &str, pid: u32) -> Self {
        JOBS.lock().expect("jobs").insert(
            name.to_string(),
            Job {
                pid,
                cancelled: false,
            },
        );
        Self {
            name: name.to_string(),
        }
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        JOBS.lock().expect("jobs").remove(&self.name);
    }
}

/// One stream's bounded capture.
#[derive(Debug, Default, PartialEq, Eq)]
struct Capture {
    /// What is kept: the whole stream, or its head and tail with a note of the
    /// gap between them.
    text: String,
    /// What the stream actually was, in bytes.
    bytes: usize,
    truncated: bool,
}

/// Read `reader` to EOF, keeping at most `cap` bytes (half head, half tail) and
/// counting every byte that went past. Everything is read whatever the cap, so
/// the child is never blocked by a pipe nobody empties.
async fn drain<R>(reader: Option<R>, cap: usize) -> Capture
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;

    let Some(mut reader) = reader else {
        return Capture::default();
    };
    let head_cap = cap / 2;
    let tail_cap = cap - head_cap;
    let mut head: Vec<u8> = Vec::new();
    let mut tail: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
    let mut bytes = 0usize;
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                bytes += n;
                for &b in &buf[..n] {
                    if head.len() < head_cap {
                        head.push(b);
                        continue;
                    }
                    if tail.len() == tail_cap {
                        tail.pop_front();
                    }
                    tail.push_back(b);
                }
            }
        }
    }
    Capture {
        text: render(&head, &tail, bytes, cap),
        bytes,
        truncated: bytes > cap,
    }
}

/// The kept text: the stream verbatim while it fits, else head + how much was
/// dropped + tail. Lossy on purpose — a cap can land mid-character, and a log
/// with a replacement character beats a runner that panics on one.
fn render(head: &[u8], tail: &std::collections::VecDeque<u8>, bytes: usize, cap: usize) -> String {
    if bytes <= cap {
        let mut all = head.to_vec();
        all.extend(tail.iter().copied());
        return String::from_utf8_lossy(&all).into_owned();
    }
    let dropped = bytes - head.len() - tail.len();
    let tail: Vec<u8> = tail.iter().copied().collect();
    format!(
        "{}\n…[{dropped} bytes dropped: the output went past the {cap}-byte cap]…\n{}",
        String::from_utf8_lossy(head),
        String::from_utf8_lossy(&tail)
    )
}

/// Truncate `prompt` to at most `max` bytes on a char boundary, noting the cut so
/// the agent knows its input was clipped (mirrors the AI-commit diff cap).
fn truncate_prompt(prompt: &str, max: usize) -> String {
    if prompt.len() <= max {
        return prompt.to_string();
    }
    let mut end = max;
    while end > 0 && !prompt.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…[prompt truncated]…", &prompt[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_agent_errors_without_spawning() {
        let err = run_headless(
            "definitely-not-an-agent",
            "",
            "hi",
            "",
            None,
            false,
            &[],
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Agent(_)));
    }

    #[test]
    fn truncate_prompt_caps_on_char_boundary() {
        // Multi-byte chars: cutting must land on a boundary, never mid-char.
        let big = "é".repeat(20_000); // 2 bytes each → 40k bytes
        let out = truncate_prompt(&big, 100);
        assert!(out.len() <= 100 + "\n…[prompt truncated]…".len());
        assert!(out.ends_with("…[prompt truncated]…"));
        // A short prompt is returned unchanged.
        assert_eq!(truncate_prompt("small", 100), "small");
    }

    #[test]
    fn headless_result_serializes_camel_case() {
        let r = HeadlessResult {
            stdout: "out".into(),
            stderr: "err".into(),
            exit_code: Some(0),
            stdout_bytes: 3,
            stderr_bytes: 3,
            truncated: false,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("exitCode"));
        assert!(!json.contains("exit_code"));
        assert!(json.contains("stdoutBytes"));
        assert!(json.contains("truncated"));
    }

    #[tokio::test]
    async fn a_stream_within_the_cap_is_kept_whole() {
        let text = "the agent's answer\n".repeat(10);
        let got = drain(Some(std::io::Cursor::new(text.clone().into_bytes())), 1024).await;
        assert_eq!(got.text, text);
        assert_eq!(got.bytes, text.len());
        assert!(!got.truncated);
        // And nothing at all is still nothing (a stream the child never opened).
        let none = drain(None::<std::io::Cursor<Vec<u8>>>, 1024).await;
        assert_eq!(none, Capture::default());
    }

    #[tokio::test]
    async fn a_runaway_stream_keeps_its_head_and_tail_and_says_what_it_dropped() {
        // What an agent stuck in a loop looks like: far more than the cap, with
        // the two ends that matter — why it started, and what it ended up
        // saying. The middle is gone, and the text says so rather than
        // pretending the output was that short.
        let mut text = String::from("START launching the model\n");
        text.push_str(&"noise noise noise\n".repeat(10_000));
        text.push_str("END the answer is 42\n");
        let cap = 4096;
        let got = drain(Some(std::io::Cursor::new(text.clone().into_bytes())), cap).await;
        assert!(got.truncated);
        assert_eq!(got.bytes, text.len(), "the true size is reported");
        assert!(got.text.starts_with("START launching the model"));
        assert!(got.text.ends_with("END the answer is 42\n"));
        assert!(got.text.contains("bytes dropped"), "{}", &got.text[..200]);
        // The kept text is bounded by the cap plus the one-line note.
        assert!(got.text.len() < cap + 120, "kept {} bytes", got.text.len());
    }

    #[tokio::test]
    async fn the_cap_can_land_mid_character_without_panicking() {
        // A cut inside a multi-byte character is a replacement character in the
        // log, never a panic in the runner.
        let text = "é".repeat(5_000); // 2 bytes each
        let got = drain(Some(std::io::Cursor::new(text.clone().into_bytes())), 101).await;
        assert!(got.truncated);
        assert_eq!(got.bytes, 10_000);
    }

    #[tokio::test]
    async fn a_child_that_outprints_the_cap_still_finishes() {
        // The point of draining past the cap: a full pipe blocks the child, and
        // a blocked child never exits. This one writes ~8 MiB, far past both the
        // cap and any pipe buffer, and must still be reaped with its exit code.
        let mut cmd = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" });
        if cfg!(windows) {
            cmd.args([
                "/C",
                "for /L %i in (1,1,8000) do @echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ]);
        } else {
            cmd.args([
                "-c",
                "i=0; while [ $i -lt 8000 ]; do printf '%01000d\\n' $i; i=$((i+1)); done",
            ]);
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd.spawn().expect("spawn the shell");
        let out_task = tokio::spawn(drain(child.stdout.take(), 4096));
        let err_task = tokio::spawn(drain(child.stderr.take(), 4096));
        let status = tokio::time::timeout(Duration::from_secs(60), child.wait())
            .await
            .expect("the child exits rather than blocking on a full pipe")
            .expect("wait");
        let out = out_task.await.unwrap();
        assert!(status.success());
        assert!(out.bytes > 4096 * 4, "wrote {} bytes", out.bytes);
        assert!(out.truncated);
        assert!(err_task.await.unwrap().bytes == 0);
    }
    /// A real tree: a shell that spawns a child which spawns a grandchild, all
    /// three sleeping. Killing the process we hold is not enough — the point of
    /// `kill_tree` is that the grandchild goes too, because that is where an
    /// agent's actual work (a `git`, a build, another agent) lives.
    #[tokio::test]
    #[cfg(unix)]
    async fn kill_tree_takes_the_grandchildren_too() {
        use std::time::Instant;

        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("grandchild.pid");
        let script = format!(
            // sh → sh → sleep: the innermost writes its pid where the test can
            // find it, then sleeps well past the test's own patience.
            "sh -c 'sh -c \"echo \\$\\$ > {}; sleep 300\" & sleep 300'",
            marker.display()
        );
        let mut child = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn the tree");
        let root = child.id().expect("pid");

        // Wait for the grandchild to exist (it writes its pid).
        let deadline = Instant::now() + Duration::from_secs(20);
        let grandchild = loop {
            if let Ok(text) = std::fs::read_to_string(&marker) {
                if let Ok(pid) = text.trim().parse::<u32>() {
                    break pid;
                }
            }
            assert!(Instant::now() < deadline, "the grandchild never started");
            tokio::time::sleep(Duration::from_millis(100)).await;
        };
        assert!(alive(grandchild), "the grandchild should be running");

        kill_tree(root);
        let _ = child.wait().await;

        // The whole tree is gone, not just the process we held.
        let deadline = Instant::now() + Duration::from_secs(20);
        while alive(grandchild) {
            assert!(
                Instant::now() < deadline,
                "the grandchild outlived the kill"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(!alive(root), "the root outlived the kill");
    }

    /// Whether a pid is a live process, asked the same way the killer asks.
    #[cfg(unix)]
    fn alive(pid: u32) -> bool {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
        let mut sys = System::new();
        let target = Pid::from_u32(pid);
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[target]),
            true,
            ProcessRefreshKind::nothing(),
        );
        // A zombie is not alive: it has been killed and is only waiting to be
        // reaped by a parent that is itself gone.
        sys.process(target)
            .is_some_and(|p| !matches!(p.status(), sysinfo::ProcessStatus::Zombie))
    }

    #[test]
    fn cancelling_a_name_nobody_is_running_is_not_an_error() {
        assert!(!cancel("no-such-run"));
    }

    #[tokio::test]
    async fn a_registration_lasts_exactly_as_long_as_its_run() {
        // The registry is what a cancel searches; an entry that outlived its
        // run would send a kill to a pid the OS may have given to someone else.
        assert!(!JOBS.lock().unwrap().contains_key("job-1"));
        {
            let _registration = Registration::new("job-1", std::process::id());
            assert!(JOBS.lock().unwrap().contains_key("job-1"));
        }
        assert!(!JOBS.lock().unwrap().contains_key("job-1"));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn a_cancelled_run_reports_itself_cancelled_not_failed() {
        // A step somebody stopped must not be recorded as a step that broke.
        let resolved = agentcli::Resolved {
            program: "sh".into(),
            prepend: vec!["-c".into()],
        };
        let args = vec!["sleep 300".to_string()];
        let job = "cancel-me";
        let running = tokio::spawn(async move {
            run(
                &resolved,
                &args,
                "",
                Duration::from_secs(120),
                None,
                Some(job),
            )
            .await
        });
        // Wait until it is registered, then cancel it by name.
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while !JOBS.lock().unwrap().contains_key(job) {
            assert!(std::time::Instant::now() < deadline, "never registered");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(cancel(job), "the run was in flight");
        let err = running.await.unwrap().unwrap_err();
        assert!(matches!(err, AppError::Cancelled), "got {err:?}");
        // And the name is free again.
        assert!(!JOBS.lock().unwrap().contains_key(job));
    }
}
