# Component design system (web)

The values live in `app/globals.css` and `tailwind.config.ts`; the primitives in
`components/ui/` apply them. This page is the rule for anything built outside a
primitive. Typography and spacing are in `typography-spacing.md`.

## Colour

| Token | Value | Use |
|---|---|---|
| `background` / `card` | white | page and cards. Cards separate by hairline + `shadow-market`. |
| `sidebar` | slate 50 | the desktop rail only |
| `muted` / `accent` | slate 100 | quiet fills, hover, the other person's chat bubbles |
| `foreground` | slate ink #0F1729 | text |
| `muted-foreground` | slate 600 | secondary text (subtext is colour, never size) |
| `primary` | ink, same as `foreground` | the one filled CTA per view |
| `iris` / `iris-ink` | violet marker / violet text | active markers, links, unread dots; **your own chat bubbles and the send button** (`iris-ink`, white type 7.7:1) |
| `trust` | emerald 700 | verified, settled, completed |
| `action` | amber | "your move" as a signal, never a button fill |
| `destructive` | red | danger, disputes |
| `obsidian` | slate 950 | overlays, letterboxing |

`node scripts/palette-contrast.mjs` checks every pairing.

## Edges

Two borders, two jobs.

- `border-input`: every control (field, select, quiet button, chip, filter pill,
  toggle). Hover `border-input-hover`. Focus `border-ring` (fields) or the inset ring
  in `button.tsx` (buttons).
- `border-border`: containers only (cards, panels, dividers, tiles). No alpha
  variants (`border-border/70`): one hairline.
- Status badges and tonal buttons have NO edge: the tint is the shape.

## Radius

| Class | px | Object |
|---|---|---|
| `rounded-sm` | 4 | inside a menu or list: items |
| `rounded-md` | 6 | every control and label: button, icon button, input, select, textarea, chip, badge, tag, tooltip, label on a photo |
| `rounded-lg` | 8 | floating panels (popover, dropdown, select list), tiles and callouts nested in a card, a group of controls, 40–48px row thumbnails |
| `rounded-xl` | 12 | cards, panels, list containers, dialogs, sheets, media frames, inset list rows (the inbox) |
| `rounded-full` | — | marks only: avatar, dot, count, step number, icon disc, progress track, switch, slider |

A control is never a pill, and a card is never `rounded-lg` or `2xl`, **except in a
conversation**, which has its own shape language because every chat client does:

| Object | Shape |
|---|---|
| Chat bubble | 20px (`MESSAGE_BUBBLE_RADIUS`), closing to 6px where two bubbles of one run touch |
| Composer | one capsule (`rounded-[1.375rem]`) holding attach, field and send |
| Contract milestone card | `rounded-2xl` (16px) |
| "New messages" chip | `rounded-full` |

## Controls

| | Height | Notes |
|---|---|---|
| Button / Input / Select | `h-10 md:h-9` | `sm`: `h-9 md:h-8`; `xs`: `h-8 md:h-7` |
| Chip / filter pill | `h-9 md:h-11` (catalog), `h-7`–`h-9` elsewhere | unselected `border-input bg-card`, selected `border-foreground bg-foreground text-background` |
| Badge | 20px | borderless tint (`badge.tsx`); a contract status adds a 6px `dot` |
| Composer controls | `size-10 md:size-9` round, inside the capsule | |

Filled buttons: `default` (ink) for the main action, `contrast` beside a destructive
one, `destructive` only inside a confirmation. Quiet: `outline` (edged, for forms and
dialogs), `secondary` (TONAL: an ink tint, no edge, for a quiet action in a bar beside
a title, e.g. the chat bar's "Open contract"), `ghost`.

## Avatars

`components/ui/avatar.tsx`. No border. A photo takes an 8% ink hairline inside its
edge; initials are a tinted disc whose hue is picked from the name (eight hues at one
lightness, each label at least 6:1), so the same member is the same colour everywhere.

## Icons

- One set: **Phosphor** (`@phosphor-icons/react`), since 2026-11-28. Import glyphs from
  `@/components/ui/icons` only and draw them with `<Icon icon={…} />` from
  `@/components/ui/icon`. Never import the package directly.
- The weight follows the size: under 20px `bold`, 20px and up `regular`, which keeps
  the drawn line near 1.5px at every size. Do not pass `weight` to tune a stroke.
- `weight="fill"` is the active state of a navigation glyph (workspace rail, phone tab
  bar), Instagram's outline-at-rest, solid-where-you-are rule.
- Navigation, action, attribute, decoration: `size-4` (`size-3.5` beside `text-meta`),
  `text-muted-foreground` unless inside a button.
- Icons that state a fact (verified, good, so-so, bad, warning, trusted): filled
  `StatusGlyph` (`components/ui/status-glyph.tsx`) in the state's colour. A chat
  milestone's mark follows the same rule: a solid disc in the outcome's colour with
  the event's glyph in white.

## Elevation

- Cards: `shadow-market`. Hover-lift on whole-card links: `shadow-lift`.
- Floating panels: `shadow-md`. Dialogs: `shadow-lg`.
- Quiet buttons: a 1px drop; filled buttons: a 1px top highlight (`button.tsx`).
  Tonal buttons: none.
