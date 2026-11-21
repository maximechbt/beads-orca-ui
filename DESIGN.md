---
name: Beads for Orca
description: A Linear-grade issue list for beads tasks, living in Orca's right sidebar.
colors:
  accent-indigo: "#5e6ad2"
  accent-indigo-text: "#4c57c4"
  accent-indigo-dark: "#6e79d6"
  accent-indigo-text-dark: "#a3abf2"
  on-accent: "#ffffff"
  doing-amber: "#b07a00"
  doing-amber-dark: "#f2c94c"
  waiting-orange: "#c2410c"
  waiting-orange-dark: "#f2994a"
  urgent-orange: "#e5732e"
  urgent-orange-dark: "#f2994a"
  success-green: "#2e9e62"
  success-green-dark: "#4cc38a"
  danger-red: "#d93b3b"
  ground: "#ffffff"
  ink: "#18181b"
  muted-ink: "#6b6b74"
  hairline: "#e6e6ea"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.005em"
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.45
  code:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  md: "6px"
  lg: "8px"
  pill: "10px"
  full: "50%"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "14px"
components:
  button:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-primary:
    backgroundColor: "{colors.accent-indigo}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-ghost:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-sm:
    rounded: "{rounded.md}"
    padding: "0 7px"
    height: "24px"
    typography: "{typography.label}"
  icon-button:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.md}"
    size: "28px"
  input:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 9px"
    height: "30px"
  tab:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.md}"
    padding: "0 9px"
    height: "26px"
  chip:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "20px"
    typography: "{typography.caption}"
  task-row:
    textColor: "{colors.ink}"
    padding: "6px 12px"
    height: "32px"
    typography: "{typography.body}"
  group-header:
    textColor: "{colors.ink}"
    padding: "0 12px"
    height: "30px"
    typography: "{typography.section}"
  menu:
    rounded: "{rounded.lg}"
    padding: "4px"
  menu-item:
    rounded: "5px"
    padding: "0 8px"
    height: "30px"
  avatar:
    textColor: "{colors.on-accent}"
    rounded: "{rounded.full}"
    size: "20px"
---

# Design System: Beads for Orca

## Overview

**Creative North Star: "The Issue Tracker in the Margin"**

The category standard, played straight: a Linear-grade issue list folded into a 300 to 400 px sidebar. Orca owns the ground; the panel reads `--orca-background`, `--orca-foreground`, `--orca-muted-foreground`, `--orca-border`, `--orca-popover` and `--orca-destructive`, and follows the `dark` class on `<html>`. On top sits the category's own vocabulary: drawn status glyphs, priority signal bars, short tabular ids, initials avatars, and one indigo accent for selection, focus and done.

Density is the point. Every task is one 32 px line (priority, id, status, title, assignee), with a second line only when there is something to say (type mark, epic chip, what it waits on). Structure comes from hairlines and a faint band behind sticky group headers, never from cards or fills. Actions live in menus on the task's own properties, not in forms.

It refuses the form-like stack of collapsibles and grey list items of the 0.3 components panel.

**Key Characteristics:**
- Orca's theme variables underneath, one indigo accent on top.
- 13 px UI type, 32 px rows, tabular numerals for ids and counts.
- State is a drawn SVG glyph in colour, never a word in a pill.
- Flat, hairline-divided surfaces; shadow only on floating layers (menus, toasts).
- Keyboard-first: j/k, Enter, Esc, /, n, r.

## Colors

A neutral ground borrowed from the host, one cool indigo, and a small set of warm status signals that each mean exactly one thing.

### Primary
- **Linear Indigo** (accent-indigo; accent-indigo-dark in dark theme): selection tint on the cursor row, focus rings and field focus borders, the primary button, the filled done check, the pinned dot, checked markdown task boxes, the caret.
- **Indigo Ink** (accent-indigo-text; accent-indigo-text-dark): indigo used as text, where the base accent would fail contrast: links, the "launched" agent marker, the menu check, note icons.

### Secondary (status signals)
- **In-Progress Amber** (doing-amber / doing-amber-dark): the half-filled in-progress glyph and its group header. Nothing else.
- **Waiting Orange** (waiting-orange / waiting-orange-dark): the dashed blocked glyph.
- **Urgent Orange** (urgent-orange / urgent-orange-dark): the P0 square only.
- **Fresh Green** (success-green / success-green-dark): the footer freshness dot and success toast icon.
- **Danger Red** (danger-red, from `--orca-destructive`): bug type mark, destructive buttons, error toasts.

