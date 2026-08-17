<script lang="ts">
  import "../app.css";
  import { onMount, untrack } from "svelte";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { applyTheme } from "$lib/theme";
  import { agentMonitor } from "$lib/state/agentMonitor.svelte";
  import { agentStatus } from "$lib/state/agentStatus.svelte";
  import { updater } from "$lib/state/updater.svelte";
  import { anyAgentWorking } from "$lib/state/agentDisplay";
  import { unread } from "$lib/state/unread.svelte";
  import { pets } from "$lib/state/pets.svelte";
  import { autoSleep } from "$lib/state/autoSleep.svelte";
  import { resourceMode } from "$lib/state/resourceMode.svelte";
  import { usage } from "$lib/state/usage.svelte";
  import { diagnostics } from "$lib/state/diagnostics.svelte";
  import { ports } from "$lib/state/ports.svelte";
  import { setPreventSleep, resourcesSetPolicy } from "$lib/api";
  import { installPointerLockGuard } from "$lib/utils/pointerLock";
  import { installErrorReporter } from "$lib/utils/errorReporter";
  import { TooltipProvider } from "$lib/components/ui/tooltip";
  import PetWindow from "$lib/components/PetWindow.svelte";

  let { children } = $props();

  // The desktop pet window loads the same `index.html` with `?window=pet` —
  // the static build emits no per-route files (`fallback: index.html`), so a
  // second window MUST be a query branch here, never a SvelteKit route: a
  // route URL resolves in dev via Vite's fallback and 404s in the packaged
  // build. In pet mode the shell (and its whole boot sequence) never runs.
  const petWindow =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("window") === "pet";

  // Hydrate from the Rust backend once the webview is mounted. After the layout
  // restore, load the worktree world and reconcile the two: the restored active
  // workspace re-binds to (and selects) its project/worktree, stale workspace
  // keys for deleted worktrees are dropped, and alternate path spellings are
  // re-keyed — see `projects.reconcileRestoredWorkspaces`.
  onMount(() => {
    if (petWindow) {
      // A transparent window must stay transparent: kill the brand splash
      // outright (its opaque background would flash a white rectangle over the
      // desktop) and clear the app background the theme normally paints.
      document.getElementById("uxnan-splash")?.remove();
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
      return;
    }
    // First thing in the main window: capture uncaught frontend failures into
    // the app's log. A render error that blanks the window leaves no OS crash
    // report and no minidump — the evidence exists only here, and only until
    // the window goes away. Installed before `app.init()` so a failure during
    // hydration is recorded too.
    const uninstallErrorReporter = installErrorReporter();
    void (async () => {
      await app.init();
      if (app.backend === "ready") {
        await projects.init();
        await projects.reconcileRestoredWorkspaces();
      }
    })();
    // Listen for agents detected (or stopped) in any terminal.
    void agentMonitor.startDetection();
    // Hydrate + subscribe to precise hook-reported agent states.
    void agentStatus.start();
    // Auto-updater: restore any staged download, then check on the chosen channel.
    void updater.start();
    // One read of the app's own diagnostics: where the log is, and whether the
    // previous session ended without a clean exit.
    void diagnostics.start();
    // Hear what a host's terminals announce. From boot, not from the popover: a
    // dev server prints its address once, and a listener that only exists while
    // a popover is open would miss every announcement worth having.
    void ports.start();
    // Coming back to the window clears the "unread agent result" badges.
    const onFocus = () => unread.clearAll();
    window.addEventListener("focus", onFocus);
    // App-level watchdog: heal an orphaned bits-ui body pointer-events lock (a
    // modal torn down without its cleanup can leave the whole window deaf to the
    // mouse) on the next click. Zero idle cost — see $lib/utils/pointerLock.
    const uninstallPointerLockGuard = installPointerLockGuard();
    // Dismiss the pre-hydration brand splash (in `app.html`) once the shell
    // has painted its first frame, handing off to the real UI.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        (window as unknown as { __uxnanSplashDone?: () => void })
          .__uxnanSplashDone?.(),
      ),
    );
    return () => {
      window.removeEventListener("focus", onFocus);
      uninstallPointerLockGuard();
      uninstallErrorReporter();
    };
  });

  // Re-sync the agent commands to detect whenever the configured agents change.
  $effect(() => {
    if (petWindow) return;
    void app.agentProfiles.length;
    app.syncAgentCommands();
  });

  // Pets are opt-in, so the library (and its spritesheet) is only loaded once the
  // user actually enables them — a disabled companion costs nothing at boot.
  $effect(() => {
    if (petWindow) return;
    if (app.settings.pets?.enabled === true && !pets.loaded) void pets.load();
  });

  // Apply the active theme (CSS variables + fonts + .dark class). Re-runs when
  // the selected theme, the custom themes, or the OS dark preference change.
  $effect(() => {
    if (petWindow) return;
    void app.settings.activeThemeId;
    void app.settings.customThemes;
    void app.settings.fonts;
    void app.previewTheme;
    void app.systemDark;
    applyTheme(app.effectiveTheme());
  });

  // Opt-in keep-awake: while enabled and an agent is working, ask the OS not to
  // sleep (the backend auto-releases after 2 h). Re-runs when either changes.
  $effect(() => {
    if (petWindow) return;
    const active = app.settings.preventSleep === true && anyAgentWorking();
    void setPreventSleep(active).catch(() => {});
  });

  // Resource mode → backend: push the resolved history budget to the resource
  // monitor (its one backend-side parameter). Re-runs on a profile/override
  // change, so switching presets applies hot and reversibly.
  $effect(() => {
    if (petWindow) return;
    if (app.backend !== "ready") return;
    const seconds = resourceMode.policy.capabilities.resourceHistorySeconds;
    void resourcesSetPolicy(seconds).catch(() => {});
  });

  // Activated usage providers are opt-in, but once activated they must refresh
  // even when Settings has not been opened since startup. Focus performs a
  // stale-only catch-up after sleep; provider-specific timers honor overrides.
  $effect(() => {
    if (petWindow || app.backend !== "ready") return;
    // start() reads provider snapshots while deciding what is stale. Keep those
    // internal reads out of this lifecycle effect or every completed refresh
    // would tear down and restart all timers.
    untrack(() => usage.start());
    return () => usage.stop();
  });

  // Workspace auto-sleep engine: one cheap evaluation per minute, gated inside
  // by the profile's capability AND the explicit feature flag — armed here so
  // enabling the flag needs no restart.
  $effect(() => {
    if (petWindow) return;
    return autoSleep.start();
  });
</script>

{#if petWindow}
  <PetWindow />
{:else}
  <TooltipProvider>
    {@render children()}
  </TooltipProvider>
{/if}
