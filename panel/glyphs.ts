// The panel's drawn glyphs: constant SVG strings, never built from bd's text, so they are safe as markup.
// Colour comes from CSS through currentColor and the classes the panel puts around them.

const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

/** A task's state: ring = can start, dashed = waits, half = moving, filled check = done. */
export const STATUS: Record<'open' | 'waiting' | 'doing' | 'deferred' | 'pinned' | 'done', string> = {
  open: svg('<circle cx="8" cy="8" r="6"/>'),
  waiting: svg('<circle cx="8" cy="8" r="6" stroke-dasharray="2.4 2.2"/>'),
  doing: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" stroke="none"/>'),
  deferred: svg('<circle cx="8" cy="8" r="6" stroke-dasharray="1 2.6"/>'),
  pinned: svg('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>'),
  done: svg('<circle cx="8" cy="8" r="6.75" fill="currentColor" stroke="none"/><path d="m5.4 8.2 1.8 1.8 3.5-3.7" stroke="var(--on-accent)" stroke-width="1.6"/>')
}

/** Priority as signal bars; P0 is the one that shouts. */
export const PRIORITY = [
  '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor"/><path d="M8 4.5v4.2M8 11v.5" stroke="var(--on-accent)" stroke-width="1.8" stroke-linecap="round"/></svg>',
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="9" width="3" height="5" rx="1"/><rect x="6.5" y="6" width="3" height="8" rx="1"/><rect x="11" y="2.5" width="3" height="11.5" rx="1"/></svg>',
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="9" width="3" height="5" rx="1"/><rect x="6.5" y="6" width="3" height="8" rx="1"/><rect x="11" y="2.5" width="3" height="11.5" rx="1" opacity=".28"/></svg>',
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="9" width="3" height="5" rx="1"/><rect x="6.5" y="6" width="3" height="8" rx="1" opacity=".28"/><rect x="11" y="2.5" width="3" height="11.5" rx="1" opacity=".28"/></svg>',
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" opacity=".55"><rect x="2" y="7.25" width="3" height="1.5" rx=".75"/><rect x="6.5" y="7.25" width="3" height="1.5" rx=".75"/><rect x="11" y="7.25" width="3" height="1.5" rx=".75"/></svg>'
]

export const ICON = {
  add: svg('<path d="M8 3v10M3 8h10"/>'),
  refresh: svg('<path d="M13.2 6.5A5.3 5.3 0 0 0 3.3 5M2.8 9.5a5.3 5.3 0 0 0 9.9 1.5"/><path d="M13.5 2.5v4h-4M2.5 13.5v-4h4"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  back: svg('<path d="m9.5 3.5-4.5 4.5 4.5 4.5"/>'),
  chevron: svg('<path d="m6 4 4 4-4 4"/>', 12),
  down: svg('<path d="m4 6 4 4 4-4"/>', 12),
  edit: svg('<path d="M10.5 3 13 5.5 6 12.5H3.5V10z"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>'),
  play: svg('<path d="M5 3.5v9l7-4.5z" fill="currentColor"/>'),
  agent: svg('<rect x="3" y="5.5" width="10" height="7.5" rx="2"/><path d="M8 5.5V3M6 9h.01M10 9h.01"/>'),
  copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5"/>'),
  epic: svg('<path d="m8 2.5 5.5 3L8 8.5l-5.5-3z"/><path d="m2.5 8.5 5.5 3 5.5-3"/><path d="m2.5 11 5.5 3 5.5-3" opacity=".5"/>'),
  bug: svg('<rect x="4.5" y="5" width="7" height="8.5" rx="3.5"/><path d="M8 5v8.5M4.5 8H2.5M13.5 8h-2M4.8 11.5l-2 1M11.2 11.5l2 1M6 5a2 2 0 0 1 4 0"/>'),
  feature: svg('<path d="M8 2.5a4 4 0 0 0-2.4 7.2c.5.4.9 1 .9 1.6v.2h3v-.2c0-.6.4-1.2.9-1.6A4 4 0 0 0 8 2.5zM6.5 13.5h3"/>'),
  chore: svg('<path d="M10.2 2.8a3 3 0 0 0-3.6 3.9L2.8 10.5a1.3 1.3 0 0 0 1.8 1.8l3.8-3.8a3 3 0 0 0 3.9-3.6l-1.8 1.8-1.6-.5-.5-1.6z"/>'),
  warning: svg('<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3v.2"/>'),
  folder: svg('<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>'),
  wrench: svg('<path d="M10.2 2.8a3 3 0 0 0-3.6 3.9L2.8 10.5a1.3 1.3 0 0 0 1.8 1.8l3.8-3.8a3 3 0 0 0 3.9-3.6l-1.8 1.8-1.6-.5-.5-1.6z"/>'),
  layers: svg('<path d="m8 2.5 5.5 3L8 8.5l-5.5-3z"/><path d="m2.5 8.5 5.5 3 5.5-3"/>'),
  pause: svg('<path d="M6 4v8M10 4v8"/>'),
  task: svg('<rect x="3" y="3" width="10" height="10" rx="2.5"/><path d="m5.8 8.1 1.6 1.6 2.9-3.2"/>'),
  more: svg('<circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/>'),
  open: svg('<path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5"/>'),
  link: svg('<path d="M7 9a3 3 0 0 0 4.2.2l2-2a3 3 0 0 0-4.2-4.2l-1 1"/><path d="M9 7a3 3 0 0 0-4.2-.2l-2 2a3 3 0 0 0 4.2 4.2l1-1"/>'),
  delete: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.3a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.3"/>'),
  calendar: svg('<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>'),
  // Lucide's brain (ISC licence), drawn on its 24-unit grid: scaled to the 12 px the other icons use, centred.
  brain: svg('<g transform="translate(0.8 0.8) scale(0.6)" stroke-width="2.2"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375M6.003 5.125A3 3 0 0 0 6.401 6.5M3.477 10.896a4 4 0 0 1 .585-.396M19.938 10.5a4 4 0 0 1 .585.396M6 18a4 4 0 0 1-1.967-.516M19.967 17.484A4 4 0 0 1 18 18"/></g>'),
  user: svg('<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13.5a4.5 4.5 0 0 1 9 0"/>')
}

/** The type mark in a task's second line; a plain task has none. */
export const TYPE_ICON: Record<string, string> = {
  bug: ICON.bug,
  feature: ICON.feature,
  chore: ICON.chore,
  epic: ICON.epic,
  decision: svg('<path d="M8 2.5v11M4 5h8M4 5l-1.8 4a2 2 0 0 0 3.6 0zM12 5l-1.8 4a2 2 0 0 0 3.6 0zM5.5 13.5h5"/>'),
  spike: svg('<path d="M9 2 4 9h4l-1 5 5-7H8z"/>'),
  story: svg('<path d="M4 2.5h6.5L12 4v9.5H4z"/><path d="M6 6h4M6 8.5h4M6 11h2.5"/>'),
  milestone: svg('<path d="M4 14V2.5M4 3h8l-1.8 2.75L12 8.5H4"/>')
}
