/**
 * Rendering helpers for component tests.
 *
 * Thin on purpose. Testing Library already gives the right primitives; what this
 * adds is the pairing every test in this repo needs — a component *and* a fake
 * backend, torn down together — plus a nudge toward accessible queries.
 *
 * The house style, in one line: **query the way a user finds things** (role,
 * label, text), and reach for `data-testid` only when there is genuinely no
 * accessible handle. A test that only passes because it knew the class name will
 * fail the next time someone restyles the component, and will keep passing the
 * next time someone breaks its accessibility.
 */

import { render as tlRender, type RenderResult } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import type { Component } from "svelte";

import { installFakeBackend, type CommandTable, type FakeBackend } from "./tauri";

/** Any Svelte 5 component, whatever its prop types. Tests pass props as a plain
 *  record — they are written by hand and checked by the assertions that follow,
 *  and threading each component's generics through here would buy nothing but
 *  ceremony. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = Component<any, any, any>;

export interface MountOptions {
  /** Props for the component. */
  props?: Record<string, unknown>;
  /** Backend command handlers for this test. */
  commands?: CommandTable;
}

export interface Mounted {
  /** Testing Library's result: `getByRole`, `container`, `unmount`, … */
  screen: RenderResult<AnyComponent>;
  /** The fake backend behind it. */
  backend: FakeBackend;
  /** A `user-event` instance already set up for this test. */
  user: ReturnType<typeof userEvent.setup>;
}

/**
 * Mount a component against a fake backend.
 *
 * Cleanup is automatic: `svelteTesting()` unmounts the component and
 * `setup.dom.ts` uninstalls the backend, both after every test.
 */
export function mount(component: AnyComponent, options: MountOptions = {}): Mounted {
  const backend = installFakeBackend(options.commands);
  const user = userEvent.setup();
  const screen = tlRender(component, options.props ?? {}) as RenderResult<AnyComponent>;
  return { screen, backend, user };
}

/**
 * Wait for a condition that has no DOM signal — a call reaching the backend, a
 * store settling. Polls the microtask queue rather than sleeping, so it costs
 * nothing when the condition is already true and never adds fixed delay.
 *
 * Prefer Testing Library's `findBy*` when the thing being waited for *is* in the
 * DOM; this is for the cases where it is not.
 */
export async function until(
  predicate: () => boolean,
  { timeoutMs = 2000, label = "condition" }: { timeoutMs?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
