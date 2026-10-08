import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VIEW_TOOL_DESCRIPTION } from './mcp-server.js';

/** The skill's folder name, and its `name`. */
export const VIEW_SKILL_NAME = 'uxnan-views';

/**
 * A skill that teaches an agent to show views, for a CLI whose model never
 * sees the MCP tool itself. OpenCode 2 puts every MCP tool behind its
 * code-mode `execute` tool and hands the model neither the tool's description
 * nor the server's instructions, but it does list each skill — name and
 * description — in its `skill` tool, so the rule rides in the description and
 * the how in the body (measured 2026-10-08, opencode 2.0.24).
 */
export const VIEW_SKILL_MD = `---
name: ${VIEW_SKILL_NAME}
description: Show the person an interactive page — a chart, table, comparison, ranking, schedule, diagram or mockup — inline in their chat, on their desktop and phone. Load it, without being asked, whenever your answer has numbers to compare, a trend, a breakdown or proportion, a ranking, a schedule, a diagram or a layout; the person will never ask for it by name.
---

# Show an interactive view in the person's chat

Call the \`view_show\` tool of the \`uxnan\` MCP server. In code mode it is
\`await tools.uxnan.view_show({ title, html, height })\` inside \`execute\`.
Then keep your written answer to a sentence or two about what the page shows.

${VIEW_TOOL_DESCRIPTION}
`;

/**
 * Write the skill under [root] (`<root>/uxnan-views/SKILL.md`), in the
 * bridge's own state folder — never in an agent's config — and return [root],
 * the folder to hand a CLI as a skills path.
 */
export async function writeViewSkill(root: string): Promise<string> {
  await mkdir(join(root, VIEW_SKILL_NAME), { recursive: true });
  await writeFile(join(root, VIEW_SKILL_NAME, 'SKILL.md'), VIEW_SKILL_MD, { mode: 0o644 });
  return root;
}
