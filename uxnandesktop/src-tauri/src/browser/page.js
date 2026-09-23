// The page side of the integrated browser's agent tools.
//
// Injected into every main-frame document of a browser page before the page's
// own scripts run (`browser/host.rs`, `initialization_script`). It gives the
// backend a small, fixed vocabulary — read the page as an outline, act on an
// element the outline named — and nothing else: no general `eval`, no selector
// language, no coordinates. The backend calls it through the engine's own
// script evaluation and reads back one JSON string; the page cannot call out.
//
// The page is untrusted. It can shadow globals and change the DOM under us, so
// the functions this relies on are captured here, before any page script runs,
// and every result is data the backend validates and caps — evidence the page
// produced, never proof of what the page is.
//
// Element references are `<doc>:e<n>`: `<doc>` is random per document, so a
// reference from a page that has since navigated or reloaded can never resolve
// to an element of the new one; `e<n>` is stable for an element within its
// document across snapshots.
(() => {
  "use strict";
  const KEY = "__uxnanPage";
  if (Object.prototype.hasOwnProperty.call(window, KEY)) return;

  // --- Captured before the page can replace them -------------------------
  const W = window;
  const D = document;
  const O = Object;
  const JSONs = JSON.stringify.bind(JSON);
  const gbcr = Element.prototype.getBoundingClientRect;
  const getAttr = Element.prototype.getAttribute;
  const setAttr = Element.prototype.setAttribute;
  const hasAttr = Element.prototype.hasAttribute;
  const closest = Element.prototype.closest;
  const contains = Node.prototype.contains;
  const qsa = Element.prototype.querySelectorAll;
  const docQsa = Document.prototype.querySelectorAll;
  const getById = Document.prototype.getElementById;
  const computed = W.getComputedStyle.bind(W);
  const fromPoint = Document.prototype.elementFromPoint;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const focusEl = HTMLElement.prototype.focus;
  const scrollIntoView = Element.prototype.scrollIntoView;
  const checkVisibility = Element.prototype.checkVisibility;
  const inputValue = O.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const areaValue = O.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  const execCommand = Document.prototype.execCommand;
  const requestSubmit = HTMLFormElement.prototype.requestSubmit;
  const now = () => Date.now();
  const MouseEv = W.MouseEvent;
  const PointerEv = W.PointerEvent || W.MouseEvent;
  const KeyboardEv = W.KeyboardEvent;
  const InputEv = W.InputEvent || W.Event;
  const Ev = W.Event;

  const DOC = Math.random().toString(36).slice(2, 6);

  // --- Limits (the backend caps the result again) -------------------------
  const MAX_NODES = 1500;
  const MAX_TEXT = 160;
  const MAX_VALUE = 120;
  const MAX_CHARS = 60000;
  const MAX_DEPTH = 60;
  const CONSOLE_CAP = 300;
  const CONSOLE_TEXT = 1000;

  // --- Console capture ----------------------------------------------------
  const logs = [];
  let seq = 0;
  let dropped = 0;
  function record(level, args) {
    let text = "";
    try {
      text = Array.prototype.map
        .call(args, (a) => {
          if (typeof a === "string") return a;
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          try {
            return JSONs(a);
          } catch (_) {
            return String(a);
          }
        })
        .join(" ");
    } catch (_) {
      text = "(unprintable)";
    }
    if (text.length > CONSOLE_TEXT) text = `${text.slice(0, CONSOLE_TEXT)}…`;
    logs.push({ seq: ++seq, level, text, at: now() });
    if (logs.length > CONSOLE_CAP) {
      logs.shift();
      dropped += 1;
    }
  }
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = W.console && W.console[level];
    if (typeof original !== "function") continue;
    W.console[level] = function (...args) {
      record(level === "log" ? "info" : level, args);
      return original.apply(this, args);
    };
  }
  W.addEventListener(
    "error",
    (e) => {
      if (e && e.message) record("error", [`${e.message} (${e.filename || "?"}:${e.lineno || 0})`]);
    },
    true,
  );
  // The app's own runtime is injected into every webview it creates, this one
  // included, and its calls are refused here by design (a browser page has no
  // access to the app). Those refusals are the app's, not the page's: they are
  // left out, so an agent reading the console sees only what the page did.
  const APP_REFUSAL = /not allowed on window "[^"]*", webview "browser-\d+"/;
  W.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    const text = r instanceof Error ? `${r.name}: ${r.message}` : String(r);
    if (APP_REFUSAL.test(text)) return;
    record("error", [`Unhandled rejection: ${text}`]);
  });

  // --- References -----------------------------------------------------------
  const refOf = new WeakMap();
  const byRef = new Map();
  let nextRef = 0;
  function refFor(el) {
    let r = refOf.get(el);
    if (!r) {
      r = `${DOC}:e${++nextRef}`;
      refOf.set(el, r);
    }
    byRef.set(r, new WeakRef(el));
    return r;
  }
  function resolve(ref) {
    if (typeof ref !== "string" || !ref.startsWith(`${DOC}:`)) {
      return { error: "stale", message: "this reference belongs to another page or an earlier load — take a new snapshot" };
    }
    const el = byRef.get(ref)?.deref();
    if (!el) return { error: "stale", message: "no element has this reference — take a new snapshot" };
    if (!el.isConnected) return { error: "stale", message: "the element is no longer in the page — take a new snapshot" };
    return { el };
  }

  // --- Roles and names ------------------------------------------------------
  const collapse = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const attr = (el, name) => getAttr.call(el, name);
  const has = (el, name) => hasAttr.call(el, name);

  function inputRole(el) {
    const t = (attr(el, "type") || "text").toLowerCase();
    switch (t) {
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "range":
        return "slider";
      case "number":
        return "spinbutton";
      case "search":
        return "searchbox";
      case "button":
      case "submit":
      case "reset":
      case "image":
        return "button";
      case "hidden":
        return null;
      case "file":
        return "file";
      default:
        return "textbox";
    }
  }

  function roleOf(el) {
    const explicit = attr(el, "role");
    if (explicit) return explicit.split(/\s+/)[0].toLowerCase();
    const tag = el.localName;
    switch (tag) {
      case "a":
        return has(el, "href") ? "link" : null;
      case "button":
        return "button";
      case "input":
        return inputRole(el);
      case "select":
        return el.multiple ? "listbox" : "combobox";
      case "textarea":
        return "textbox";
      case "option":
        return "option";
      case "img":
        return "img";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading";
      case "nav":
        return "navigation";
      case "main":
        return "main";
      case "form":
        return "form";
      case "dialog":
        return "dialog";
      case "ul":
      case "ol":
        return "list";
      case "li":
        return "listitem";
      case "table":
        return "table";
      case "tr":
        return "row";
      case "td":
        return "cell";
      case "th":
        return "columnheader";
      case "summary":
        return "button";
      case "details":
        return "group";
      case "label":
        return "label";
      case "iframe":
        return "iframe";
      default:
        return el.isContentEditable && !el.parentElement?.isContentEditable ? "textbox" : null;
    }
  }

  const INTERACTIVE = new Set([
    "link", "button", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox",
    "slider", "spinbutton", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
    "option", "treeitem", "file",
  ]);

  function isInteractive(el, role) {
    if (role && INTERACTIVE.has(role)) return true;
    const tabindex = attr(el, "tabindex");
    if (tabindex !== null && Number(tabindex) >= 0 && role !== "dialog") return true;
    return has(el, "onclick");
  }

  function textOf(el) {
    return collapse(el.innerText ?? el.textContent);
  }

  function labelledBy(el) {
    const ids = attr(el, "aria-labelledby");
    if (!ids) return "";
    return collapse(
      ids
        .split(/\s+/)
        .map((id) => {
          const target = getById.call(D, id);
          return target ? textOf(target) : "";
        })
        .join(" "),
    );
  }

  function labelFor(el) {
    if (el.labels && el.labels.length) return collapse(Array.from(el.labels, (l) => textOf(l)).join(" "));
    return "";
  }

  function nameOf(el, role) {
    const aria = attr(el, "aria-label");
    if (aria) return collapse(aria);
    const lb = labelledBy(el);
    if (lb) return lb;
    const tag = el.localName;
    if (tag === "img" || (tag === "input" && (attr(el, "type") || "").toLowerCase() === "image")) {
      return collapse(attr(el, "alt") || attr(el, "title") || "");
    }
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const t = (attr(el, "type") || "").toLowerCase();
      if (t === "submit" || t === "button" || t === "reset") return collapse(el.value || attr(el, "value") || t);
      return labelFor(el) || collapse(attr(el, "placeholder") || attr(el, "title") || attr(el, "name") || "");
    }
    if (role === "iframe") return collapse(attr(el, "title") || attr(el, "name") || "");
    if (role && role !== "form" && role !== "list" && role !== "table" && role !== "group" && role !== "main" && role !== "navigation") {
      const own = textOf(el);
      if (own) return own;
    }
    return collapse(attr(el, "title") || "");
  }

  // --- Visibility -----------------------------------------------------------
  function visible(el) {
    if (checkVisibility) {
      try {
        if (!checkVisibility.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
      } catch (_) {
        // fall through to the style test
      }
    } else {
      const s = computed(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    }
    if (attr(el, "aria-hidden") === "true") return false;
    const r = gbcr.call(el);
    return r.width > 0 || r.height > 0 || el.localName === "option";
  }

  // --- State ----------------------------------------------------------------
  function stateOf(el, role) {
    const out = [];
    if (el.disabled || attr(el, "aria-disabled") === "true") out.push("disabled");
    if (role === "checkbox" || role === "radio" || role === "switch" || role === "menuitemcheckbox") {
      const c = el.checked ?? attr(el, "aria-checked") === "true";
      out.push(c ? "checked" : "unchecked");
    }
    const exp = attr(el, "aria-expanded");
    if (exp !== null) out.push(exp === "true" ? "expanded" : "collapsed");
    if (el.localName === "summary" && el.parentElement?.localName === "details") {
      out.push(el.parentElement.open ? "expanded" : "collapsed");
    }
    if (attr(el, "aria-selected") === "true" || (el.localName === "option" && el.selected)) out.push("selected");
    if (el.required || attr(el, "aria-required") === "true") out.push("required");
    if (el.readOnly) out.push("readonly");
    if (el.localName === "input" && (attr(el, "type") || "").toLowerCase() === "password") {
      out.push(el.value ? "password, filled" : "password");
    }
    if (role === "heading") {
      const level = attr(el, "aria-level") || el.localName.slice(1);
      out.push(`level=${level}`);
    }
    return out;
  }

  function valueOf(el, role) {
    const tag = el.localName;
    if (tag === "input") {
      const t = (attr(el, "type") || "text").toLowerCase();
      if (t === "password" || t === "file" || t === "hidden") return null;
      if (role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "slider") {
        return clip(String(el.value ?? ""), MAX_VALUE);
      }
      return null;
    }
    if (tag === "textarea") return clip(String(el.value ?? ""), MAX_VALUE);
    if (tag === "select") {
      const chosen = Array.from(el.selectedOptions || [], (o) => collapse(o.label || o.text));
      return clip(chosen.join(", "), MAX_VALUE);
    }
    if (el.isContentEditable) return clip(textOf(el), MAX_VALUE);
    return null;
  }

  // --- Snapshot ---------------------------------------------------------------
  const CONTAINERS = new Set(["form", "list", "dialog", "navigation", "main", "table", "group", "row"]);
  const SKIP = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "svg", "canvas"]);

  function snapshot() {
    const lines = [];
    let chars = 0;
    let nodes = 0;
    let truncated = false;
    let interactive = 0;

    function emit(depth, text) {
      if (truncated) return false;
      if (nodes >= MAX_NODES || chars + text.length > MAX_CHARS) {
        truncated = true;
        return false;
      }
      const line = `${"  ".repeat(Math.min(depth, 20))}- ${text}`;
      lines.push(line);
      chars += line.length + 1;
      nodes += 1;
      return true;
    }

    function quote(s) {
      return JSONs(clip(s, MAX_TEXT));
    }

    function describeText(node, depth) {
      const t = collapse(node.nodeValue);
      if (t) emit(depth, `text ${quote(t)}`);
    }

    function walk(root, depth) {
      if (truncated || depth > MAX_DEPTH) return;
      for (let child = root.firstChild; child; child = child.nextSibling) {
        if (truncated) return;
        if (child.nodeType === 3) {
          describeText(child, depth);
          continue;
        }
        if (child.nodeType !== 1) continue;
        visit(child, depth);
      }
    }

    function visit(el, depth) {
      const tag = el.localName;
      if (SKIP.has(tag)) return;
      const shown = visible(el);
      if (!shown) {
        // `display: contents` and zero-size wrappers can still hold visible
        // children; descend unless the element hides its whole subtree.
        const s = computed(el);
        if (s.display === "none" || s.visibility === "hidden" || attr(el, "aria-hidden") === "true") return;
      }
      const role = roleOf(el);
      if (role === "iframe") {
        let same = false;
        try {
          same = !!el.contentDocument;
        } catch (_) {
          same = false;
        }
        const name = nameOf(el, role);
        emit(depth, `iframe${name ? ` ${quote(name)}` : ""}${same ? "" : " (cross-origin, not inspected)"}`);
        if (same && el.contentDocument.body) walk(el.contentDocument.body, depth + 1);
        return;
      }
      if (role === "label") {
        const control = el.control;
        if (control && !visible(control) && shown) {
          // A styled control hides its real input and shows its label: the
          // label is what can be clicked, so it stands in for the control.
          const controlRole = roleOf(control) || "control";
          const parts = [controlRole, quote(textOf(el)), `[ref=${refFor(el)}]`];
          const state = stateOf(control, controlRole);
          if (state.length) parts.push(`[${state.join(", ")}]`);
          emit(depth, parts.join(" "));
          interactive += 1;
          return;
        }
        // A label names its control; its text is emitted once, there. A label
        // around its control contributes only the elements inside it.
        if (!control) walk(el, depth);
        else if (contains.call(el, control)) {
          for (let child = el.firstElementChild; child; child = child.nextElementSibling) visit(child, depth);
        }
        return;
      }
      const inter = isInteractive(el, role);
      if (inter && !shown) return;
      if (inter || role === "heading" || role === "img") {
        const name = nameOf(el, role);
        if (role === "img" && !name && !inter) return;
        const parts = [role || tag];
        if (name) parts.push(quote(name));
        if (inter) {
          parts.push(`[ref=${refFor(el)}]`);
          interactive += 1;
        }
        const state = stateOf(el, role);
        if (state.length) parts.push(`[${state.join(", ")}]`);
        const value = valueOf(el, role);
        if (value !== null) parts.push(`value=${quote(value)}`);
        if (role === "link") {
          const href = attr(el, "href");
          if (href && !href.startsWith("javascript:")) parts.push(`-> ${clip(href, 120)}`);
        }
        emit(depth, parts.join(" "));
        // Descend into what an interactive element contains only for more
        // interactive elements (a button inside a card link); its text is
        // already its name.
        if (inter || role === "heading") {
          for (const inner of qsa.call(el, "a[href],button,input,select,textarea,[role],[tabindex],[contenteditable]")) {
            if (inner !== el && !closest.call(inner.parentElement || inner, "svg")) {
              const innerRole = roleOf(inner);
              if (isInteractive(inner, innerRole) && visible(inner) && !refOf.has(inner)) visit(inner, depth + 1);
            }
          }
          return;
        }
        return;
      }
      if (role && CONTAINERS.has(role)) {
        const name = role === "form" || role === "dialog" || role === "navigation" ? nameOf(el, role) : "";
        emit(depth, `${role}${name ? ` ${quote(name)}` : ""}`);
        walk(el, depth + 1);
      } else if (role === "listitem" || role === "cell" || role === "columnheader") {
        const own = collapse(el.innerText ?? "");
        const hasControls = qsa.call(el, "a[href],button,input,select,textarea,[role],[tabindex]").length > 0;
        if (!hasControls && own) {
          emit(depth, `${role} ${quote(own)}`);
        } else {
          emit(depth, role);
          walk(el, depth + 1);
        }
      } else {
        walk(el, depth);
      }
      if (el.shadowRoot) walk(el.shadowRoot, depth);
    }

    walk(D.body || D.documentElement, 0);
    const errors = logs.filter((l) => l.level === "error").length;
    return {
      doc: DOC,
      url: String(W.location.href),
      title: String(D.title || ""),
      viewport: {
        width: W.innerWidth,
        height: W.innerHeight,
        scrollX: Math.round(W.scrollX),
        scrollY: Math.round(W.scrollY),
        scrollHeight: D.documentElement ? D.documentElement.scrollHeight : 0,
      },
      outline: lines.join("\n"),
      nodes,
      interactive,
      truncated,
      consoleErrors: errors,
    };
  }

  // --- What an element is (for the risk decision and the approval) --------
  function describe(ref) {
    const r = resolve(ref);
    if (r.error) return r;
    const el = r.el;
    const role = roleOf(el) || el.localName;
    const tag = el.localName;
    const type = (attr(el, "type") || "").toLowerCase();
    const form = el.form || closest.call(el, "form");
    const isSubmit =
      (tag === "button" && (type === "submit" || (!type && !!form))) ||
      (tag === "input" && (type === "submit" || type === "image"));
    const rect = gbcr.call(el);
    return {
      ref,
      tag,
      role,
      type,
      name: clip(nameOf(el, role), MAX_TEXT),
      href: tag === "a" ? clip(String(el.href || ""), 300) : "",
      inForm: !!form,
      formAction: form ? clip(String(form.action || ""), 300) : "",
      isSubmit,
      editable: tag === "textarea" || tag === "select" || (tag === "input" && !["checkbox", "radio", "button", "submit", "reset", "image", "range", "color", "hidden"].includes(type)) || el.isContentEditable,
      disabled: !!el.disabled || attr(el, "aria-disabled") === "true",
      visible: visible(el),
      box: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  }

  // --- Actions ----------------------------------------------------------------
  function describeHit(hit) {
    if (!hit) return "nothing";
    const id = hit.id ? `#${hit.id}` : "";
    const cls = typeof hit.className === "string" && hit.className.trim() ? `.${hit.className.trim().split(/\s+/)[0]}` : "";
    return `${hit.localName}${id}${cls}`;
  }

  function ready(ref) {
    const r = resolve(ref);
    if (r.error) return r;
    const el = r.el;
    if (!visible(el)) return { error: "hidden", message: "the element is not visible" };
    if (el.disabled || attr(el, "aria-disabled") === "true") return { error: "disabled", message: "the element is disabled" };
    try {
      scrollIntoView.call(el, { block: "center", inline: "center", behavior: "instant" });
    } catch (_) {
      scrollIntoView.call(el);
    }
    const rect = gbcr.call(el);
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return { el, x, y };
  }

  /** Whatever is on top at the element's centre must be the element (or
   *  inside it): anything else is an overlay the click would really land on. */
  function unobscured(el, x, y) {
    let hit = fromPoint.call(D, x, y);
    while (hit && hit.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    if (!hit) return { error: "obscured", message: "the element is outside the viewport" };
    if (hit === el || contains.call(el, hit)) return null;
    // A label's click lands on its control; that is the same target.
    if (el.labels && Array.prototype.some.call(el.labels, (l) => l === hit || contains.call(l, hit))) return null;
    return { error: "obscured", message: `the element is covered by ${describeHit(hit)}` };
  }

  function mouse(el, type, x, y, Ctor) {
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: type.endsWith("down") ? 1 : 0, detail: 1, view: W };
    if (Ctor === PointerEv) Object.assign(init, { pointerId: 1, pointerType: "mouse", isPrimary: true });
    return dispatch.call(el, new Ctor(type, init));
  }

  function click(ref) {
    const r = ready(ref);
    if (r.error) return r;
    const { el, x, y } = r;
    const blocked = unobscured(el, x, y);
    if (blocked) return blocked;
    mouse(el, "pointerover", x, y, PointerEv);
    mouse(el, "pointerdown", x, y, PointerEv);
    mouse(el, "mousedown", x, y, MouseEv);
    try {
      focusEl.call(el, { preventScroll: true });
    } catch (_) {
      // not focusable
    }
    mouse(el, "pointerup", x, y, PointerEv);
    mouse(el, "mouseup", x, y, MouseEv);
    // A link to a new window: the engine's popup blocker drops it for a
    // synthetic click, and this browser has no windows anyway — so for the
    // click the link targets this page, as a person's click effectively does.
    // The page's own click handlers still run and may still cancel it.
    const link = closest.call(el, "a[href]");
    const original = link ? attr(link, "target") : null;
    const target = (original || "").toLowerCase();
    const retarget = !!target && target !== "_self" && target !== "_top" && target !== "_parent";
    if (retarget) setAttr.call(link, "target", "_self");
    const proceed = mouse(el, "click", x, y, MouseEv);
    if (retarget) setAttr.call(link, "target", original);
    if (retarget && proceed) return { ok: true, effect: "opened here" };
    return { ok: true };
  }

  function setNative(el, value) {
    const desc = el.localName === "textarea" ? areaValue : inputValue;
    desc.set.call(el, value);
  }

  function typeInto(ref, text, clear) {
    const r = ready(ref);
    if (r.error) return r;
    const el = r.el;
    const tag = el.localName;
    const type = (attr(el, "type") || "").toLowerCase();
    if (tag === "input" && (type === "password" || type === "file" || type === "hidden")) {
      return { error: "refused", message: `an agent never types into a ${type} field` };
    }
    try {
      focusEl.call(el, { preventScroll: true });
    } catch (_) {
      // not focusable
    }
    if (tag === "select") {
      const want = String(text).trim().toLowerCase();
      const option = Array.from(el.options).find(
        (o) => o.value.toLowerCase() === want || collapse(o.label || o.text).toLowerCase() === want,
      );
      if (!option) return { error: "no-option", message: "no option has that value or label" };
      el.value = option.value;
      dispatch.call(el, new Ev("input", { bubbles: true, composed: true }));
      dispatch.call(el, new Ev("change", { bubbles: true }));
      return { ok: true, chosen: collapse(option.label || option.text) };
    }
    if (tag === "input" || tag === "textarea") {
      if (el.readOnly) return { error: "readonly", message: "the field is read-only" };
      const next = clear ? String(text) : `${el.value}${text}`;
      setNative(el, next);
      dispatch.call(el, new InputEv("input", { bubbles: true, composed: true, inputType: "insertText", data: String(text) }));
      dispatch.call(el, new Ev("change", { bubbles: true }));
      return { ok: true };
    }
    if (el.isContentEditable) {
      if (clear) execCommand.call(D, "selectAll", false);
      const done = execCommand.call(D, "insertText", false, String(text));
      return done ? { ok: true } : { error: "not-editable", message: "the element refused the text" };
    }
    return { error: "not-editable", message: "the element does not take text" };
  }

  function tabbables() {
    return Array.prototype.filter.call(
      docQsa.call(D, "a[href],button,input,select,textarea,[tabindex],[contenteditable]"),
      (el) => !el.disabled && Number(attr(el, "tabindex") ?? 0) >= 0 && visible(el),
    );
  }

  const KEYS = {
    Enter: "Enter", Tab: "Tab", Escape: "Escape", Backspace: "Backspace", Delete: "Delete",
    ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Space: " ",
  };

  function press(key, shift) {
    const k = KEYS[key];
    if (!k) return { error: "key", message: "that key is not in the allowed list" };
    const target = D.activeElement || D.body;
    const init = { key: k, code: key === "Space" ? "Space" : key, bubbles: true, cancelable: true, composed: true, shiftKey: !!shift };
    const proceed = dispatch.call(target, new KeyboardEv("keydown", init));
    let effect = "none";
    if (proceed) {
      if (key === "Tab") {
        const list = tabbables();
        const at = list.indexOf(target);
        const next = list[(at + (shift ? -1 : 1) + list.length) % list.length];
        if (next) {
          focusEl.call(next);
          effect = "focus";
        }
      } else if (key === "Enter" && target.localName === "input" && target.form) {
        requestSubmit.call(target.form);
        effect = "submit";
      } else if ((key === "Enter" || key === "Space") && (target.localName === "button" || roleOf(target) === "button" || roleOf(target) === "link")) {
        const rect = gbcr.call(target);
        mouse(target, "click", rect.left + rect.width / 2, rect.top + rect.height / 2, MouseEv);
        effect = "click";
      }
    }
    dispatch.call(target, new KeyboardEv("keyup", init));
    return { ok: true, effect };
  }

  /** What pressing `key` now would do (for the risk decision). */
  function pressIntent(key) {
    const target = D.activeElement || D.body;
    const submits = key === "Enter" && target.localName === "input" && !!target.form;
    const activates = (key === "Enter" || key === "Space") && (target.localName === "button" || roleOf(target) === "button" || roleOf(target) === "link");
    return { submits, activates, target: refOf.get(target) || null };
  }

  function scroll(ref, dx, dy) {
    let target = null;
    if (ref) {
      const r = resolve(ref);
      if (r.error) return r;
      target = r.el;
    }
    const w = target ? target.clientWidth : W.innerWidth;
    const h = target ? target.clientHeight : W.innerHeight;
    const by = { left: Math.round(dx * w), top: Math.round(dy * h), behavior: "instant" };
    if (target) target.scrollBy(by);
    else W.scrollBy(by);
    return { ok: true, scrollX: Math.round(W.scrollX), scrollY: Math.round(W.scrollY) };
  }

  // --- Highlight (so the person sees what an agent is asking about) --------
  let marker = null;
  let markerTimer = 0;
  function highlight(ref, ms) {
    const r = resolve(ref);
    if (r.error) return r;
    const rect = gbcr.call(r.el);
    if (!marker) {
      marker = D.createElement("div");
      const shadow = marker.attachShadow({ mode: "closed" });
      const box = D.createElement("div");
      box.style.cssText =
        "position:fixed;pointer-events:none;box-sizing:border-box;border:2px solid #f59e0b;border-radius:4px;box-shadow:0 0 0 4px rgba(245,158,11,.25);z-index:2147483647;transition:all .12s";
      shadow.appendChild(box);
      marker._box = box;
    }
    const box = marker._box;
    box.style.left = `${rect.left - 3}px`;
    box.style.top = `${rect.top - 3}px`;
    box.style.width = `${rect.width + 6}px`;
    box.style.height = `${rect.height + 6}px`;
    (D.body || D.documentElement).appendChild(marker);
    clearTimeout(markerTimer);
    markerTimer = setTimeout(() => marker && marker.remove(), Math.max(200, Math.min(ms || 1500, 120000)));
    return { ok: true };
  }
  function unhighlight() {
    clearTimeout(markerTimer);
    if (marker) marker.remove();
    return { ok: true };
  }

  // --- Waiting for text -------------------------------------------------------
  function hasText(text) {
    const body = D.body;
    if (!body) return { found: false };
    return { found: collapse(body.innerText).toLowerCase().includes(collapse(text).toLowerCase()) };
  }

  // --- The one entry point ------------------------------------------------------
  function call(request) {
    try {
      const q = request || {};
      switch (q.op) {
        case "snapshot":
          return snapshot();
        case "describe":
          return describe(q.ref);
        case "click":
          return click(q.ref);
        case "type":
          return typeInto(q.ref, q.text ?? "", !!q.clear);
        case "press":
          return press(q.key, q.shift);
        case "pressIntent":
          return pressIntent(q.key);
        case "scroll":
          return scroll(q.ref, Number(q.dx) || 0, Number(q.dy) || 0);
        case "highlight":
          return highlight(q.ref, q.ms);
        case "unhighlight":
          return unhighlight();
        case "hasText":
          return hasText(q.text ?? "");
        case "console": {
          const since = Number(q.since) || 0;
          return { entries: logs.filter((l) => l.seq > since), dropped, last: seq };
        }
        case "doc":
          return { doc: DOC };
        default:
          return { error: "op", message: "unknown operation" };
      }
    } catch (e) {
      return { error: "page", message: String((e && e.message) || e) };
    }
  }

  O.defineProperty(W, KEY, {
    value: O.freeze({ call: (request) => JSONs(call(request)) }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();
