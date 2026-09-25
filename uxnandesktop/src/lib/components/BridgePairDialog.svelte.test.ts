/**
 * "Pair a phone": the running bridge's QR, its countdown, and the dialog's own
 * layout — the action band must span the dialog, not the content column.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../test/render";
import BridgePairDialog from "./BridgePairDialog.svelte";

const QR = '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

describe("BridgePairDialog", () => {
  it("draws the bridge's QR with its countdown", async () => {
    const { screen } = mountWithProviders(BridgePairDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: () => ({ svg: QR, expiresAt: Date.now() + 120_000 }) },
    });
    await until(() => screen.queryByRole("img") !== null);
    expect(screen.getByRole("img").querySelector("svg")).not.toBeNull();
  });

  it("says why when there is no QR to show", async () => {
    const { screen } = mountWithProviders(BridgePairDialog, {
      props: { open: true },
      commands: {
        bridge_pairing_qr: () => {
          throw { message: "no bridge running" };
        },
      },
    });
    await until(() => screen.queryByText("no bridge running") !== null);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps the dialog's own layout, so the action band spans it", async () => {
    mountWithProviders(BridgePairDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: () => ({ svg: QR, expiresAt: Date.now() + 120_000 }) },
    });
    await until(() => document.querySelector('[data-slot="dialog-footer"]') !== null);
    const content = document.querySelector('[data-slot="dialog-content"]')!;
    const footer = document.querySelector('[data-slot="dialog-footer"]')!;
    // The band's full bleed (`-mx-5`) is sized by the content grid; a flex
    // column or a `w-full` on the band leaves it a column's width, short of
    // the dialog's right edge.
    expect(content.className).toContain("grid");
    expect(content.className).not.toMatch(/\bflex-col\b/);
    expect(footer.className).not.toMatch(/\bw-full\b/);
  });
});
