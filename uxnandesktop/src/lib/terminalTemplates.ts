// Built-in terminal/shell presets, grouped by OS. These are *templates* the user
// can add to their profiles from Settings → Terminal — they are not auto-seeded,
// so the profiles list stays empty (one placeholder) until the user picks one.

export interface TerminalTemplate {
  name: string;
  command: string;
  args: string[];
}

export interface TerminalTemplateGroup {
  os: string;
  templates: TerminalTemplate[];
}

export const TERMINAL_TEMPLATES: TerminalTemplateGroup[] = [
  {
    os: "Windows",
    templates: [
      { name: "PowerShell", command: "powershell.exe", args: ["-NoLogo"] },
      { name: "PowerShell 7", command: "pwsh.exe", args: ["-NoLogo"] },
      { name: "Command Prompt", command: "cmd.exe", args: [] },
      { name: "WSL", command: "wsl.exe", args: [] },
      { name: "WSL: distro", command: "wsl.exe", args: ["-d", "Ubuntu"] },
    ],
  },
  {
    os: "macOS",
    templates: [
      { name: "zsh", command: "/bin/zsh", args: ["-l"] },
      { name: "bash", command: "/bin/bash", args: ["-l"] },
    ],
  },
  {
    os: "Linux",
    templates: [
      { name: "bash", command: "/bin/bash", args: [] },
      { name: "zsh", command: "/usr/bin/zsh", args: [] },
      { name: "fish", command: "/usr/bin/fish", args: [] },
    ],
  },
];
