// The chat's scroll rail, as data: one anchor per message the user sent, in
// order, previewing their words and the reply the turn ended on — what the
// phone's rail shows for the same conversation (`rail_anchors.dart`). Pure, so
// the rail component only draws it.

import type { Turn } from "$shared/models/thread";
import { assistantOf, userAttachments, userText } from "./conversation.svelte";

/** One mark on the rail. */
export interface RailAnchor {
  /** The turn it jumps to. */
  turnId: string;
  /** The user's message, on one line. */
  preview: string;
  /** The end of the reply, when there is one. */
  reply?: string;
}

/** How much of each text the preview keeps. */
const PREVIEW_LENGTH = 90;
const REPLY_LENGTH = 180;

function oneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The last paragraph of the reply: where the turn landed. */
function replyEnd(turn: Turn): string {
  const content = assistantOf(turn)?.content;
  if (typeof content !== "string") return "";
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return paragraphs.at(-1) ?? "";
}

/** The anchors for [turns]: every turn that carries something the user sent
 *  (words, or only attachments — then named by the first one's name, or
 *  [imageLabel] for an image, which has none). */
export function railAnchors(turns: readonly Turn[], imageLabel: string): RailAnchor[] {
  const anchors: RailAnchor[] = [];
  for (const turn of turns) {
    const words = oneLine(userText(turn), PREVIEW_LENGTH);
    const attachment = userAttachments(turn)[0];
    const preview = words || (attachment ? oneLine(attachment.name ?? imageLabel, PREVIEW_LENGTH) : "");
    if (!preview) continue;
    const reply = oneLine(replyEnd(turn), REPLY_LENGTH);
    anchors.push({ turnId: turn.id, preview, ...(reply ? { reply } : {}) });
  }
  return anchors;
}
