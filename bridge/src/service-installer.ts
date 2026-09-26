/**
 * Autostart installer: registers the bridge to start at user logon, **as the
 * logged-in user and never elevated** (the Ed25519 identity already lives in the
 * per-user OS keychain, so no root/SYSTEM is needed).
 *
 *   - Windows: a Task Scheduler task `At log on` with run level LIMITED.
 *   - macOS:   a per-user LaunchAgent (`RunAtLoad` + `KeepAlive`).
 *   - Linux:   a systemd `--user` unit (pair with `loginctl enable-linger`).
 *
 * The bridge is launched as `<node> <cli.js> start --service` — absolute paths, so
 * it never depends on the minimal PATH a login service gets — which works both
 * for a global npm install and a dev checkout. `--service` tells the bridge it
 * runs as the user's service (`BridgeStatus.host.launchedBy`), the normal way it
 * lives: Uxnan Desktop installs it once and only connects to it afterwards, and
 * it keeps serving the phone when the desktop is closed. It is restarted only
 * when it crashes: a deliberate `uxnan-bridge stop` stays stopped until
 * `service-start` (or the next login). {@link buildServicePlan} is pure (no side
 * effects) so it can be unit-tested; {@link installService}/{@link uninstallService}
 * execute the plan with `execFile` (no shell).
 *
 * This supersedes the manual `scripts/install-service-*` files (kept as reference).
 */
import { execFile } from 'node:child_process';
import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { join } from 'node:path';

const run = promisify(execFile);

const TASK_NAME = 'UxnanBridge';
const LAUNCH_LABEL = 'dev.luisgamas.bridge';
const UNIT_NAME = 'uxnan-bridge.service';

export type ServicePlatform = 'win32' | 'darwin' | 'linux';

export interface ServiceEnv {
  platform: ServicePlatform;
  /** Absolute node executable (e.g. `process.execPath`). */
  execPath: string;
  /** Absolute path to the bridge CLI entry (`cli.js`). */
  cliPath: string;
  /** User home directory. */
  home: string;
  /** `XDG_CONFIG_HOME` when set (Linux only). */
  xdgConfigHome?: string;
  /** `%APPDATA%` (Windows only) — used for the Startup-folder fallback. */
  appData?: string;
}

export interface ServiceCommand {
  argv: string[];
  /** When true, a non-zero exit is tolerated (e.g. unloading a not-loaded agent). */
  ignoreFailure?: boolean;
}

export interface ServicePlan {
  platform: ServicePlatform;
  /** Human-facing task/agent/unit identifier. */
  label: string;
  /** Directories to ensure before writing the file / running commands. */
  dirs: string[];
  /** A config file to write (plist / unit), if any. */
  file?: { path: string; content: string };
  install: ServiceCommand[];
  uninstall: ServiceCommand[];
  /** File removed on uninstall. */
  removeFile?: string;
  note: string;
  uninstallNote: string;
}