### Neutral
- **Host Ground** (ground, from `--orca-background`): the page and default button fill.
- **Host Ink** (ink, from `--orca-foreground`): titles and body.
- **Subtle Ink** (`color-mix(in srgb, fg 64%, bg)`, 62% in dark): ids, counts, meta lines, inactive tabs, icon buttons. Derived, not Orca's muted colour, so it tracks any host theme. `muted-ink` is only the fallback.
- **Hairline** (hairline, from `--orca-border`): every divider, field stroke and chip outline; row dividers use it at 60%.
- **Tints, all derived from ink by `color-mix`:** hover 4.5% (6% dark), press 8% (10%), band 2.5% (3.5%) behind group headers and sheets, field 3% (5%) inside inputs; selected is indigo at 11% (20%).

### Named Rules
**The Host Ground Rule.** Neutrals are never hard-coded; they come from `--orca-*` or a `color-mix` of them. The hex values in the frontmatter are fallbacks for a standalone render, not the source of truth.

**The One Meaning Rule.** Each signal colour marks one state. Amber is in progress, orange is waiting or urgent, indigo is selection, focus and done. A colour used for decoration dilutes the glyph language.

## Typography

**Body Font:** the platform UI face (-apple-system, BlinkMacSystemFont, then Inter, Segoe UI, system-ui)
**Mono Font:** ui-monospace (SF Mono, Menlo, Consolas)

**Character:** a single native UI face at small sizes, so the panel reads as part of Orca; hierarchy comes from weight (600 against 400) and from the subtle ink, not from size jumps.

### Hierarchy
- **Title** (600, 16px, 1.35, -0.005em, balanced wrap): the task title at the top of the detail view. The only size above 13 px.
- **Section** (600, 13px): sticky group headers, detail section headers, comment authors, epic titles.
- **Body** (400, 13px, 1.45): task titles in rows, property values, descriptions, menu items, buttons (500).
- **Label** (400, 12px, tabular figures): short ids, property names, breadcrumbs, meta lines, counts.
- **Caption** (500, 11px): keys in `kbd` only. The footer, chips, the composer foot and code blocks use the 12 px label size; avatar initials are 10 px, named by their `aria-label`.
- **Code** (12px mono, 1.5): fenced blocks and raw error output; inline code at 0.92em on the press tint.

### Named Rules
**The Tabular Rule.** Ids and counts set in tabular numerals; the id column is sized to the longest short id in `ch` (2 to 9) so titles align down the list.

**The Weight Not Size Rule.** Emphasis is 600 weight or full ink against subtle ink. No uppercase labels, no tracking, no size above 16 px.

## Layout

A single column filling a 300 to 400 px sidebar: a fixed header (brand and workspace, new; search with a `/` hint; segmented tabs with counts), a scrolling main view, and a 28 px footer (freshness dot or spinner, key hints). The list is grouped by status (In progress, To do, Blocked, Done) under sticky 30 px headers.

Rows are a five-column grid: 16 px priority, id at the measured `ch` width, 16 px status glyph, the flexible title, then the assignee avatar; column gap 8 px, padding 6px 12px, minimum 32 px. The meta line spans the title and avatar columns and drops chips first when space runs out.

The detail view has a sticky 40 px top bar with breadcrumbs and a two-column property grid (92 px names, flexible values). Every view insets 12 px from the panel's edges, so the header, the list, a task and the forms share one left edge. Spacing runs on 2, 4, 6, 8, 12, 16 px, with 16 px between the blocks of a task (properties, actions, description). At 300 px nothing reflows: titles and chips truncate with ellipses.

## Elevation & Depth

Flat by default. Surfaces separate with hairlines and the faint band tint; only floating layers lift.

### Shadow Vocabulary
- **Float, light** (`box-shadow: 0 10px 28px -10px rgba(20, 20, 40, 0.28), 0 0 0 1px var(--orca-border)`): menus and toasts.
- **Float, dark** (`box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--orca-border)`): the same layers in dark theme.
- **Focus halo** (`box-shadow: 0 0 0 3px color-mix(in srgb, #5e6ad2 18%, transparent)`): search, inputs and the comment composer while focused, with an indigo border.

### Named Rules
**The Only Floaters Rule.** A shadow means the thing floats above the list (menu, toast). Rows, sheets, sections and groups never take one.

