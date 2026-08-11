export type StatusPopoverCloseReason = "outside" | "escape" | "navigation" | "programmatic";

/** Bits restores the trigger on Escape; other close paths keep user focus. */
export function shouldPreventStatusPopoverAutoFocus(reason: StatusPopoverCloseReason): boolean {
	return reason !== "escape";
}
