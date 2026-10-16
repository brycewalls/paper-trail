// ui/motion.js: the springs and haptics, for code that animates with the Web Animations API (a card
// flying off with the gesture's velocity, the undo return). CSS transitions use the same springs as
// custom properties in css/tokens.css; this reads them from there, so there is one source and
// Reduce Motion (which swaps every spring for a 0.2 s ease-out in tokens.css) applies to both.
// Owner: deck (shared UI).
//   spring("flyoff")            -> { easing, duration }  for el.animate(frames, spring("flyoff"))
//   reduceMotion()              -> true while the system asks for less motion (live)
//   haptic("light"|"success"|"warning")  spec 2.6; a short vibration where the browser has one
//                                        (Android). iOS Safari has none, so it does nothing there.
const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
export const reduceMotion = () => mq.matches;

export const SPRINGS = ["snap", "flyoff", "promote", "undo", "pop", "smooth"];
export function spring(name) {
  const css = getComputedStyle(document.documentElement);
  const easing = css.getPropertyValue(`--spring-${name}`).trim() || "ease-out";
  const duration = parseFloat(css.getPropertyValue(`--spring-${name}-ms`)) || 200;
  return { easing, duration, fill: "forwards" };
}

const PATTERNS = { light: 8, success: [10, 60, 10], warning: [20, 80, 20] };
export function haptic(kind = "light") {
  try { if (navigator.vibrate) navigator.vibrate(PATTERNS[kind] || 8); } catch { /* not allowed before a gesture */ }
}
