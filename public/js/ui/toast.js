// ui/toast.js: a short glass capsule above the outbox bar for a passing fact ("Filed W-2 2023",
// "Sender rule saved") with an optional action ("Undo"). Announced politely to screen readers.
// Owner: deck (shared UI). Use sparingly: the spec moves most feedback into the accessory and the deck.
//   toast("Sender rule saved")
//   toast("3 cards back on the deck", { action: { label: "Undo", fn: undo }, ms: 5000 })
import { esc } from "../ui.js";

let timer = 0;
export function toast(text, { action, ms = 3500 } = {}) {
  const layer = document.getElementById("overlay") || document.body;
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    layer.append(el);
  }
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ""}`;
  if (action) el.querySelector(".toast-action").onclick = () => { hideToast(); action.fn(); };
  el.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(hideToast, ms);
}
export function hideToast() { document.getElementById("toast")?.classList.remove("show"); }
