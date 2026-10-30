<script lang="ts">
  // The chat's input. Enter sends, Shift+Enter breaks the line (and an IME
  // composition is never cut short). While the agent works the button stops
  // it; typing meanwhile sends a follow-up the bridge queues behind the running
  // turn — or hands to it directly, on agents that take input mid-turn — which
  // is exactly what the phone does with the same message. On an empty
  // composer ↑ recalls the thread's earlier messages (newest first) and ↓ walks
  // back; the text is `bindable`, so the view keeps it as the tab's draft and
  // can put a withdrawn or failed message back into it.
  //
  // What the phone's composer does, the same way: `/` opens the agent's
  // commands (`agent/commands`, grouped: skills, the user's own, built-ins,
  // loaded as soon as the agent is known) and a `/name args` message is sent as
  // `turn/send { command }`; `@` browses and searches the project through the
  // bridge that owns its folder (`workspace/list`, `workspace/searchFiles`) —
  // a folder drills in, a file is written as `@path`. Images and files — from
  // the paperclip, pasted or dropped, up to the phone's limit — become chips
  // INSIDE the text, at the caret, and the message goes out with them where
  // they sit (one `ATTACHMENT_MARKER` per chip in `value`, the attachments in
  // the same order), so the agent knows which words each one belongs to. A
  // file dropped on it (from the OS or the file tree, routed by
  // `$lib/fileDrop`) is mentioned when it is one of the project's and attached
  // otherwise. Resting on an image chip shows the image. The suggestion panel
  // sits over the composer, which keeps the focus and drives it (↑ ↓, Enter or
  // Tab, Esc).
  //
  // Built on the shared `InputGroup` (the same primitive the command palette's
  // search uses): its chip editor (plain text with atomic chips) over a
  // `block-end` toolbar of quiet pills — the agent and the model with its run
  // options (`leading`), the access mode (`trailing`) — then the context ring
  // and the round send / stop button.
  import * as InputGroup from "$lib/components/ui/input-group";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
  import StopIcon from "@hugeicons/core-free-icons/StopIcon";
  import Attachment01Icon from "@hugeicons/core-free-icons/Attachment01Icon";
  import * as HoverCard from "$lib/components/ui/hover-card";
  import { mount, tick, unmount, untrack, type ComponentProps, type Snippet } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { AgentCommand, AgentCommandInvocation } from "$shared/agents/agent-capabilities";
  import type { TurnAttachment } from "$shared/models/workspace";
  import ChatContextRing from "./ChatContextRing.svelte";
  import ChatSuggestions, { type Suggestion } from "./ChatSuggestions.svelte";
  import ChatAttachmentChip from "./ChatAttachmentChip.svelte";
  import {
    asCommand,
    complete,
    matchCommands,
    tokenAt,
    type ComposerToken,
  } from "$lib/bridge/composerTokens";
  import { imageFromBlob, imageFromDataUrl, MAX_IMAGES } from "$lib/bridge/imageAttachment";
  import {
    attachmentFromTurn,
    keepAttachments,
    keptAttachments,
    pastedImageName,
    reconcileDraft,
    type ComposerAttachment,
  } from "$lib/bridge/composerAttachments";
  import { stripAttachmentMarkers } from "$shared/models/inline-attachments";
  import { mentionEntries, mentionFor } from "$lib/bridge/mentions";
  import { fileDropTarget } from "$lib/fileDrop";
  import { fsIsDir } from "$lib/api";
  import { quoteDropPath } from "$lib/terminal/terminalDrop";
  import { clipSpan, fitPanel, type PanelFit } from "$lib/floatingFit";
  import { MAX_FILES, fileFromBlob, fileFromRead, isImageName, type ReadFile } from "$lib/bridge/fileAttachment";
  import { useChat } from "$lib/bridge/chat.svelte";
  import { errorMessage, toast, toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    value = $bindable(""),
    history = [],
    running = false,
    disabled = false,
    placeholder,
    autofocus = false,
    onsend,
    onstop,
    leading,
    trailing,
    context = null,
    plan = null,
    loadCommands,
    mentionRoot,
    acceptsImages = false,
    atNextPause = false,
    draftKey,
  }: {
    /** The text being written (the view persists it as the tab's draft), one
     *  `ATTACHMENT_MARKER` where each attachment chip sits. */
    value?: string;
    /** The thread's earlier messages, oldest first, for ↑ / ↓ recall. */
    history?: string[];
    running?: boolean;
    disabled?: boolean;
    placeholder?: string;
    autofocus?: boolean;
    /** Sends the message (its markers where the chips sat); a known
     *  `/command` and its attachments, in the order of the markers, come with it. */
    onsend: (
      text: string,
      extras: { command?: AgentCommandInvocation; attachments?: TurnAttachment[] },
    ) => void | Promise<void>;
    onstop?: () => void;
    /** Controls shown at the start of the toolbar (the model picker). */
    leading?: Snippet;
    /** Controls shown after the leading ones (the access mode). */
    trailing?: Snippet;
    /** How full the context window is, when the agent reports it. */
    context?: { tokens: number; limit: number } | null;
    /** Where the agent's plan stands (`ChatContextRing`), when it is read. */
    plan?: ComponentProps<typeof ChatContextRing>["plan"];
    /** The agent's commands for the `/` panel (none offered without it). */
    loadCommands?: () => Promise<AgentCommand[]>;
    /** The project folder `@` completes files from (none without it). */
    mentionRoot?: string;
    /** Whether the agent takes images (`capabilities.images`). */
    acceptsImages?: boolean;
    /**
     * While the agent works, whether a message sent now reaches it at its next
     * step (it takes input mid-turn, and nothing is queued, paused or waiting
     * on an answer) rather than waiting in the queue — so the composer says
     * which will happen.
     */
    atNextPause?: boolean;
    /** Where this composer's attachments are kept while the app runs (the
     *  tab's id), so a draft keeps its chips when the composer is rebuilt. */
    draftKey?: string;
  } = $props();
  // The bridge of the machine this chat is on — mentions are its files.
  const bridge = useChat().client;

  let ref = $state<HTMLDivElement | null>(null);
  let editor = $state<ReturnType<typeof InputGroup.ChipEditor> | null>(null);

  // ---- attachments: chips in the text ----
  /** Every attachment this composer has held (an undo may bring a removed
   *  chip back), by chip id; what is sent is the chips in the text. */
  const registry = new Map<string, ComposerAttachment>();
  /** The chips in the text, in order (the editor keeps it in step). */
  let chipIds = $state<string[]>([]);
  const attachments = $derived(
    chipIds.map((id) => registry.get(id)).filter((a): a is ComposerAttachment => a !== undefined),
  );
  const imageCount = $derived(attachments.filter((a) => a.kind === "image").length);
  const fileCount = $derived(attachments.length - imageCount);
  const empty = $derived(stripAttachmentMarkers(value).trim().length === 0 && attachments.length === 0);

  // What the tab's draft carried, when the composer is rebuilt (a chat that
  // starts, a tab that comes back): its chips, or — its bytes gone with a
  // restart — its words without their markers.
  untrack(() => {
    const kept = draftKey ? keptAttachments(draftKey) : undefined;
    const draft = reconcileDraft(value, kept);
    for (const a of draft.attachments) registry.set(a.id, a);
    chipIds = draft.attachments.map((a) => a.id);
    if (draft.text !== value) value = draft.text;
  });
  $effect(() => {
    const list = attachments;
    if (draftKey) keepAttachments(draftKey, list);
  });

  // ---- the suggestion panel: `/command` or `@file` under the caret ----
  let token = $state<ComposerToken | undefined>(undefined);
  /** A token the user dismissed with Esc stays closed until it changes. */
  let dismissed = $state<string | null>(null);
  let commands = $state<AgentCommand[] | null>(null);
  let commandsLoading = $state(false);
  let files = $state<{ path: string; isDir: boolean }[]>([]);
  let filesLoading = $state(false);
  let active = $state(0);

  const tokenKey = $derived(token ? `${token.kind}:${token.start}:${token.query}` : null);
  const panelOpen = $derived(
    token !== undefined &&
      tokenKey !== dismissed &&
      ((token.kind === "command" && loadCommands !== undefined) ||
        (token.kind === "mention" && mentionRoot !== undefined)),
  );
  const items = $derived<Suggestion[]>(
    !panelOpen || !token
      ? []
      : token.kind === "command"
        ? matchCommands(commands ?? [], token.query)
            .slice(0, 60)
            .map((command) => ({ kind: "command" as const, command }))
        : files.map((f) => ({ kind: "file" as const, ...f })),
  );

  function readToken() {
    token = editor && ref?.ownerDocument.activeElement === ref ? tokenAt(value, editor.caret()) : undefined;
  }

  // The agent's commands, asked as soon as the agent is known — not when `/`
  // is typed — so a `/name args` message recalled, pasted, restored from the
  // draft or sent at once still goes out as the command it is. Another agent
  // (a new chat's picker) has other commands: its own load replaces them.
  let commandsRequest: Promise<AgentCommand[]> | null = null;
  function ensureCommands(): Promise<AgentCommand[]> {
    if (!loadCommands) return Promise.resolve([]);
    if (commands !== null) return Promise.resolve(commands);
    commandsRequest ??= loadCommands().catch(() => [] as AgentCommand[]);
    return commandsRequest;
  }
  $effect(() => {
    const load = loadCommands;
    // Only the loader is tracked: the load itself reads and writes `commands`.
    return untrack(() => {
      commands = null;
      commandsRequest = null;
      if (!load) return;
      let current = true;
      commandsLoading = true;
      void ensureCommands()
        .then((list) => {
          if (current) commands = list;
        })
        .finally(() => {
          if (current) commandsLoading = false;
        });
      return () => {
        current = false;
      };
    });
  });

  // What the mention names — the folder it is in, or the project's matches —
  // a beat after typing stops, asked of the bridge (`$lib/bridge/mentions`).
  let searchSeq = 0;
  $effect(() => {
    if (token?.kind !== "mention" || !mentionRoot || tokenKey === dismissed) return;
    const query = token.query;
    const root = mentionRoot;
    const seq = ++searchSeq;
    filesLoading = true;
    const timer = setTimeout(async () => {
      try {
        const found = await mentionEntries((m, p) => bridge.call(m, p), root, query);
        if (seq === searchSeq) files = found;
      } catch {
        if (seq === searchSeq) files = [];
      } finally {
        if (seq === searchSeq) filesLoading = false;
      }
    }, 150);
    return () => clearTimeout(timer);
  });

  // Where the panel fits: above the composer while there is room, below it
  // when a new chat's mid-pane composer has more room there — never past the
  // pane that would cut its first rows off.
  let root = $state<HTMLDivElement | null>(null);
  /** The menu's own cap (`overlay.menuCompactViewport`, `max-h-72`) and the
   *  padding its surface (`overlay.menuSurface`, `p-1`) adds around it. */
  const PANEL_CAP = 288;
  const PANEL_PADDING = 8;
  let fit = $state<PanelFit>({ side: "above", maxHeight: PANEL_CAP + PANEL_PADDING });
  function measureFit() {
    if (root) fit = fitPanel(root.getBoundingClientRect(), clipSpan(root), PANEL_CAP + PANEL_PADDING);
  }
  $effect(() => {
    if (!panelOpen) return;
    void value; // the composer grows as it is written
    measureFit();
  });
  $effect(() => {
    if (!panelOpen) return;
    window.addEventListener("resize", measureFit);
    window.addEventListener("scroll", measureFit, true);
    return () => {
      window.removeEventListener("resize", measureFit);
      window.removeEventListener("scroll", measureFit, true);
    };
  });

  // A new token starts at the top of the list.
  $effect(() => {
    void tokenKey;
    active = 0;
  });

  function pick(item: Suggestion) {
    if (!token) return;
    const replacement =
      item.kind === "command" ? `/${item.command.name}` : `@${item.path}${item.isDir ? "/" : ""}`;
    const next = complete(value, token, replacement);
    value = next.text;
    token = undefined;
    void tick().then(() => {
      editor?.setCaret(next.caret);
      readToken();
    });
  }

  /** Keys the open panel takes; true when it took this one. */
  function panelKey(e: KeyboardEvent): boolean {
    if (!panelOpen) return false;
    if (e.key === "Escape") {
      dismissed = tokenKey;
      return true;
    }
    if (items.length === 0) return false;
    if (e.key === "ArrowDown") {
      active = (active + 1) % items.length;
      return true;
    }
    if (e.key === "ArrowUp") {
      active = (active - 1 + items.length) % items.length;
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const item = items[active];
      if (item) pick(item);
      return true;
    }
    return false;
  }

  // ---- attachments ----
  /** A chip's look, built by the chip component itself (the editor copies it
   *  into its text: a chip has no life of its own there). */
  function renderChip(id: string): HTMLElement {
    const a = registry.get(id);
    const host = document.createElement("span");
    const instance = mount(ChatAttachmentChip, {
      target: host,
      props: {
        name: a?.name ?? "",
        kind: a?.kind ?? "file",
        mimeType: a?.attachment.mimeType ?? "",
        removeLabel: i18n.t("chat.removeImage", { name: a?.name ?? "" }),
      },
    });
    const node = (host.firstElementChild?.cloneNode(true) as HTMLElement | null) ?? document.createElement("span");
    void unmount(instance);
    return node;
  }

  /** An image chip's pixels, once it is in the text. */
  function hydrateChip(node: HTMLElement, id: string) {
    const url = registry.get(id)?.previewUrl;
    const img = node.querySelector<HTMLImageElement>("img[data-chip-thumb]");
    if (!url || !img) return;
    img.src = url;
    img.classList.remove("hidden");
  }

  /** Put [list] in the text at the caret, as far as the per-message limits
   *  allow (a toast says when they leave some out). */
  function addAttachments(list: ComposerAttachment[]) {
    let roomImages = Math.max(0, MAX_IMAGES - imageCount);
    let roomFiles = Math.max(0, MAX_FILES - fileCount);
    const taken: ComposerAttachment[] = [];
    let leftImages = false;
    let leftFiles = false;
    for (const a of list) {
      if (a.kind === "image") {
        if (roomImages === 0) leftImages = true;
        else (roomImages -= 1, taken.push(a));
      } else if (roomFiles === 0) leftFiles = true;
      else (roomFiles -= 1, taken.push(a));
    }
    if (leftImages) toast(i18n.t("chat.imagesLimit", { count: MAX_IMAGES }));
    if (leftFiles) toast(i18n.t("chat.filesLimit", { count: MAX_FILES }));
    if (taken.length === 0) return;
    for (const a of taken) registry.set(a.id, a);
    editor?.insertChips(taken.map((a) => a.id));
  }

  /** Replace what the composer holds with [text] and its [list] of
   *  attachments (in the order of its markers) — a message coming back to be
   *  edited, a saved draft put back. A text whose attachments are not all
   *  here loses its markers instead. */
  export function load(text: string, list: readonly (ComposerAttachment | TurnAttachment)[] = []) {
    const draft = reconcileDraft(
      text,
      list.map((a) => ("kind" in a ? a : attachmentFromTurn(a))),
    );
    for (const a of draft.attachments) registry.set(a.id, a);
    chipIds = draft.attachments.map((a) => a.id);
    value = draft.text;
    void tick().then(() => editor?.setCaret(draft.text.length));
  }

  /** What the composer holds: its text and its attachments, in order. */
  export function snapshot(): { text: string; attachments: ComposerAttachment[] } {
    return { text: value, attachments: [...attachments] };
  }

  /** Attach files by path: an image goes as an image (scaled, a thumbnail)
   *  when the agent takes images; everything else — and an image for an agent
   *  that takes none — goes as a file, which every agent opens with its tools.
   *  Each path stands on its own: one that cannot be read (too large, gone, a
   *  folder) is named in a toast, and every other one is still attached. */
  async function attachPaths(paths: string[]) {
    const ready: ComposerAttachment[] = [];
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() || "file";
      try {
        if (acceptsImages && isImageName(name)) {
          const dataUrl = await invoke<string>("fs_read_data_url", { path });
          ready.push(await imageFromDataUrl(dataUrl, name));
        } else {
          ready.push(fileFromRead(await invoke<ReadFile>("fs_read_attachment", { path })));
        }
      } catch (err) {
        toast.error(i18n.t("chat.attachFailed", { name, reason: errorMessage(err) }));
      }
    }
    addAttachments(ready);
  }

  /** The paperclip: any file, attached at the caret. */
  async function chooseAttachments() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: true });
      await attachPaths(Array.isArray(picked) ? picked : picked ? [picked] : []);
      editor?.focus();
    } catch (err) {
      toastError(err);
    }
  }

  /** Pasted files: images as images when the agent takes them (a pasted
   *  screenshot named `image-<n>` so two are told apart), everything else as
   *  files. */
  async function takeBlobs(blobs: File[]) {
    const names = attachments.map((a) => a.name);
    const ready: ComposerAttachment[] = [];
    for (const f of blobs) {
      if (acceptsImages && f.type.startsWith("image/")) {
        const name = pastedImageName(f.name, f.type, names);
        names.push(name);
        ready.push(await imageFromBlob(f, name));
      } else {
        ready.push(await fileFromBlob(f, f.name || "file"));
      }
    }
    addAttachments(ready);
  }

  /** [insert] written at the caret (the end, before the composer was ever
   *  focused), set apart from the words around it. */
  function insertAtCaret(insert: string) {
    const at = editor?.caret() ?? value.length;
    const before = value.slice(0, at);
    const after = value.slice(at);
    editor?.insertText(
      `${before === "" || /\s$/.test(before) ? "" : " "}${insert}${/^\s/.test(after) ? "" : " "}`,
    );
  }

  /** What a dropped path becomes in the message. */
  type DroppedAs = { text: string } | { attach: string };

  /** A path dropped on the composer, sorted: an image is attached as one when
   *  the agent takes images (the agent sees it); anything else of the project,
   *  file or folder, is mentioned, `@path`, exactly as picking it from `@`
   *  writes it (the agent opens it itself, nothing is copied); a folder from
   *  elsewhere — or the project's own — is written as its path, quoted when it
   *  has spaces, as a terminal gets it; any other file is attached like the paperclip. */
  async function droppedAs(path: string): Promise<DroppedAs> {
    if (acceptsImages && isImageName(path.split(/[\\/]/).pop() ?? "")) return { attach: path };
    const mention = mentionRoot ? mentionFor(mentionRoot, path) : null;
    if (mention) return { text: mention };
    // A path that cannot be asked about is tried as a file, which names it.
    const folder = await fsIsDir(path).catch(() => false);
    return folder ? { text: quoteDropPath(path) } : { attach: path };
  }

  /** Paths dropped on the composer — from the OS or the file tree — land at
   *  the caret, in the order they were dropped. */
  async function takeDroppedPaths(paths: string[]) {
    if (disabled) return;
    const sorted = await Promise.all(paths.map(droppedAs));
    const texts = sorted.flatMap((d) => ("text" in d ? [d.text] : []));
    if (texts.length > 0) insertAtCaret(texts.join(" "));
    await attachPaths(sorted.flatMap((d) => ("attach" in d ? [d.attach] : [])));
    editor?.focus();
  }

  /** Files are being dragged over the composer (`$lib/fileDrop` says so). */
  let dragging = $state(false);

  async function onpaste(e: ClipboardEvent) {
    const pasted = [...(e.clipboardData?.files ?? [])];
    if (pasted.length === 0) return;
    e.preventDefault();
    try {
      await takeBlobs(pasted);
    } catch (err) {
      toastError(err);
    }
  }

  // ---- an image chip's preview, on hover ----
  let previewOpen = $state(false);
  let previewAnchor = $state<HTMLElement | null>(null);
  const previewed = $derived(
    previewAnchor ? registry.get(previewAnchor.getAttribute("data-chip") ?? "") : undefined,
  );
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePreview(next: HTMLElement | null, delay: number) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (next) previewAnchor = next;
      previewOpen = next !== null;
    }, delay);
  }
  function chipOf(target: EventTarget | null): HTMLElement | null {
    return (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-chip]") ?? null;
  }
  function onpointerover(e: PointerEvent) {
    const chip = chipOf(e.target);
    if (!chip || chip === chipOf(e.relatedTarget)) return;
    const a = registry.get(chip.getAttribute("data-chip") ?? "");
    if (a?.previewUrl) schedulePreview(chip, previewOpen ? 0 : 300);
  }
  function onpointerout(e: PointerEvent) {
    const chip = chipOf(e.target);
    if (!chip || chip === chipOf(e.relatedTarget)) return;
    schedulePreview(null, 120);
  }
  $effect(() => () => clearTimeout(previewTimer));

  /** A click on a chip's ✕ takes it out. */
  function onclick(e: MouseEvent) {
    const remove = (e.target as HTMLElement | null)?.closest?.("[data-chip-action='remove']");
    const chip = chipOf(remove ?? null);
    if (chip) {
      e.preventDefault();
      previewOpen = false;
      editor?.removeChip(chip.getAttribute("data-chip") ?? "");
      return;
    }
    readToken();
  }

  $effect(() => {
    if (autofocus && ref && !disabled) ref.focus();
  });

  async function submit() {
    if (empty || disabled) return;
    const message = value;
    const command = message.trimStart().startsWith("/")
      ? asCommand(message, await ensureCommands())
      : undefined;
    const sent = attachments.map((a) => a.attachment);
    chipIds = [];
    value = "";
    registry.clear();
    token = undefined;
    previewOpen = false;
    await onsend(message, {
      ...(command ? { command } : {}),
      ...(sent.length > 0 ? { attachments: sent } : {}),
    });
  }

  /** Which earlier message ↑ put in the composer (an index into `history`). */
  let recalled = $state<number | null>(null);

  /** ↑ / ↓ walk the history while the composer is empty or still shows a
   *  recalled message untouched; any edit ends the walk. */
  function recall(step: -1 | 1): boolean {
    if (history.length === 0) return false;
    const walking = recalled !== null && value === history[recalled];
    if (!walking && value !== "") return false;
    if (!walking && step === 1) return false;
    const next = (walking ? (recalled as number) : history.length) + step;
    if (next < 0) return true;
    if (next >= history.length) {
      recalled = null;
      value = "";
      return true;
    }
    recalled = next;
    value = history[next];
    void tick().then(() => editor?.setCaret(value.length));
    return true;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (panelKey(e)) {
      e.preventDefault();
      return;
    }
    const plain = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
    if (plain && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (recall(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    recalled = null;
    void submit();
  }
</script>

<div
  bind:this={root}
  class="relative flex flex-col gap-1"
  use:fileDropTarget={{
    ondrop: (paths) => void takeDroppedPaths(paths),
    onover: (over) => (dragging = over && !disabled),
  }}
>
  {#if panelOpen}
    <div class={cn("absolute inset-x-0 z-20", fit.side === "above" ? "bottom-full mb-2" : "top-full mt-2")}>
      <ChatSuggestions
        {items}
        {active}
        maxHeight={Math.max(0, fit.maxHeight - PANEL_PADDING)}
        loading={token?.kind === "command" ? commandsLoading : filesLoading}
        emptyLabel={token?.kind === "command" ? i18n.t("chat.noCommands") : i18n.t("chat.noFiles")}
        onpick={pick}
        onhover={(index) => (active = index)}
      />
    </div>
  {/if}
  <!-- The group dims only when the EDITOR is disabled, not whenever any of its
       buttons is (the send button is disabled on an empty draft, and the
       primitive's `has-disabled` would fade the whole composer for it). -->
  <InputGroup.Root
    class={cn(
      chat.composer,
      "rounded-xl bg-card shadow-xs has-disabled:bg-card has-disabled:opacity-100 has-[[data-chip-editor][aria-disabled=true]]:opacity-50",
      dragging && "ring-2 ring-ring/40",
    )}
  >
    <InputGroup.ChipEditor
      bind:this={editor}
      bind:ref
      bind:value
      bind:chips={chipIds}
      {renderChip}
      hydrate={hydrateChip}
      chipText={(id) => `[${registry.get(id)?.name ?? ""}]`}
      {onkeydown}
      {onpaste}
      {onclick}
      {onpointerover}
      {onpointerout}
      oninput={readToken}
      onkeyup={(e: KeyboardEvent) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") readToken();
      }}
      onblur={() => (token = undefined)}
      {disabled}
      placeholder={placeholder ?? i18n.t("chat.composerPlaceholder")}
      aria-label={i18n.t("chat.composerLabel")}
      class={cn("max-h-60 min-h-11 px-3 leading-5 uxnan-scroll", text.body)}
    />
    <InputGroup.Addon align="block-end" class="min-w-0 gap-0.5">
      <InputGroup.Button
        size="icon-sm"
        variant="ghost"
        class="rounded-full text-muted-foreground"
        aria-label={i18n.t("chat.attach")}
        title={i18n.t("chat.attach")}
        disabled={disabled || (imageCount >= MAX_IMAGES && fileCount >= MAX_FILES)}
        onclick={() => void chooseAttachments()}
      >
        <Icon icon={Attachment01Icon} class={icon.action} />
      </InputGroup.Button>
      {#if leading}{@render leading()}{/if}
      {#if trailing}{@render trailing()}{/if}
      <span class="flex-1"></span>
      {#if context && context.limit > 0}
        <ChatContextRing tokens={context.tokens} limit={context.limit} {plan} />
      {/if}
      {#if running && onstop}
        <!-- Stopping the agent stays one click away while a message is being
             written, not only on an empty composer. -->
        <InputGroup.Button
          size="icon-sm"
          variant="secondary"
          class="rounded-full"
          aria-label={i18n.t("chat.stop")}
          title={i18n.t("chat.stop")}
          onclick={onstop}
        >
          <Icon icon={StopIcon} class={icon.action} />
        </InputGroup.Button>
      {/if}
      {#if !running || !empty || !onstop}
        <InputGroup.Button
          size="icon-sm"
          variant="default"
          class="rounded-full"
          disabled={empty || disabled}
          aria-label={running ? i18n.t("chat.queue") : i18n.t("chat.send")}
          title={running ? i18n.t("chat.queue") : i18n.t("chat.send")}
          onclick={() => void submit()}
        >
          <Icon icon={ArrowUp02Icon} class={icon.action} />
        </InputGroup.Button>
      {/if}
    </InputGroup.Addon>
  </InputGroup.Root>
  <!-- An image chip, whole: shown while the pointer rests on it. -->
  <HoverCard.Root bind:open={previewOpen}>
    <HoverCard.Content
      customAnchor={previewAnchor}
      side="top"
      align="center"
      width="form"
      class="w-auto max-w-[min(26rem,80vw)] p-1.5"
      onpointerenter={() => clearTimeout(previewTimer)}
      onpointerleave={() => schedulePreview(null, 120)}
    >
      {#if previewed?.previewUrl}
        <img src={previewed.previewUrl} alt={previewed.name} class={chat.attachmentPreview} />
        <p class={cn(text.meta, "truncate px-1 pt-1")}>{previewed.name}</p>
      {/if}
    </HoverCard.Content>
  </HoverCard.Root>
  {#if running && !empty}
    <p class={cn(text.meta, "px-1")}>
      {i18n.t(atNextPause ? "chat.nextPauseHint" : "chat.queueHint")}
    </p>
  {/if}
</div>
