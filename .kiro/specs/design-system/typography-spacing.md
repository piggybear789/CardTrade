# Typography & Spacing — the ONE scale

Status: adopted. `tailwind.config.ts` owns the values; this file owns the **mapping
rules** and the reasoning. Read both before changing either.

## Why this exists

`tailwind.config.ts` defined `text-meta/body/subhead/head/display` and
`p-tight/snug/group/section/region` — and then **nothing used them**. A sweep found
**0** references to all ten tokens against **649** raw `text-*` size classes and 26
bracket one-offs (`text-[11px]`, `text-[0.7rem]`, `text-[10px]`, …). The scale was
dead code, so every component picked its own sizes and the same semantic role — a
line of helper text under a field — rendered at 12px on one card and 14px on the next.

Two flaws in the original tokens are corrected, and both matter:

1. **`fontSize` no longer bakes in `fontWeight`.** The original paired weight with
   size so a component "picks a level". But 649 call sites carry their own
   `font-medium` / `font-semibold` / `font-bold`, and a `fontSize` utility that also
   sets weight collides with them — same specificity, resolved by CSS source order,
   which is not something a component author can see or reason about. Size and
   line-height are paired (line-height is almost never overridden); **weight stays an
   explicit utility.** This makes every token a safe drop-in.

2. **The values now match the app's actual body size.** `body` was `0.9375rem` (15px)
   while 316 call sites used `text-sm` (14px). Migrating would have nudged nearly
   every sentence in the product by 1px for no stated reason. `body` is `0.875rem`.
   The scale describes this app; it is not an aspiration it fails to meet.

Two levels were added because the real usage needed them and their absence is what
forced the bracket one-offs: `lead` (16px, was `text-base` ×34) and `cozy` (12px
spacing, was `p-3`/`gap-3` — 118 `gap-3` uses had no token to land on).

## Type scale

| Token | Size | Use it for |
| --- | --- | --- |
| `text-meta` | 12px | **Chrome only**: badges, timestamps, counts, dense table cells, key-value micro-labels |
| `text-body` | 14px | Body copy, helper text, descriptions, disclosure copy, form labels |
| `text-lead` | 16px | Lead paragraphs, card titles, emphasised single values |
| `text-subhead` | 18px | Panel and card headings |
| `text-head` | 24px | Section headings, page titles inside a shell |
| `text-display` | 32px | Hero / landing headlines only |

`.market-label` / `.cardtrade-eyebrow` (11px, uppercase, tracked) stay as they are —
they are a *component*, not a size, and already centralised in `globals.css`.

### The subtext rule — this is the one the user asked for

**Subtext is de-emphasised by COLOUR, never by a smaller size.**

```tsx
// RIGHT — helper text, description, disclosure copy
<p className="text-body text-muted-foreground">Buyer pays return postage.</p>

// WRONG — same role, two sizes, which is the bug being fixed
<p className="text-xs text-muted-foreground">…</p>
<p className="text-sm text-muted-foreground">…</p>
```

`text-meta` is **not** "smaller subtext". It is for inline chrome that is genuinely
ancillary — a relative timestamp, a badge, a count, a cell in a dense table. If the
text is a sentence a member is meant to read, it is `text-body`.

This is also an accessibility fix: muted foreground is `32 10% 34%`, and at 12px a
lighter muted was carrying disclosure copy and form help.

### The compact-row rule — do not shrink reading text to fit a control

A dense strip (chat header, list row, composer) feels small because of **padding
and height**, not because the sentences dropped a size. Controls keep their
primitive type: `Button` is `text-body`, `Input`/`Textarea` are `text-lead sm:text-body`
(16px on a phone so iOS does not zoom). Compact variants may shorten the field;
they must not change the font size.

```tsx
// RIGHT — title at lead, facts at body, CTA at body. Emphasis is fill/weight.
<h2 className="text-lead font-semibold">{title}</h2>
<p className="text-body text-muted-foreground">
  <span className="font-semibold text-foreground">{price}</span> · {name}
</p>
<Button size="sm">Pay now</Button>  // still text-body; size="sm" is height only

// WRONG — pane looks "compact" because the facts are 12px next to a 14px button
<p className="text-meta">{price} · {name}</p>
<div className="text-meta">{message}</div>
```

`size="sm"` on `Button` does **not** shrink type. If a 14px control looks loud,
the neighbours are too small — raise them.

The document `body` is `text-body`. Unstyled copy inherits 14px so it matches
every button. Do not omit a size class and rely on the browser's 16px — that is
what made controls look out of place on pages that never set a token.

## Spacing scale

| Token | Size | Use it for |
| --- | --- | --- |
| `tight` | 4px | Icon to its own label |
| `snug` | 8px | Within one component |
| `cozy` | 12px | Dense rows, nested groups, compact card padding |
| `group` | 16px | Standard card/panel padding; between related components |
| `section` | 32px | Between sections |
| `region` | 64px | Between major page regions |

**Half-steps are removed.** `gap-1.5` (×50), `gap-2.5` (×9), `space-y-1.5` (×13),
`space-y-0.5` (×7), `p-2.5` (×9) and the orphans `p-5`, `px-7`, `py-7` had no step
relationship to anything. Snap them:

- `0.5`, `1`, `1.5` → `tight`
- `2`, `2.5` → `snug`
- `3` → `cozy`
- `4`, `5` → `group`
- `6`, `7`, `8` → `section`
- `10`, `12`, `16` → `region`

Standard card padding is `p-group`. A dense or nested row is `p-cozy`.

## Migration rules for a sweep

1. **Classify, do not blindly substitute.** Every `text-xs` needs the judgement in
   the subtext rule above: sentence → `text-body`; chrome → `text-meta`.
2. **Never change a colour.** If an element sets `text-primary-foreground`,
   `text-destructive`, `text-trust` or a dark-surface colour, keep it. Only the SIZE
   class is being replaced. Dropping a colour breaks the dark header and the
   destructive states.
3. **Never change a weight.** `font-medium` / `font-semibold` / `font-bold` stay
   exactly as they are — the tokens no longer set weight, so the weight must remain
   explicit or the text visibly changes.
4. **Leave `components/ui/**` primitives conservative.** They are shadcn upstream;
   change sizes there only where the file already diverges from upstream, because a
   primitive's size propagates everywhere at once.
5. **Do not touch** `domain/**`, `lib/**`, `tests/**`, `supabase/**`, or
   `flutter_app/**`. This is a presentation-layer change only.
6. **Do not restructure markup.** No new wrappers, no removed elements, no changed
   component APIs. Class attributes only.
7. Preserve `cn()` usage and conditional class expressions — replace the size token
   inside them rather than flattening the expression.