## Shapes

Small, even radii: 6 px for every control (buttons, fields, tabs, property values, links), 8 px for containers that hold controls (menus, toasts, sheets, composer), 5 px for menu items inside an 8 px menu, 4 px for keys, inline code, checkboxes and focus outlines, 10 px pills for chips, circles for avatars, swatches and the freshness dot. Borders are 1 px hairlines; keys carry a 2 px bottom border. Glyphs are 16 px on a 16 px viewBox at 1.5 px round strokes.

## Components

### Buttons
- **Shape:** gently rounded (6px), 28 px tall, 10 px side padding, 500 weight, hairline stroke on the host ground.
- **Primary:** indigo fill, white text; hover mixes 12% black into the accent.
- **Ghost:** no stroke, subtle ink, full ink on hover. **Danger:** destructive text colour. **Small:** 24 px, 12 px type.
- **Icon button:** a 28 px square in subtle ink; hover takes the hover tint and full ink, press the press tint.
- **Hover / Focus:** hover tint; a 2 px indigo focus outline inset by 2 px. Disabled is 50% opacity.

### Chips
- **Style:** 20 px pill, hairline outline, caption type in subtle ink, a 7 px colour swatch for the epic (hue hashed from its id, `hsl(h 58% 52%)`). Truncates before anything else in the meta line.

### Inputs / Fields
- **Style:** 30 px, hairline stroke, field tint, 6px radius; labels above in 12 px 500 subtle ink. Textareas grow with content (64 to 320 px).
- **Focus:** indigo border, host ground fill, 3 px indigo halo at 18%.
- **Composer:** collapsed to one line at rest; expands to 72 px and shows its foot on focus or content.

### Navigation
- **Tabs:** segmented, 26 px, subtle ink with tabular counts; the selected tab takes full ink on the press tint. No underline, no indigo.
- **Breadcrumbs:** 12 px subtle crumbs, the current id in full ink 500.
- **Keyboard:** j/k or arrows move an indigo-tinted cursor row; Enter opens; Esc closes menus, clears search, then goes back; `/` focuses search; n creates; r refreshes.

### Task Row (signature)
Priority bars, short id, status glyph, title, avatar on one 32 px line; hover tint; the keyboard cursor takes the selected indigo tint. Closed rows dim the title to subtle ink. Second line only for type mark, epic chip, "waits on" and the launched-agent marker.

### Status and Priority Glyphs (signature)
- **Status:** ring = open, dashed ring = waiting, half-filled amber = in progress, dotted ring = deferred, ring with dot = pinned, filled indigo disc with a white check = done.
- **Priority:** three signal bars filling up from P3 to P1 (unfilled bars at 28%), three flat dashes at 55% for P4, a filled urgent-orange rounded square with a white exclamation for P0.

### Property Menus (signature)
Status, priority, assignee, type and epic in the detail view are 28 px property values that open a popover menu: 8 px radius, 4 px padding, float shadow, 30 px items with glyph, label and an indigo check on the current value; an optional filter input on top. Menus pop in 140 ms, toasts rise in 220 ms, both on `cubic-bezier(0.16, 1, 0.3, 1)` and only without reduced motion.

### Avatar
20 px circle with 600 initials in white on a hue hashed from the name (`hsl(h 42% 44%)`); unassigned is a dashed circle with a user glyph.

### Epic Progress
An epic header with a chevron, the epic glyph in its hue, a 600 title and a 3 px progress track (press tint) filled in the epic's hue.

## Do's and Don'ts

### Do:
- **Do** read every neutral from `--orca-*` or a `color-mix` of them, and switch on the `dark` class, never on a media query.
- **Do** draw state and priority with the SVG glyph set in `panel/glyphs.ts`, coloured through `currentColor`.
- **Do** keep rows at 32 px and 13 px type, ids and counts in tabular numerals.
- **Do** put actions in menus on the task's own properties before reaching for a form.
- **Do** keep indigo to selection, focus, primary action and done.

### Don't:
- **Don't** reintroduce the 0.3 panel's form-like stack of collapsibles and grey list items.
- **Don't** spell status as text badges or "P2" labels in the list; the glyphs carry it.
- **Don't** give rows, sections or sheets a shadow; shadow is for menus and toasts.
- **Don't** add a second accent hue or use signal colours decoratively.
- **Don't** use uppercase or tracked labels above sections.
