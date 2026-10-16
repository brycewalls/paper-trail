// ui/sheet.js: bottom sheets with medium and large detents, a grabber and drag to dismiss (the
// web's .sheet with .presentationDetents([.medium, .large])), and the action sheet that stands in
// for .confirmationDialog. Owner: deck (shared UI). Styles: css/components.css, "Sheets".
//
//   const s = openSheet({ title: "Check 2 fields", subtitle: "Everything else looks right.",
//                         body: htmlOrElement, footer: primaryButton("Confirm and file"),
//                         detents: ["medium", "large"], initial: "medium", label: "Check fields" });
//   Settings-style: openSheet({ title: "Settings", largeTitle: true, detents: ["large"],
//                               trailing: '<button class="nav-text-btn" data-done>Done</button>', body })
//   s.body      the scrolling content element, to wire events
//   s.setDetent("large"); s.close();  await s.closed  (resolves with the close reason:
//              "dismissed" for a drag, Escape or the scrim; whatever you pass to close(reason))
//
//   const choice = await actionSheet({ title: "Shred a Keep original?", message: "...",
//                         actions: [{ label: "Shred anyway", value: "shred", destructive: true }] });
//   // choice is the value, or null for Cancel
//
// Sheets mount in the shell's #overlay layer (inside the phone column), or <body> when there is none
// (the dev gallery). While one is open, everything else in the column is inert.
import { esc } from "../ui.js";
import { reduceMotion } from "./motion.js";

const host = () => document.getElementById("overlay") || document.body;
let stack = [];

function setInert(on) {
  const layer = host();
  const scope = layer.parentElement || document.body;
  for (const el of scope.children) {
    if (el === layer || el.tagName === "SCRIPT") continue;
    if (on) { if (!el.inert) { el.inert = true; el.dataset.sheetInert = "1"; } }
    else if (el.dataset.sheetInert) { el.inert = false; delete el.dataset.sheetInert; }
  }
}

