import type { Message } from '@uxnan/shared';

/**
 * The blocks of a stored reply — every entry of its `segments` that is
 * neither a text run, a thought nor a response boundary, in order: what the
 * reply did, where `Message.blocks` once repeated it.
 */
export function stepsOf(message: Message | undefined): Record<string, unknown>[] {
  return (message?.segments ?? []).filter((s) => {
    const type = (s as { type?: unknown }).type;
    return type !== 'text' && type !== 'thinking' && type !== 'assistant_response_boundary';
  }) as Record<string, unknown>[];
}

/** The text of each thought (`{ type:'thinking', text }`) of a stored reply, in order. */
export function thoughtsOf(message: Message | undefined): string[] {
  return (message?.segments ?? [])
    .filter((s) => (s as { type?: unknown }).type === 'thinking')
    .map((s) => (s as { text: string }).text);
}

/** The `type` of each segment of a stored reply, in order. */
export function segmentTypes(message: Message | undefined): string[] {
  return (message?.segments ?? []).map((s) => String((s as { type?: unknown }).type));
}
