# Component design system (web)

The values live in `app/globals.css` and `tailwind.config.ts`; the primitives in
`components/ui/` apply them. This page is the rule for anything built outside a
primitive. Typography and spacing are in `typography-spacing.md`.

## Colour

| Token | Value | Use |
|---|---|---|
| `background` / `card` | white | page and cards. Cards separate by hairline + `shadow-market`. |
| `sidebar` | slate 50 | the desktop rail only |
| `muted` / `accent` | slate 100 | quiet fills, hover |
| `foreground` | slate ink #0F1729 | text |
| `muted-foreground` | slate 600 | secondary text (subtext is colour, never size) |
| `primary` | violet #5D3FF3 | the one filled CTA per view |
| `iris` / `iris-ink` | violet marker / violet text | active markers, links |
| `trust` | emerald 700 | verified, settled, completed |
| `action` | amber | "your move" as a signal, never a button fill |
| `destructive` | red | danger, disputes |
| `obsidian` | slate 950 | the header bar |

`node scripts/palette-contrast.mjs` checks every pairing.

## Edges

Two borders, two jobs.

- `border-input`: every control (field, select, quiet button, chip, filter pill,
  toggle). Hover `border-input-hover`. Focus `border-ring` (fields) or the inset ring
  in `button.tsx` (buttons).
- `border-border`: containers only (cards, panels, dividers, tiles). No alpha
  variants (`border-border/70`): one hairline.

## Radius

| Class | px | Object |
|---|---|---|
| `rounded-sm` | 4 | inside a menu or list: items, row thumbnails |
| `rounded-md` | 6 | every control and label: button, icon button, input, select, textarea, chip, badge, tag, tooltip, label on a photo |
| `rounded-lg` | 8 | floating panels (popover, dropdown, select list), tiles and callouts nested in a card, a group of controls |
| `rounded-xl` | 12 | cards, panels, list containers, dialogs, sheets, media frames |
| `rounded-full` | — | marks only: avatar, dot, count, step number, icon disc, progress track, switch, slider |

A control is never a pill, and a card is never `rounded-lg` or `2xl`.

## Controls

| | Height | Notes |
|---|---|---|
| Button / Input / Select | `h-10 md:h-9` | `sm`: `h-9 md:h-8`; `xs`: `h-8 md:h-7` |
| Chip / filter pill | `h-9 md:h-11` (catalog), `h-7`–`h-9` elsewhere | unselected `border-input bg-card`, selected `border-foreground bg-foreground text-background` |
| Badge | 22.8px | tinted three-tone recipe in `badge.tsx` |

Filled buttons: `default` (violet) for the main action, `contrast` (ink) beside a
destructive one, `destructive` only inside a confirmation. Quiet: `outline`,
`secondary`, `ghost`.

## Icons

- Navigation, action, attribute, decoration: Hugeicons outline, `size-4`
  (`size-3.5` beside `text-meta`), `text-muted-foreground` unless inside a button.
- Icons that state a fact (verified, good, so-so, bad, warning, trusted): filled
  `StatusGlyph` (`components/ui/status-glyph.tsx`) in the state's colour.

## Elevation

- Cards: `shadow-market`. Hover-lift on whole-card links: `shadow-lift`.
- Floating panels: `shadow-md`. Dialogs: `shadow-lg`.
- Quiet buttons: a 1px drop; filled buttons: a 1px top highlight (`button.tsx`).