export function openSheet({ title = "", subtitle = "", body = "", footer = "", detents = ["medium", "large"], initial, label, onClose, className = "", trailing = "", largeTitle = false } = {}) {
  const layer = host();
  const opener = document.activeElement;
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  const tid = `sheet-t-${Math.random().toString(36).slice(2, 8)}`;
  wrap.innerHTML = `<div class="sheet-scrim" data-sheet-scrim></div>
    <div class="sheet ${esc(className)}" role="dialog" aria-modal="true" ${title ? `aria-labelledby="${tid}"` : `aria-label="${esc(label || "Sheet")}"`} tabindex="-1">
      <div class="sheet-grab" data-sheet-grab><span class="grabber" aria-hidden="true"></span></div>
      ${trailing ? `<div class="sheet-toolbar">${trailing}</div>` : ""}
      ${title ? `<div class="sheet-head${largeTitle ? " large" : ""}"><h2 class="sheet-title" id="${tid}" tabindex="-1">${esc(title)}</h2>${subtitle ? `<p class="sheet-subtitle">${esc(subtitle)}</p>` : ""}</div>` : ""}
      <div class="sheet-body"></div>
      ${footer ? `<div class="sheet-footer">${footer}</div>` : ""}
    </div>`;
  const sheet = wrap.querySelector(".sheet");
  const scrim = wrap.querySelector(".sheet-scrim");
  const bodyEl = wrap.querySelector(".sheet-body");
  if (typeof body === "string") bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  layer.append(wrap);
  stack.push(wrap);
  setInert(true);

  let detent = initial || detents[0];
  let resolve;
  const closed = new Promise((r) => { resolve = r; });
  // Heights: large fills the layer less a top gap; medium is half of it (at least 320 px). The
  // sheet's height is the visible part, so a pinned footer always sits at the bottom of the screen;
  // below the medium height (dragging toward dismiss) it slides down instead of shrinking.
  const layerH = () => layer.getBoundingClientRect().height || innerHeight;
  const largeH = () => Math.max(320, layerH() - (parseFloat(getComputedStyle(layer).getPropertyValue("--sheet-top")) || 12));
  const mediumH = () => Math.min(largeH(), Math.max(320, Math.round(layerH() * 0.5)));
  const heightFor = (d) => (d === "large" ? largeH() : mediumH());
  const show = (visible) => {
    const minH = detents.includes("medium") ? mediumH() : largeH();
    if (visible >= minH) { sheet.style.height = `${visible}px`; sheet.style.transform = "translateY(0)"; }
    else { sheet.style.height = `${minH}px`; sheet.style.transform = `translateY(${minH - visible}px)`; }
  };
  const place = (d, animate = true) => {
    sheet.style.transition = animate ? "" : "none";
    show(heightFor(d));
    sheet.dataset.detent = d;
    scrim.style.opacity = d === "large" ? "1" : "0.7";
  };
  sheet.style.transition = "none";
  show(0);
  scrim.style.opacity = "0";
  void sheet.offsetHeight;                       // commit the start position, then animate to the detent
  place(detent);

  function close(reason = "dismissed") {
    if (!wrap.isConnected) return;
    sheet.style.transition = "";
    sheet.style.transform = `translateY(${sheet.getBoundingClientRect().height + 40}px)`;
    scrim.style.opacity = "0";
    const done = () => {
      wrap.remove();
      stack = stack.filter((w) => w !== wrap);
      if (!stack.length) setInert(false);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      onClose && onClose(reason);
      resolve(reason);
    };
    if (reduceMotion()) done(); else setTimeout(done, 260);
  }

  // Drag: from the grabber or header anywhere, or from the body when it's scrolled to the top.
  let drag = null;
  sheet.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const onGrab = e.target.closest("[data-sheet-grab], .sheet-head");
    const atTop = bodyEl.scrollTop <= 0 && e.target.closest(".sheet-body");
    if (!onGrab && !atTop) return;
    if (e.target.closest("input, textarea, select, button, a, label")) return;
    drag = { y: e.clientY, start: heightFor(detent), t: performance.now(), last: e.clientY, v: 0, moved: false, id: e.pointerId };
    // Follow the pointer on the document: an upward drag leaves the sheet before it grows under it.
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  });
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 6) return;
    if (!drag.moved) { drag.moved = true; sheet.style.transition = "none"; }
    const now = performance.now();
    drag.v = (e.clientY - drag.last) / Math.max(1, now - drag.t); drag.last = e.clientY; drag.t = now;
    let visible = drag.start - dy;
    if (visible > largeH()) visible = largeH() + (visible - largeH()) / 3;   // rubber band past large
    show(visible);
  };
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    if (!d.moved) return;
    const visible = d.start - (e.clientY - d.y);
    const floor = detents.includes("medium") ? mediumH() : largeH();
    // A flick down past 0.8 px/ms, or a release a quarter of the way below the lowest detent, closes.
    if (d.v > 0.8 || visible < floor * 0.75) { close("dismissed"); return; }
    if (d.v < -0.8 && detents.includes("large")) { detent = "large"; place(detent); return; }
    detent = detents.reduce((best, k) => (Math.abs(heightFor(k) - visible) < Math.abs(heightFor(best) - visible) ? k : best), detents[0]);
    place(detent);
  };
  scrim.addEventListener("click", () => close("dismissed"));
  // Escape closes the topmost sheet wherever focus is; Tab stays inside it.
  const onKey = (e) => {
    if (stack[stack.length - 1] !== wrap) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close("dismissed"); }
    else if (e.key === "Tab") trapFocus(e, sheet);
  };
  document.addEventListener("keydown", onKey, true);
  closed.then(() => document.removeEventListener("keydown", onKey, true));
  const onResize = () => place(detent, false);
  addEventListener("resize", onResize);
  closed.then(() => removeEventListener("resize", onResize));
  (sheet.querySelector(".sheet-title") || sheet).focus({ preventScroll: true });

  return { el: sheet, body: bodyEl, footer: sheet.querySelector(".sheet-footer"), close, closed, setDetent(d) { if (detents.includes(d)) { detent = d; place(d); } }, get detent() { return detent; } };
}

function trapFocus(e, root) {
  const f = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// .confirmationDialog: a title, a message, the actions, and Cancel in its own group. Resolves with
// the chosen action's value, or null.
export function actionSheet({ title = "", message = "", actions = [], cancel = "Cancel" } = {}) {
  const layer = host();
  const opener = document.activeElement;
  const wrap = document.createElement("div");
  wrap.className = "action-sheet-wrap";
  wrap.innerHTML = `<div class="sheet-scrim" style="opacity:1" data-cancel></div>
    <div class="action-sheet" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="as-group">
        ${title || message ? `<div class="as-head">${title ? `<p class="as-title">${esc(title)}</p>` : ""}${message ? `<p class="as-message">${esc(message)}</p>` : ""}</div>` : ""}
        ${actions.map((a, i) => `<button type="button" class="as-btn${a.destructive ? " destructive" : ""}" data-i="${i}">${esc(a.label)}</button>`).join("")}
      </div>
      <div class="as-group"><button type="button" class="as-btn cancel" data-cancel>${esc(cancel)}</button></div>
    </div>`;
  layer.append(wrap);
  stack.push(wrap);
  setInert(true);
  return new Promise((resolve) => {
    const done = (v) => {
      wrap.remove(); stack = stack.filter((w) => w !== wrap);
      if (!stack.length) setInert(false);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      resolve(v);
    };
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i], [data-cancel]");
      if (!b) return;
      done(b.hasAttribute("data-cancel") ? null : actions[Number(b.dataset.i)].value ?? actions[Number(b.dataset.i)].label);
    });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } if (e.key === "Tab") trapFocus(e, wrap); });
    setTimeout(() => wrap.querySelector(".as-btn")?.focus(), 30);
  });
}

export const sheetOpen = () => stack.length > 0;
