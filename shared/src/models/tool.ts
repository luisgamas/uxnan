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
 * A step shown while it runs. Any structured block may carry a `blockId`, the
 * id of the step it stands for: a later block of the **same turn** with the
 * same `blockId` replaces it in place — in the bridge's store and in every
 * client's live view — so a step appears as it starts (`status: 'running'`,
 * or `state.status: 'running'` for a subagent) and settles into its result
 * where it stood. Once the turn ends a step is never running: the bridge
 * settles any the agent left open, and a client treats a running step of a
 * turn that is no longer live as settled.
 */
export interface LiveBlock {
  blockId?: string;
}

/**
 * A tool call that is not a shell command, an edit, a plan or a subagent,
 * as a `stream/content/block` (persisted with the assistant message).
 */
export interface ToolContentBlock extends LiveBlock {
  type: 'tool';
  /** The agent's own name for the tool (`Read`, `grep`, `server/tool`…). */
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  output?: string;
  isError: boolean;
  /** `running` while the call is in flight (see {@link LiveBlock}); absent once it finished. */
  status?: 'running';
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
 * Codex's collaboration tools, Antigravity's subagents): running, then
 * finished with its report.
 */
export interface SubagentContentBlock extends LiveBlock {
  type: 'subagent';
  state: {
    id: string;
    /** What the subagent was asked to do, in a few words. */
    name: string;
    status: 'running' | 'completed' | 'error';
    /** Its final report, truncated for the wire. */
    output?: string;
  };
}
