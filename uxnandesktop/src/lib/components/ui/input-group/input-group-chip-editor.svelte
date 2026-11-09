<script lang="ts">
	// A multi-line plain-text field that holds atomic chips inline — the
	// input-group's control for text that carries objects (a chat message and
	// its attachments). It is the textarea control's twin: same slot, same
	// box, same type; what it adds is that a chip sits in the text where it was
	// inserted, moves with it, and goes away whole with one Backspace.
	//
	// `value` is the text with one `ATTACHMENT_MARKER` (U+FFFC) per chip and
	// `chips` their ids in the same order; both are bound, and kept in step
	// with what is on screen after every edit (`chip-editor.ts` maps the
	// element to that string). The caller builds each chip's look
	// (`renderChip`) and says what one copies as text (`chipText`). Pasting
	// takes plain text only — never a marker, never formatting — unless the
	// caller's `onpaste` takes the paste first (files); HTML drops into the
	// field are refused.
	//
	// FOR-DEV: verified in jsdom, Chromium (WebView2's engine) and WKWebView
	// (macOS, driven with real NSEvents), not yet in WebKitGTK (Linux) nor with
	// a real paste in the packaged macOS app. Run the FOR-DEV.md checks (*Chat
	// composer — attachment chips in the text*) there.
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { untrack } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import {
		ATTACHMENT_MARKER,
		stripAttachmentMarkers,
		countAttachmentMarkers,
	} from "$shared/models/inline-attachments";
	import {
		appKitKeys,
		caretOf,
		chipAround,
		chipNode,
		CHIP_ATTR,
		isChip,
		makeAtomic,
		plainTextOf,
		render,
		serialize,
		setCaret as placeCaret,
		spacedInsert,
	} from "./chip-editor";

	let {
		ref = $bindable(null),
		value = $bindable(""),
		chips = $bindable<string[]>([]),
		renderChip,
		chipText = () => "",
		hydrate,
		placeholder,
		disabled = false,
		class: className,
		onpaste,
		oninput,
		onkeydown,
		...props
	}: WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, "onpaste" | "oninput" | "onkeydown">> & {
		value?: string;
		chips?: string[];
		/** The look of the chip with this id (the editor makes it atomic). */
		renderChip: (id: string) => HTMLElement;
		/** What a chip copies as text (e.g. `[shot.png]`). */
		chipText?: (id: string) => string;
		/** Finish a chip once it is in the field (e.g. load its thumbnail). */
		hydrate?: (node: HTMLElement, id: string) => void;
		placeholder?: string;
		disabled?: boolean;
		onpaste?: (e: ClipboardEvent) => void;
		oninput?: (e: Event) => void;
		onkeydown?: (e: KeyboardEvent) => void;
	} = $props();

	/** The text last read from (or written to) the element. */
	let shown: string | null = null;
	/** Where the caret was the last time the field had it: what an insertion
	 *  made while the field is not focused (a drop, the picker) aims at. */
	let lastCaret: number | null = null;

	function read() {
		if (!ref) return;
		// A chip that appears twice (an undo, a drag inside the field) is one.
		const seen = new Set<string>();
		for (const node of [...ref.querySelectorAll(`[${CHIP_ATTR}]`)]) {
			const id = node.getAttribute(CHIP_ATTR) ?? "";
			if (seen.has(id)) node.remove();
			else makeAtomic(node as HTMLElement);
			seen.add(id);
		}
		const next = serialize(ref);
		shown = next.text;
		value = next.text;
		if (next.chips.join("\u0000") !== chips.join("\u0000")) chips = next.chips;
		hydrateAll();
	}

	/** Give every chip drawn since the last look what its HTML does not carry
	 *  (an image's pixels: large, and kept out of the editing history). */
	function hydrateAll() {
		if (!ref || !hydrate) return;
		for (const node of ref.querySelectorAll<HTMLElement>(`[${CHIP_ATTR}]:not([data-hydrated])`)) {
			hydrate(node, node.getAttribute(CHIP_ATTR) ?? "");
			node.setAttribute("data-hydrated", "");
		}
	}

	// Written from outside (a recall, a completion, a draft coming back): draw
	// it. Never while the person types — what they type is already on screen.
	$effect(() => {
		const text = value;
		const ids = chips;
		const el = ref;
		if (!el) return;
		untrack(() => {
			if (text === shown) return;
			const usable = countAttachmentMarkers(text) === ids.length ? text : stripAttachmentMarkers(text);
			const focused = el.ownerDocument.activeElement === el;
			const caret = focused ? caretOf(el) : null;
			render(el, usable, usable === text ? ids : [], renderChip);
			shown = usable;
			hydrateAll();
			if (usable !== text) value = usable;
			if (usable !== text && chips.length > 0) chips = [];
			if (focused) placeCaret(el, Math.min(caret ?? usable.length, usable.length));
		});
	});

	/** Where the caret is in `value` (its end when the field never had it). */
	export function caret(): number {
		const at = ref ? caretOf(ref) : null;
		return at ?? lastCaret ?? value.length;
	}

	/** Put the caret at [offset] of `value`, focusing the field. */
	export function setCaret(offset: number): void {
		if (!ref) return;
		ref.focus();
		placeCaret(ref, offset);
		lastCaret = offset;
	}

	export function focus(): void {
		ref?.focus();
	}

	function exec(command: string, arg?: string): boolean {
		try {
			return typeof document.execCommand === "function" && document.execCommand(command, false, arg);
		} catch {
			return false;
		}
	}

	/** Insert [text] at the caret, as typing would (undoable where the engine allows). */
	export function insertText(text: string): void {
		if (!ref || disabled) return;
		const clean = stripAttachmentMarkers(text);
		if (clean === "") return;
		const at = caret();
		if (ref.ownerDocument.activeElement !== ref) setCaret(at);
		if (!exec("insertText", clean)) {
			const next = value.slice(0, at) + clean + value.slice(at);
			commit(next, chips, at + clean.length);
			return;
		}
		read();
	}

	/**
	 * Insert chips [ids] at the caret, set apart from the words around them;
	 * the caret goes after them. The caller has their looks ready
	 * (`renderChip`).
	 */
	export function insertChips(ids: string[]): void {
		if (!ref || disabled || ids.length === 0) return;
		const at = caret();
		const { before, after } = spacedInsert(value, at);
		if (ref.ownerDocument.activeElement !== ref) setCaret(at);
		const html =
			escapeHtml(before) +
			ids.map((id) => chipNode(renderChip, id).outerHTML).join(" ") +
			escapeHtml(after);
		const markers = ids.map(() => ATTACHMENT_MARKER).join(" ");
		const end = at + before.length + markers.length + after.length;
		if (exec("insertHTML", html)) {
			read();
			// Where the engine leaves the caret after inserted markup varies
			// (WebKit: before the space that follows); it goes after the space.
			placeCaret(ref, end);
			return;
		}
		// No editing commands here (a test DOM): the same edit, drawn.
		const next = value.slice(0, at) + before + markers + after + value.slice(at);
		const index = countAttachmentMarkers(value.slice(0, at));
		const nextChips = [...chips.slice(0, index), ...ids, ...chips.slice(index)];
		commit(next, nextChips, end);
	}

	/** Take the chip [id] out of the text. */
	export function removeChip(id: string): void {
		if (!ref) return;
		const node = ref.querySelector(`[${CHIP_ATTR}="${CSS.escape(id)}"]`);
		if (!node) return;
		const range = ref.ownerDocument.createRange();
		range.selectNode(node);
		// The space that set it apart goes with it, so no double space is left.
		const next = node.nextSibling;
		const prev = node.previousSibling;
		const prevText = prev?.nodeType === Node.TEXT_NODE ? (prev.nodeValue ?? "") : "";
		const apart = prev === null || prev.nodeName === "BR" || /\s$/.test(prevText);
		if (apart && next?.nodeType === Node.TEXT_NODE && next.nodeValue?.startsWith(" ")) {
			range.setEnd(next, 1);
		}
		const selection = ref.ownerDocument.getSelection();
		ref.focus();
		selection?.removeAllRanges();
		selection?.addRange(range);
		if (!exec("delete")) range.deleteContents();
		read();
	}

	function commit(next: string, ids: string[], caretAt: number) {
		if (!ref) return;
		render(ref, next, ids, renderChip);
		hydrateAll();
		shown = next;
		value = next;
		chips = ids;
		setCaret(caretAt);
	}

	function escapeHtml(text: string): string {
		return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function rememberCaret() {
		if (!ref) return;
		// A caret never rests inside a chip (a click on its name can put it
		// there): it goes just after it, where typing joins the text.
		const selection = ref.ownerDocument.getSelection();
		const inside = selection?.isCollapsed ? chipAround(ref, selection.focusNode) : null;
		if (selection && inside) {
			const range = ref.ownerDocument.createRange();
			range.setStartAfter(inside);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			return;
		}
		const at = caretOf(ref);
		if (at !== null) lastCaret = at;
	}

	$effect(() => {
		const el = ref;
		if (!el) return;
		const doc = el.ownerDocument;
		doc.addEventListener("selectionchange", rememberCaret);
		return () => doc.removeEventListener("selectionchange", rememberCaret);
	});

	function handleInput(e: Event) {
		read();
		oninput?.(e);
	}

	/** ← / → next to a chip step over it as the one character it is — WebKit
	 *  alone cannot put the caret before a chip that starts a line. */
	function handleKeyDown(e: KeyboardEvent) {
		onkeydown?.(e);
		if (e.defaultPrevented || e.isComposing || !ref) return;
		if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		const selection = ref.ownerDocument.getSelection();
		if (!selection?.isCollapsed) return;
		const at = caretOf(ref);
		if (at === null) return;
		const target = e.key === "ArrowLeft" ? at - 1 : at + 1;
		const crossed = e.key === "ArrowLeft" ? value[at - 1] : value[at];
		if (crossed !== ATTACHMENT_MARKER) return;
		e.preventDefault();
		placeCaret(ref, target);
	}

	function handleBeforeInput(e: InputEvent) {
		switch (e.inputType) {
			// One kind of line break, never a paragraph wrapper.
			case "insertParagraph":
				e.preventDefault();
				if (!exec("insertLineBreak")) insertText("\n");
				return;
			// Plain text only.
			case "formatBold":
			case "formatItalic":
			case "formatUnderline":
			case "formatStrikeThrough":
			case "insertFromDrop":
				e.preventDefault();
				return;
			// An arrow (Home, End…) WKWebView handed over as its AppKit
			// character instead of as its command: the move it meant, never
			// a box in the text.
			case "insertText": {
				const keys = appKitKeys(e.data);
				if (!keys) return;
				e.preventDefault();
				const selection = ref?.ownerDocument.getSelection();
				for (const { move } of keys) {
					if (move) selection?.modify?.("move", move.direction, move.granularity);
				}
				return;
			}
		}
	}

	function handlePaste(e: ClipboardEvent) {
		onpaste?.(e);
		if (e.defaultPrevented) return;
		e.preventDefault();
		insertText(e.clipboardData?.getData("text/plain") ?? "");
	}

	function selectedText(): string | null {
		const selection = ref?.ownerDocument.getSelection();
		if (!ref || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
		const range = selection.getRangeAt(0);
		if (!ref.contains(range.commonAncestorContainer)) return null;
		return plainTextOf(range.cloneContents(), (chip) =>
			chipText(chip.getAttribute(CHIP_ATTR) ?? ""),
		);
	}

	function handleCopy(e: ClipboardEvent) {
		const text = selectedText();
		if (text === null || !e.clipboardData) return;
		e.preventDefault();
		e.clipboardData.setData("text/plain", text);
	}

	function handleCut(e: ClipboardEvent) {
		handleCopy(e);
		if (!e.defaultPrevented) return;
		if (!exec("delete")) {
			ref?.ownerDocument.getSelection()?.deleteFromDocument();
		}
		read();
	}

	function handleMouseDown(e: MouseEvent) {
		// A click on a chip's own control (its ✕) must not move the caret into it.
		const target = e.target as HTMLElement | null;
		if (target?.closest("[data-chip-action]")) e.preventDefault();
	}

	/** A stop is selectable text that takes no room and no pointer. */
	const stopClass = "pointer-events-none absolute size-0 overflow-hidden select-text";

	function handleDragStart(e: DragEvent) {
		if (isChip((e.target as Node) ?? null)) e.preventDefault();
	}
</script>

<!-- Selectable stops on both sides of the field. macOS WebKit reads the text
     around the caret after every keystroke and every frame (its editor state
     for the input methods), walking the document position by position until
     it finds selectable text. The app is `user-select: none`, so without
     these the walk crosses the whole window — the sidebar, other panes, every
     row of a long chat — and typing slows to a crawl as the window fills
     (a textarea never pays it: its text lives in its own inner tree). -->
<span data-chip-editor-stop="" aria-hidden="true" class={stopClass}>&#8203;</span>
<div
	bind:this={ref}
	data-slot="input-group-control"
	data-chip-editor=""
	role="textbox"
	tabindex={disabled ? -1 : 0}
	aria-multiline="true"
	aria-disabled={disabled || undefined}
	aria-placeholder={placeholder}
	data-placeholder={placeholder}
	data-empty={value === "" ? "" : undefined}
	contenteditable={disabled ? "false" : "true"}
	spellcheck="true"
	class={cn(
		"relative flex-1 w-full min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-none border-0 bg-transparent px-2.5 py-2 text-base md:text-sm outline-none",
		"data-empty:before:pointer-events-none data-empty:before:absolute data-empty:before:text-muted-foreground data-empty:before:content-[attr(data-placeholder)]",
		"aria-disabled:cursor-not-allowed",
		className,
	)}
	oninput={handleInput}
	onkeydown={handleKeyDown}
	onbeforeinput={handleBeforeInput}
	onpaste={handlePaste}
	oncopy={handleCopy}
	oncut={handleCut}
	onmousedown={handleMouseDown}
	ondragstart={handleDragStart}
	ondrop={(e) => e.preventDefault()}
	{...props}
></div>
<span data-chip-editor-stop="" aria-hidden="true" class={stopClass}>&#8203;</span>
