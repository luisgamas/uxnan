/**
 * What a tool call did, in one vocabulary shared by every agent. Each agent
 * names its tools its own way (`Read`, `read_file`, `view_file`, an ACP
 * `kind`, a Codex item type…); the bridge classifies them once, so a client
 * says "Read notes.txt" for all of them instead of learning every CLI.
 *
 *  - `read`: read a file or an image
 *  - `search`: search file contents or names (grep, glob, find)
 *  - `list`: list a folder
 *  - `fetch`: fetch a URL
 *  - `web_search`: search the web
 *  - `mcp`: a tool of an MCP server
 *  - `other`: anything else — clients show the tool's name
 */
export type ToolKind = 'read' | 'search' | 'list' | 'fetch' | 'web_search' | 'mcp' | 'other';

/** Every {@link ToolKind}, for validators and exhaustive checks. */
export const TOOL_KINDS: readonly ToolKind[] = [
  'read',
  'search',
  'list',
  'fetch',
  'web_search',
  'mcp',
  'other',
];

/**
 * A tool call that is not a shell command, an edit, a plan or a subagent,
 * as a `stream/content/block` (persisted with the assistant message).
 */
export interface ToolContentBlock {
  type: 'tool';
  /** The agent's own name for the tool (`Read`, `grep`, `server/tool`…). */
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  output?: string;
  isError: boolean;
  /** What the call did, classified by the bridge. */
  kind: ToolKind;
  /**
   * What it acted on, ready to show: a path (relative to the project when it
   * is inside it), a search pattern, a URL, a query. Absent when there is none.
   */
  target?: string;
}

/**
 * A subagent the agent delegated to (Claude's `Agent`, OpenCode's `task`,
 * Codex's collaboration tools, Antigravity's subagents), once it finished.
 */
export interface SubagentContentBlock {
  type: 'subagent';
  state: {
    id: string;
    /** What the subagent was asked to do, in a few words. */
    name: string;
    status: 'completed' | 'error';
    /** Its final report, truncated for the wire. */
    output?: string;
  };
}
