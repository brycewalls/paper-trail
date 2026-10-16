// ui/menu.js: the glass pull-down menu (SwiftUI Menu with no primaryAction: a tap opens it). The
// Scan menu (spec 3.11, #79) is one of these; so are filter and row menus. Owner: deck (shared UI).
//
//   bindMenu(button, () => [
//     { label: "Scan document", symbol: "doc.viewfinder", action: () => ... },
//     { label: "Import from Files", symbol: "folder", action: () => ... },
//     { label: "Forget", symbol: "trash", destructive: true, action: () => ... },
//   ]);
//   openMenu(anchorEl, items, { align: "end" })  -> close()
//
// Keyboard: Enter, Space or ArrowDown on the button opens it; arrows move, Enter picks, Escape or
// Tab closes and returns focus to the button.
import { esc } from "../ui.js";
import { icon } from "./icons.js";

let current = null;

export function openMenu(anchor, items, { align = "end" } = {}) {
  closeMenu();
  const layer = document.getElementById("overlay") || document.body;
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = items.map((it, i) => it.divider ? '<div class="menu-divider" role="separator"></div>'
    : `<button type="button" role="menuitem" class="menu-item${it.destructive ? " destructive" : ""}" data-i="${i}"${it.disabled ? " disabled" : ""}>`
      + `<span>${esc(it.label)}</span>${it.symbol ? icon(it.symbol) : ""}</button>`).join("");
  layer.append(menu);

  // Position under the anchor, inside the layer, flipping above when there's no room below.
  const lr = layer === document.body ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : layer.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = align === "end" ? ar.right - lr.left - mw : ar.left - lr.left;
  left = Math.max(8, Math.min(left, lr.width - mw - 8));
  let top = ar.bottom - lr.top + 8;
  if (top + mh > lr.height - 8) top = Math.max(8, ar.top - lr.top - mh - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top + (layer === document.body ? scrollY : 0)}px`;
  menu.style.transformOrigin = `${align === "end" ? "right" : "left"} ${top < ar.top - lr.top ? "bottom" : "top"}`;
  anchor.setAttribute("aria-expanded", "true");

  const buttons = () => [...menu.querySelectorAll(".menu-item:not([disabled])")];
  const close = (refocus = true) => {
    if (!menu.isConnected) return;
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (refocus) anchor.focus({ preventScroll: true });
    if (current && current.menu === menu) current = null;
  };
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(false); };
  document.addEventListener("pointerdown", outside, true);
  menu.addEventListener("click", (e) => {
    const b = e.target.closest(".menu-item");
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    close();
    it.action && it.action();
  });
  menu.addEventListener("keydown", (e) => {
    const list = buttons(); const i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") close(false);
  });
  buttons()[0]?.focus({ preventScroll: true });
  current = { menu, close };
  return close;
}

export function closeMenu() { if (current) current.close(false); }

export function bindMenu(button, itemsFn, opts) {
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (e) => {
    e.preventDefault();
    if (button.getAttribute("aria-expanded") === "true") { closeMenu(); return; }
    openMenu(button, itemsFn(), opts);
  });
  button.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); openMenu(button, itemsFn(), opts); } });
}
