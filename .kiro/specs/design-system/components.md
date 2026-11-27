# Component design system (web)

The values live in `app/globals.css` and `tailwind.config.ts`; the primitives in
`components/ui/` apply them. This page is the rule for anything built outside a
primitive. Typography and spacing are in `typography-spacing.md`.

## Colour

| Token | Value | Use |
|---|---|---|
| `background` / `card` | white | page and cards. A card separates by `.surface` (below), never a border. |
| `sidebar` | slate 50 | the desktop rail only |
| `muted` / `accent` | slate 100 | notices, tiles, the other person's chat bubbles |
| `foreground` | slate ink #0F1729 | text; its alphas are the tonal fills (`bg-foreground/[0.06]`) |
| `muted-foreground` | slate 600 | secondary text (subtext is colour, never size) |
| `primary` | ink, same as `foreground` | the one filled CTA per view |
| `iris` / `iris-ink` | violet marker / violet text | active markers, links, unread dots; **your own chat bubbles and the send button** (`iris-ink`, white type 7.7:1). Never a wash or a frame on a panel or a filter |
| `trust` | emerald 700 | verified, settled, completed |
| `action` | amber | "your move" as a signal, never a button fill |
| `destructive` | red | danger, disputes |
| `obsidian` | slate 950 | overlays, letterboxing |

`node scripts/palette-contrast.mjs` checks every pairing.

## Edges

A fill is the shape of anything you press or read at a glance; an edge is kept for the
things whose edge says something (2026-11-28, design-system audit).

- **No edge**: every button (the quiet variants are tonal, below), chips and filter
  pills at rest, status badges, notices, callouts, tiles, icon discs and step discs.
- `border-input`: **fields only**, because the edge is what says "type here": input,
  select, textarea, checkbox, radio, a field-shaped trigger (the date picker), choice
  tiles (a radio or checkbox card), `DialogRow`. Hover `border-input-hover`. Focus
  `fieldStateClasses` (`border-ring`).
- `.surface` / `.surface-md`: cards and panels. A 1px hairline shadow and a tight drop,
  no border. Never `border` plus `shadow-sm`, the "ghost card".
- `border-border`: dividers; records listed inside a card (a report, an evidence
  entry, a list with dividers); the option not taken in a read-only summary; floating
  panels (with `shadow-md`). No alpha variants (`border-border/70`): one hairline.
- Photos: an inset 8% ink hairline (`outline outline-1 -outline-offset-1
  outline-foreground/[0.08]`, or `after:` on an avatar). The listing gallery keeps its
  `border`, because a thumbnail's selection is drawn on it.
- **No dashed edges.** A drop area is a tint: `bg-foreground/[0.04]`, hover `[0.06]`,
  a file over it `[0.09]`.

## Radius

| Class | px | Object |
|---|---|---|
| `rounded-sm` | 4 | inside a menu or list: items |
| `rounded-md` | 6 | every control and label: button, icon button, input, select, textarea, chip, badge, tag, tooltip, label on a photo |
| `rounded-lg` | 8 | floating panels (popover, dropdown, select list), tiles and callouts nested in a card, a group of controls (a segmented control's track), 40–48px row thumbnails |
| `rounded-xl` | 12 | cards, panels (a page-level notice), list containers, dialogs, sheets, media frames, inset list rows (the inbox) |
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
| Chip / filter pill | `h-9 md:h-11` (catalog), `h-7`–`h-9` elsewhere | unselected `border-transparent bg-foreground/[0.05] text-foreground/75`, hover `[0.09]`; selected `border-foreground bg-foreground text-background`, a brand glyph inside it white |
| Segmented control | segment `size-8` | track `rounded-lg bg-foreground/[0.06] p-0.5`; chosen segment `bg-card` with a 1px drop |
| Badge | 20px | borderless tint (`badge.tsx`); a contract status adds a 6px `dot`; `outline` is the hairline "fact" badge ("Resolved", "No contract") |
| Composer controls | `size-10 md:size-9` round, inside the capsule | |

Filled buttons: `default` (ink) for the main action, `contrast` beside a destructive
one, `destructive` only inside a confirmation.

Quiet buttons are all **tonal**: a tint of the ink, no edge, no drop. `secondary` is the
quiet button (`bg-foreground/[0.06]`, hover `[0.1]`, press `[0.14]`, focus a 2px inset
`--ring` frame); `outline` is an alias of it, kept so old call sites compile, and new
code says `secondary`. `ghost` hovers with the same tint. `destructive-quiet` is the
tonal shape with a red label (a trigger that opens a confirmation);
`destructive-soft` and `caution-soft` are a red or amber wash beside the step's main
action. Do not pass `border-*`, `bg-card` or `shadow-*` to a quiet button: the base
carries `border border-transparent`, so an edge colour draws the old box again.

A hand-rolled pressable (a `<button>`, `<Link>` or `<label>` that is not `Button`)
uses the same recipe, with `focus-visible:ring-2 focus-visible:ring-inset
focus-visible:ring-ring`. The current item in a menu is the ghost's tint held on, with
the filled glyph.

## Notices, tiles and marks

| Object | Recipe |
|---|---|
| Page-level notice (`StatusNotice`) | `rounded-xl bg-muted/80`, no edge |
| Callout inside a card | `rounded-lg bg-muted/80`; danger `bg-destructive/[0.06]`–`[0.07]`; caution `.cardtrade-warning` (amber 26%). Copy stays `text-foreground`; a three-word status may take the signal colour |
| Info tile (a saved card, the item being traded, a draft) | `rounded-lg bg-muted/60`; a chip or tag inside it turns `bg-card` |
| Small label or tag | `rounded-md bg-foreground/[0.06]`, no edge |
| Icon disc | `rounded-full bg-foreground/[0.06]`, or the state's tint (`bg-trust/10 text-trust`, `bg-destructive/10 text-destructive`) |
| Step disc (progress rail, onboarding, application tracker) | done the trust fill or `.cardtrade-success-chip`; current the ink (`bg-primary`); to come `bg-foreground/[0.06]`; ended `bg-destructive/10` |
| Event mark (contract timeline, chat milestone) | a solid disc in the outcome's colour with a white glyph (`ContractEventIcon`, `MilestoneDisc`) |
| Notification waiting on you | the row washed `bg-action/[0.16]` (hover `[0.26]`), the kind's disc in `bg-action` (glyph `text-action-foreground`) and the step on its own line in `text-action-foreground` medium; every other row is unwashed with a `bg-muted` disc. Unread is never a wash (dot and weight). Read from the linked contract's live plan (`needsReader`), never from the notification's title |
| Empty state | a tinted icon disc above the copy (`components/ui/empty-state.tsx`) |
| Label on a photo | `bg-obsidian/65`, no white edge |

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
  bar, site menu), Instagram's outline-at-rest, solid-where-you-are rule.
- Navigation, action, attribute, decoration: `size-4` (`size-3.5` beside `text-meta`),
  `text-muted-foreground` unless inside a button.
- Icons that state a fact (verified, good, so-so, bad, warning, trusted): filled
  `StatusGlyph` (`components/ui/status-glyph.tsx`) in the state's colour. A chat
  milestone's mark follows the same rule: a solid disc in the outcome's colour with
  the event's glyph in white.

## Elevation

- Cards: `.surface`. Hover-lift on whole-card links: `shadow-lift`.
- Floating panels: `shadow-md`. Dialogs: `shadow-lg`.
- Filled buttons: a 1px top highlight and a hairline drop (`button.tsx`). Tonal
  buttons, chips and tiles: none.
