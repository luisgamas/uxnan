<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { app } from "$lib/state/app.svelte";
  import { applyTheme } from "$lib/theme";
  import { agentMonitor } from "$lib/state/agentMonitor.svelte";
  import { agentStatus } from "$lib/state/agentStatus.svelte";
  import { updater } from "$lib/state/updater.svelte";
  import { anyAgentWorking } from "$lib/state/agentDisplay";
  import { unread } from "$lib/state/unread.svelte";
  import { setPreventSleep } from "$lib/api";
  import { installPointerLockGuard } from "$lib/utils/pointerLock";
  import { TooltipProvider } from "$lib/components/ui/tooltip";

  let { children } = $props();

  // Hydrate from the Rust backend once the webview is mounted.
  onMount(() => {
    app.init();
    // Listen for agents detected (or stopped) in any terminal.
    void agentMonitor.startDetection();
    // Hydrate + subscribe to precise hook-reported agent states.
    void agentStatus.start();
    // Auto-updater: restore any staged download, then check on the chosen channel.
    void updater.start();
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
    };
  });

  // Re-sync the agent commands to detect whenever the configured agents change.
  $effect(() => {
    void app.agentProfiles.length;
    app.syncAgentCommands();
  });

  // Apply the active theme (CSS variables + fonts + .dark class). Re-runs when
  // the selected theme, the custom themes, or the OS dark preference change.
  $effect(() => {
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
    const active = app.settings.preventSleep === true && anyAgentWorking();
    void setPreventSleep(active).catch(() => {});
  });
</script>

<TooltipProvider>
  {@render children()}
</TooltipProvider>
