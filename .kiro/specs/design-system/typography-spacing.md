# Typography & Spacing — the ONE scale

Status: adopted. `tailwind.config.ts` owns the values; this file owns the **mapping
rules** and the reasoning. Read both before changing either.

## Why this exists

`tailwind.config.ts` defines the type and spacing utilities; this document records
how to apply them. A previous sweep found raw `text-*` classes and bracket one-offs
(`text-[11px]`, `text-[0.7rem]`, `text-[10px]`, …) standing in for the same semantic
roles, so components could render helper copy at different sizes without a reason.

Two rules in the tokens matter:

1. **`fontSize` never bakes in `fontWeight`.** Size and line-height are paired, but
   **weight stays an explicit utility.** A size utility is therefore safe to combine
   with a component's intentional `font-medium`, `font-semibold`, or `font-bold`.
2. **The scale is deliberately compact.** `body` is 13px, while `lead` stays at 16px
   for touch fields so iOS Safari does not zoom a focused input. The values describe
   the current product rather than an aspirational scale.

`lead` supplies the 16px field floor, `cozy` supplies the 12px dense-spacing step, and
`nav` supplies the sidebar rail's 15px scanning register. `nav` is not content copy.

### Flutter port

This document's no-`flutter_app/**` rule applies to the original web presentation
sweep only. `.kiro/specs/mobile-visual-parity/` is the deliberate Flutter port of this
same seven-level scale: it reads the values from `tailwind.config.ts`, preserves their
size/line-height pairings, and preserves the Subtext_Rule and Compact_Row_Rule below.
It does not make this document a second source of token values.

## Type scale

| Token | Size | Line height | Use it for |
| --- | --- | --- | --- |
| `text-meta` | 12px (`0.75rem`) | `1.4` | **Chrome only**: badges, timestamps, counts, dense table cells, key-value micro-labels |
| `text-body` | 13px (`0.8125rem`) | `1.6` | Body copy, helper text, descriptions, disclosure copy, form labels |
| `text-nav` | 15px (`0.9375rem`) | `1.4` | **Sidebar rail only**; never content copy |
| `text-lead` | 16px (`1rem`) | `1.5` | Lead paragraphs, card titles, emphasised single values, and touch-field text |
| `text-subhead` | 17px (`1.0625rem`) | `1.4` | Panel and card headings |
| `text-head` | 21px (`1.3125rem`) | `1.25` | Section headings, page titles inside a shell |
| `text-display` | 28px (`1.75rem`) | `1.1` | Hero / landing headlines only |

The table is a readable mirror, not a token source: `tailwind.config.ts` owns every
size and line-height value. `text-nav` exists for the desktop sidebar rail and must not
be used to create a seventh content register at mobile width.

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

The document body is `text-body`. Unstyled copy inherits 13px so it matches the
product's body register. Do not omit a size class and rely on the browser's 16px — that
is what made controls look out of place on pages that never set a token.

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
5. **Do not touch** `domain/**`, `lib/**`, `tests/**`, or `supabase/**`. For this
   original web sweep, do not touch `flutter_app/**` either; the deliberate Flutter
   port is owned separately by `.kiro/specs/mobile-visual-parity/` and must preserve
   the Subtext_Rule and Compact_Row_Rule above.
6. **Do not restructure markup.** No new wrappers, no removed elements, no changed
   component APIs. Class attributes only.
7. Preserve `cn()` usage and conditional class expressions — replace the size token
   inside them rather than flattening the expression.
