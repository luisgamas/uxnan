/**
 * The bar where the person answers an agent that wants to act in a browser
 * page (`src-tauri/src/browser/approval.rs`).
 *
 * What matters is that every button sends the answer it says — through the real
 * `api.ts` wrapper, to the real command name — and that the bar tells the person
 * enough to decide: who asks, on what, where, and whether it is a high-risk
 * action. A "site" answer must only be offered for a request that allows one:
 * a high-risk action is approved one at a time, never for a whole site.
 */

import { describe, expect, it } from "vitest";

import { mountWithProviders } from "../../test/render";
import type { BrowserApproval } from "$lib/api";
import BrowserApprovalBar from "./BrowserApprovalBar.svelte";

function request(over: Partial<BrowserApproval> = {}): BrowserApproval {
  return {
    id: "req-1",
    workspace: "/work/feat",
    agent: "Claude Code",
    action: "click",
    risk: "high",
    host: "localhost:5173",
    url: "http://localhost:5173/account",
    scope: "once",
    target: "button “Delete account”",
    detail: null,
    ...over,
  };
}

const commands = { browser_approval_answer: () => undefined };

describe("BrowserApprovalBar", () => {
  it("says who asks, for what, where — and flags a high-risk action", () => {
    const { screen } = mountWithProviders(BrowserApprovalBar, {
      props: { approval: request() },
      commands,
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Claude Code wants to click button “Delete account”")).toBeInTheDocument();
    expect(screen.getByText("localhost:5173")).toBeInTheDocument();
    expect(screen.getByText("May submit, delete, pay or sign in")).toBeInTheDocument();
  });

  it("answers once, or no, with the request's id", async () => {
    const { screen, user, backend } = mountWithProviders(BrowserApprovalBar, {
      props: { approval: request() },
      commands,
    });
    await user.click(screen.getByRole("button", { name: "Allow" }));
    expect(backend.lastCallTo("browser_approval_answer")?.args).toEqual({ id: "req-1", answer: "once" });
    await user.click(screen.getByRole("button", { name: "Deny" }));
    expect(backend.lastCallTo("browser_approval_answer")?.args).toEqual({ id: "req-1", answer: "deny" });
  });

  it("never offers the whole site for a one-at-a-time request", () => {
    const { screen } = mountWithProviders(BrowserApprovalBar, {
      props: { approval: request() },
      commands,
    });
    expect(screen.queryByRole("button", { name: /Allow on/ })).not.toBeInTheDocument();
  });

  it("offers the site, and shows the detail, when the request allows it", async () => {
    const { screen, user, backend } = mountWithProviders(BrowserApprovalBar, {
      props: {
        approval: request({
          action: "type",
          risk: "medium",
          scope: "site",
          host: "example.com",
          target: "textbox “Email”",
          detail: "15 characters",
        }),
      },
      commands,
    });
    expect(screen.getByText("Claude Code wants to type into textbox “Email”")).toBeInTheDocument();
    expect(screen.getByText(/15 characters/)).toBeInTheDocument();
    expect(screen.queryByText("May submit, delete, pay or sign in")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Allow on example.com" }));
    expect(backend.lastCallTo("browser_approval_answer")?.args).toEqual({ id: "req-1", answer: "site" });
  });
});
