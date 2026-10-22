/**
 * An assistant reply read back from an agent's own transcript, put into the
 * shape the bridge stores a reply in (`Message.segments`): its prose runs,
 * its thoughts (`ThinkingSegment`) and its steps, in the order the transcript
 * holds them — so a turn imported from a transcript reads like the same turn
 * streamed live, reasoning where it was thought.
 *
 * Each reader hands the parts over in transcript order; {@link build} gives
 * the reply's text (what `content` carries) and its segments.
 */
import type { ThinkingSegment } from '@uxnan/shared';

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'block'; block: unknown };

/** What {@link ReplySegments.build} gives. */
export interface BuiltReply {
  /** The prose, its runs concatenated — the reply's `content`. */
  text: string;
  /** Prose runs, thoughts and steps, in transcript order. */
  segments: unknown[];
}

export class ReplySegments {
  readonly #parts: Part[] = [];

  /** Whether nothing was handed over yet. */
  get empty(): boolean {
    return this.#parts.length === 0;
  }

  /** Prose. Prose right after prose joins it: one run. */
  text(text: string): this {
    if (text.length === 0) return this;
    const last = this.#parts[this.#parts.length - 1];
    if (last?.kind === 'text') last.text += text;
    else this.#parts.push({ kind: 'text', text });
    return this;
  }

  /**
   * Reasoning. Reasoning right after reasoning joins it, with [separator]
   * between: a blank line between two items of a transcript (the default),
   * nothing between the chunks of one streamed item (`''`).
   */
  thought(text: string, separator = '\n\n'): this {
    if (text.length === 0) return this;
    const last = this.#parts[this.#parts.length - 1];
    if (last?.kind === 'thought') last.text += separator + text;
    else this.#parts.push({ kind: 'thought', text });
    return this;
  }

  /** A step or any other block, as the live adapter would have emitted it. */
  block(block: unknown): this {
    this.#parts.push({ kind: 'block', block });
    return this;
  }

  /**
   * The reply: thoughts trimmed and empty ones dropped; prose that is only
   * whitespace between two other parts dropped; the prose trimmed at the
   * reply's two ends only (inside, it is kept as written); what became
   * neighbours of one kind joined. The text runs concatenate to `text`.
   */
  build(): BuiltReply {
    const parts: Part[] = [];
    const push = (part: Part): void => {
      const last = parts[parts.length - 1];
      if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
      else if (part.kind === 'thought' && last?.kind === 'thought') {
        last.text += `\n\n${part.text}`;
      } else parts.push({ ...part });
    };
    // Thoughts first: an empty one dropped lets the prose around it join.
    const thoughtsKept: Part[] = [];
    for (const part of this.#parts) {
      if (part.kind !== 'thought') thoughtsKept.push(part);
      else if (part.text.trim().length > 0) thoughtsKept.push({ ...part, text: part.text.trim() });
    }
    const joined: Part[] = [];
    for (const part of thoughtsKept) {
      const last = joined[joined.length - 1];
      if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
      else joined.push({ ...part });
    }
    for (const part of joined) {
      if (part.kind === 'text' && part.text.trim().length === 0) continue;
      push(part);
    }
    const runs = parts.filter((p): p is Extract<Part, { kind: 'text' }> => p.kind === 'text');
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first) first.text = first.text.trimStart();
    if (last) last.text = last.text.trimEnd();
    return {
      text: runs.map((run) => run.text).join(''),
      segments: parts.map((part) =>
        part.kind === 'text'
          ? { type: 'text', text: part.text }
          : part.kind === 'thought'
            ? ({ type: 'thinking', text: part.text } satisfies ThinkingSegment)
            : part.block,
      ),
    };
  }
}