/** Build the platform-specific autostart plan. Pure — no side effects. */
export function buildServicePlan(env: ServiceEnv): ServicePlan {
  const { platform, execPath, cliPath, home } = env;

  if (platform === 'win32') {
    // schtasks `/TR` takes the whole command as ONE string; quote each path.
    const tr = `"${execPath}" "${cliPath}" start --service`;
    return {
      platform,
      label: TASK_NAME,
      dirs: [],
      install: [
        {
          argv: [
            'schtasks',
            '/Create',
            '/TN',
            TASK_NAME,
            '/TR',
            tr,
            '/SC',
            'ONLOGON',
            '/RL',
            'LIMITED',
            '/F',
          ],
        },
      ],
      uninstall: [{ argv: ['schtasks', '/Delete', '/TN', TASK_NAME, '/F'] }],
      note: `Registered scheduled task '${TASK_NAME}' (starts at logon). Start now: schtasks /Run /TN ${TASK_NAME}`,
      uninstallNote: `Removed scheduled task '${TASK_NAME}'.`,
    };
  }

  if (platform === 'darwin') {
    const plistPath = join(home, 'Library', 'LaunchAgents', `${LAUNCH_LABEL}.plist`);
    const logDir = join(home, '.uxnan', 'logs');
    return {
      platform,
      label: LAUNCH_LABEL,
      dirs: [dirname(plistPath), logDir],
      file: {
        path: plistPath,
        content: plistContent([execPath, cliPath, 'start', '--service'], logDir, home),
      },
      install: [
        { argv: ['launchctl', 'unload', plistPath], ignoreFailure: true },
        { argv: ['launchctl', 'load', plistPath] },
      ],
      uninstall: [{ argv: ['launchctl', 'unload', plistPath], ignoreFailure: true }],
      removeFile: plistPath,
      note: `Loaded LaunchAgent ${LAUNCH_LABEL} (starts at login).`,
      uninstallNote: `Unloaded and removed LaunchAgent ${LAUNCH_LABEL}.`,
    };
  }

  // linux — systemd --user
  const unitDir = join(env.xdgConfigHome ?? join(home, '.config'), 'systemd', 'user');
  const unitPath = join(unitDir, UNIT_NAME);
  return {
    platform,
    label: UNIT_NAME,
    dirs: [unitDir],
    file: {
      path: unitPath,
      content: systemdUnit(
        `${systemdQuote(execPath)} ${systemdQuote(cliPath)} start --service`,
        home,
      ),
    },
    install: [
      { argv: ['systemctl', '--user', 'daemon-reload'] },
      { argv: ['systemctl', '--user', 'enable', '--now', UNIT_NAME] },
    ],
    uninstall: [
      { argv: ['systemctl', '--user', 'disable', '--now', UNIT_NAME], ignoreFailure: true },
    ],
    removeFile: unitPath,
    note: `Enabled systemd user unit ${UNIT_NAME}. Tip: 'loginctl enable-linger $USER' keeps it running after logout.`,
    uninstallNote: `Disabled and removed systemd user unit ${UNIT_NAME}.`,
  };
}

/**
 * Windows fallback when Task Scheduler is unavailable (e.g. policy/restricted
 * accounts return "Access denied" on `schtasks /Create`): a hidden launcher in the
 * user's Startup folder. Writing there needs no special permission, and the `.vbs`
 * launches the bridge with no console window. Pure — no side effects.
 */
export function buildWindowsStartupPlan(env: ServiceEnv): ServicePlan {
  const appData = env.appData ?? join(env.home, 'AppData', 'Roaming');
  const startupDir = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const vbsPath = join(startupDir, 'uxnan-bridge.vbs');
  return {
    platform: 'win32',
    label: 'uxnan-bridge.vbs',
    dirs: [startupDir],
    file: { path: vbsPath, content: vbsLauncher(env.execPath, env.cliPath) },
    install: [],
    uninstall: [],
    removeFile: vbsPath,
    note: `Added a hidden Startup launcher (${vbsPath}); starts at next logon.`,
    uninstallNote: `Removed the Startup launcher ${vbsPath}.`,
  };
}

/** Resolve the autostart environment for the current process. */
export function currentServiceEnv(cliPath: string): ServiceEnv {
  const env: ServiceEnv = {
    platform: process.platform as ServicePlatform,
    execPath: process.execPath,
    cliPath,
    home: requireHome(),
  };
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg) env.xdgConfigHome = xdg;
  const appData = process.env['APPDATA'];
  if (appData) env.appData = appData;
  return env;
}

/** Whether the autostart entry exists (the service is installed). */
export async function isServiceInstalled(env: ServiceEnv): Promise<boolean> {
  if (env.platform === 'win32') {
    try {
      await run('schtasks', ['/Query', '/TN', TASK_NAME], { windowsHide: true });
      return true;
    } catch {
      const startup = buildWindowsStartupPlan(env).removeFile;
      return startup !== undefined && (await exists(startup));
    }
  }
  const file = buildServicePlan(env).file;
  return file !== undefined && (await exists(file.path));
}

/**
 * Start the installed service now (it is not running: stopped by hand, or it
 * exited cleanly). A no-op for a running one.
 */
