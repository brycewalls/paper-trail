// ui/icons.js: the app's symbols. The iPhone app uses SF Symbols only (spec 1.3); SF Symbols can't
// ship on the web, so these are line drawings of the same symbols, by the same names, on a 24 px
// grid with a 1.9 stroke. Every icon is decorative (aria-hidden); the button or row around it
// carries the label. Owner: deck (shared UI). Add a symbol here, never inline an SVG in a screen.
//   icon("checkmark")            -> an <svg> string, 1em square, currentColor
//   icon("tray", { size: 22 })   -> fixed pixel size
const P = {
  "checkmark": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  "xmark": '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  "arrow.uturn.backward": '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
  "arrow.up.forward": '<path d="M7 17L17 7M9 7h8v8"/>',
  "chevron.right": '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  "chevron.left": '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  "chevron.down": '<path d="M5.5 9.5L12 16l6.5-6.5"/>',
  "doc.viewfinder": '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5"/>',
  "folder": '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  "photo": '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 2.5-2 5 4"/>',
  "doc": '<path d="M7 3.5h6.5L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5z"/><path d="M13.5 3.5V8H18"/>',
  "rectangle.stack": '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M6.5 5h11M9 2.5h6"/>',
  "square.stack.3d.up": '<path d="M12 3.5l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16.5l8 4 8-4"/>',
  "leaf": '<path d="M5 19c0-8 5-13.5 15-14 0 9.5-5.5 14.5-13 14"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>',
  "magnifyingglass": '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  "tray": '<path d="M4 13.5l2.2-7.2A1.5 1.5 0 0 1 7.6 5.2h8.8a1.5 1.5 0 0 1 1.4 1.1l2.2 7.2V18a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18z"/><path d="M4 13.5h4.5l1 2h5l1-2H20"/>',
  "wifi.slash": '<path d="M3.5 3.5l17 17"/><path d="M8.5 15.5a5 5 0 0 1 4.6-1.4M5.3 12.3a9.5 9.5 0 0 1 3.4-2.1M2.5 9.2a13.5 13.5 0 0 1 3-2M11 5.6a13.5 13.5 0 0 1 10.5 3.6M15.6 10.8a9.5 9.5 0 0 1 3.1 1.5"/><circle cx="12" cy="18.6" r="0.9" fill="currentColor"/>',
  "exclamationmark.triangle.fill": '<path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.6 13.2a2 2 0 0 1-1.7 3H4.4a2 2 0 0 1-1.7-3z" fill="currentColor" stroke="none"/><path d="M12 9v4.5" stroke="var(--on-fill)"/><circle cx="12" cy="16.8" r="0.4" stroke="var(--on-fill)"/>',
  "exclamationmark.icloud.fill": '<path d="M7 19.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.3A3.9 3.9 0 0 1 17.5 19.5z" fill="currentColor" stroke="none"/><path d="M12 10v4" stroke="var(--on-fill)"/><circle cx="12" cy="16.8" r="0.4" stroke="var(--on-fill)"/>',
  "checkmark.circle.fill": '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="M7.8 12.3l2.8 2.8 5.6-5.8" stroke="var(--on-fill)"/>',
  "checkmark.circle": '<circle cx="12" cy="12" r="9"/><path d="M7.8 12.3l2.8 2.8 5.6-5.8"/>',
  "arrow.up.forward.circle": '<circle cx="12" cy="12" r="9"/><path d="M9 15l6-6M10 9h5v5"/>',
  "lock.fill": '<rect x="5.5" y="10.5" width="13" height="10" rx="2" fill="currentColor"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  "archivebox": '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 12.5h4"/>',
  "scissors": '<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.6 8.4L20 16.5M8.6 15.6L20 7.5"/>',
  "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  "person.crop.circle": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3.2"/><path d="M6.2 18.4a7 7 0 0 1 11.6 0"/>',
  "person.crop.rectangle.stack": '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M7 4h10"/><circle cx="12" cy="12" r="2.4"/><path d="M8 17.5a4.5 4.5 0 0 1 8 0"/>',
  "line.3.horizontal.decrease": '<path d="M4 7h16M7 12h10M10 17h4"/>',
  "ellipsis": '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  "square.and.arrow.up": '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M7 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-1"/>',
  "arrow.clockwise": '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V9h-4.5"/>',
  "faceid": '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9 15.5a4 4 0 0 0 6 0"/>',
  "gearshape": '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  "plus": '<path d="M12 5v14M5 12h14"/>',
  "pencil": '<path d="M15.5 5.5l3 3L9 18l-4 1 1-4z"/><path d="M13.5 7.5l3 3"/>',
  "circle": '<circle cx="12" cy="12" r="9"/>',
  "calendar": '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  "trash": '<path d="M4.5 7h15M10 4h4M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5"/>',
};

export const ICONS = Object.keys(P);

export function icon(name, { size } = {}) {
  const body = P[name];
  if (!body) throw new Error(`No icon named ${name}`);
  const dim = size ? `width="${size}" height="${size}"` : 'width="1em" height="1em"';
  return `<svg class="sym" ${dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
