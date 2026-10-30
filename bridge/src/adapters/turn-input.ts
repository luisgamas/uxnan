/**
 * A user turn's ordered input (`SendTurnOptions.input`: the prompt cut after
 * each image label, the image right after it) in the shape each CLI's own
 * protocol takes, so the model sees every picture where the person put it.
 *
 * One function per protocol, each a pure translation. An adapter calls its own
 * only when it declares `takesInlineImages()`; a turn without images (no
 * `input`) is the prompt text alone, as before. What each CLI does with it,
 * measured on the surface the bridge drives, is in bridge/docs/agents.md →
 * *Attachments in the sentence*.
 */
import type { SendTurnOptions, TurnInputPart } from '@uxnan/shared';

/** Only the image parts of [input] (none when it is absent). */
export function imagesOnly(input: readonly TurnInputPart[] | undefined): TurnInputPart[] {
  return (input ?? []).filter((part) => part.type === 'image');
}

/** The parts of a turn: its `input`, or its text as the one part. */
export function turnParts(options: Pick<SendTurnOptions, 'text' | 'input'>): TurnInputPart[] {
  return options.input ?? [{ type: 'text', text: options.text }];
}

/**
 * Anthropic-style content blocks for a Claude Code stream-json user message:
 * `text` blocks and base64 `image` blocks, in order. Empty text pieces are
 * left out (the API refuses an empty text block).
 */
export function claudeContent(
  options: Pick<SendTurnOptions, 'text' | 'input'>,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of turnParts(options)) {
    if (part.type === 'text') {
      if (part.text.length > 0) blocks.push({ type: 'text', text: part.text });
    } else {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: part.mimeType, data: part.base64Data },
      });
    }
  }
  if (blocks.length === 0) blocks.push({ type: 'text', text: options.text });
  return blocks;
}

/**
 * Codex app-server `UserInput` items (`turn/start`, `turn/steer`): `text`
 * items and `image` items by data URL, in order.
 */
export function codexInput(
  options: Pick<SendTurnOptions, 'text' | 'input'>,
): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const part of turnParts(options)) {
    if (part.type === 'text') {
      if (part.text.length > 0) items.push({ type: 'text', text: part.text });
    } else {
      items.push({ type: 'image', url: dataUrl(part) });
    }
  }
  if (items.length === 0) items.push({ type: 'text', text: options.text });
  return items;
}

/**
 * ACP `session/prompt` content blocks: `text` blocks and inline `image`
 * blocks (`{ type, mimeType, data }`), in order. Only for an agent whose
 * `promptCapabilities.image` is true.
 */
export function acpPrompt(
  options: Pick<SendTurnOptions, 'text' | 'input'>,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of turnParts(options)) {
    if (part.type === 'text') {
      if (part.text.length > 0) blocks.push({ type: 'text', text: part.text });
    } else {
      blocks.push({ type: 'image', mimeType: part.mimeType, data: part.base64Data });
    }
  }
  // Never an empty prompt: an attachment-only turn still has its labels.
  if (blocks.length === 0) blocks.push({ type: 'text', text: options.text });
  return blocks;
}

/** The images of a turn, in order, as pi's RPC `prompt`/`steer` take them. */
export function piImages(
  options: Pick<SendTurnOptions, 'input'>,
): Array<{ type: 'image'; data: string; mimeType: string }> {
  return (options.input ?? []).flatMap((part) =>
    part.type === 'image'
      ? [{ type: 'image' as const, data: part.base64Data, mimeType: part.mimeType }]
      : [],
  );
}

/**
 * The images of a turn as OpenCode 2 prompt `files`: each a data URI with its
 * name, and a `mention` spanning its label in the prompt text — the same
 * shape OpenCode's own TUI sends for a pasted image, which is how its server
 * knows where in the sentence the file was placed.
 */
export function openCodeV2Files(
  options: Pick<SendTurnOptions, 'text' | 'input'>,
): Array<Record<string, unknown>> {
  const files: Array<Record<string, unknown>> = [];
  let offset = 0;
  for (const part of options.input ?? []) {
    if (part.type === 'text') {
      offset += part.text.length;
      continue;
    }
    files.push({
      uri: dataUrl(part),
      ...(part.name !== undefined ? { name: part.name } : {}),
      mention: { start: offset - part.label.length, end: offset, text: part.label },
    });
  }
  return files;
}

// FOR-DEV: OpenCode 1.x `file` parts are unit tested but not measured live — only
// 2.x is installed on the dev machine (bridge/FOR-DEV.md → Attachments in the sentence).
/**
 * OpenCode 1 prompt `parts`: `text` parts and `file` parts (a data URL with
 * its MIME type and name), in order.
 */
export function openCodeV1Parts(
  options: Pick<SendTurnOptions, 'text' | 'input'>,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const part of turnParts(options)) {
    if (part.type === 'text') {
      if (part.text.length > 0) parts.push({ type: 'text', text: part.text });
    } else {
      parts.push({
        type: 'file',
        mime: part.mimeType,
        url: dataUrl(part),
        ...(part.name !== undefined ? { filename: part.name } : {}),
      });
    }
  }
  if (parts.length === 0) parts.push({ type: 'text', text: options.text });
  return parts;
}

function dataUrl(part: Extract<TurnInputPart, { type: 'image' }>): string {
  return `data:${part.mimeType};base64,${part.base64Data}`;
}