export async function startService(env: ServiceEnv): Promise<void> {
  if (env.platform === 'darwin') {
    const uid = process.getuid?.() ?? 0;
    await run('launchctl', ['kickstart', `gui/${uid}/${LAUNCH_LABEL}`], { windowsHide: true });
  } else if (env.platform === 'linux') {
    await run('systemctl', ['--user', 'start', UNIT_NAME], { windowsHide: true });
  } else {
    try {
      await run('schtasks', ['/Run', '/TN', TASK_NAME], { windowsHide: true });
    } catch {
      // Installed through the Startup-folder fallback: run its launcher.
      const vbs = buildWindowsStartupPlan(env).removeFile;
      if (!vbs) throw new Error('the bridge service is not installed');
      await run('wscript.exe', [vbs], { windowsHide: true });
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** True for platforms with a supported autostart mechanism. */
export function isServicePlatformSupported(platform: NodeJS.Platform): platform is ServicePlatform {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux';
}

/**
 * Execute the install plan: ensure dirs, write the config file, run the commands.
 * On Windows, falls back to the Startup-folder launcher if Task Scheduler fails.
 */
export async function installService(env: ServiceEnv): Promise<ServicePlan> {
  if (env.platform === 'win32') {
    const taskPlan = buildServicePlan(env);
    try {
      await runCommands(taskPlan.install);
      return taskPlan;
    } catch {
      return applyFilePlan(buildWindowsStartupPlan(env));
    }
  }
  const plan = buildServicePlan(env);
  for (const dir of plan.dirs) await mkdir(dir, { recursive: true });
  if (plan.file) await writeFile(plan.file.path, plan.file.content, 'utf-8');
  await runCommands(plan.install);
  return plan;
}

/** Execute the uninstall plan: run the commands, then remove the file(s). */
export async function uninstallService(env: ServiceEnv): Promise<ServicePlan> {
  if (env.platform === 'win32') {
    // Remove whichever method was used: the scheduled task and/or the Startup launcher.
    await runCommands(buildServicePlan(env).uninstall.map((c) => ({ ...c, ignoreFailure: true })));
    const startup = buildWindowsStartupPlan(env);
    if (startup.removeFile) await rm(startup.removeFile, { force: true });
    return {
      ...startup,
      uninstallNote: 'Removed the autostart entry (scheduled task and/or Startup launcher).',
    };
  }
  const plan = buildServicePlan(env);
  await runCommands(plan.uninstall);
  if (plan.removeFile) await rm(plan.removeFile, { force: true });
  return plan;
}

async function applyFilePlan(plan: ServicePlan): Promise<ServicePlan> {
  for (const dir of plan.dirs) await mkdir(dir, { recursive: true });
  if (plan.file) await writeFile(plan.file.path, plan.file.content, 'utf-8');
  await runCommands(plan.install);
  return plan;
}

async function runCommands(commands: ServiceCommand[]): Promise<void> {
  for (const { argv, ignoreFailure } of commands) {
    try {
      await run(argv[0]!, argv.slice(1), { windowsHide: true });
    } catch (err) {
      if (!ignoreFailure) throw err;
    }
  }
}

function requireHome(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'];
  if (!home) throw new Error('cannot resolve the user home directory');
  return home;
}

function plistContent(programArgs: string[], logDir: string, home: string): string {
  const args = programArgs.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(home)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>StandardOutPath</key><string>${xmlEscape(join(logDir, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(join(logDir, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

function systemdUnit(execStart: string, home: string): string {
  return `[Unit]
Description=Uxnan Bridge daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${execStart}
WorkingDirectory=${home}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/** A `.vbs` that launches the bridge with NO console window (`WScript.Shell.Run`). */
function vbsLauncher(execPath: string, cliPath: string): string {
  const runtimeCmd = `"${execPath}" "${cliPath}" start --service`;
  // VBScript string literal: each `"` is doubled.
  const literal = `"${runtimeCmd.replace(/"/g, '""')}"`;
  // window style 0 = hidden, waitOnReturn = False (don't block).
  return `Set sh = CreateObject("WScript.Shell")\r\nsh.Run ${literal}, 0, False\r\n`;
}

/** Quote an ExecStart argument for systemd (paths with spaces). */
function systemdQuote(value: string): string {
  return /[\s"\\]/.test(value) ? `"${value.replace(/(["\\])/g, '\\$1')}"` : value;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
