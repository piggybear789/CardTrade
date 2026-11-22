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
2. **The scale is deliberately compact.** `body` is **under test at 14px**, having
   shipped at 13px. The values describe the current product rather than an
   aspirational scale.

`cozy` supplies the 12px dense-spacing step. `nav` (15px, sidebar rail only) has been
**retired**: at `body` = 14px it was one pixel above body copy, which is not a
register. The rail is `text-body`; the active row carries `font-medium` for scan weight.

**Line-height travels with the token.** Each level fixes its own leading and that is
the register. Only three overrides are sanctioned: `leading-none` (single-line chips,
badges, counts), `leading-tight` (headings at `head` / `display`), and `leading-snug`
(a dense two-line row inside a card or list item). `leading-relaxed`, `leading-normal`
and numeric `leading-N` are not — if a paragraph wants more air, that is a `space-y`
decision.

**Radius tiers derive from `--radius`** (8px): `sm` 4 (chips, thumbnails), `md` 6
(controls), `lg` 8 (cards), `xl` 12 (sheets, dialogs, large media), `2xl` 16 (chat
bubbles, pill fields). `rounded-full` is the only shape outside the ramp.

**`lead` is no longer a field floor.** Fields used to be floored at 16px on touch
because iOS Safari zooms a focused input whose text is under 16px and does not zoom
back out. That floor was removed deliberately: fields render at `body`, and the
focus-zoom is an accepted tradeoff. 14px does not avoid it — the threshold is 16px. If
it ever has to be suppressed, scope it to iOS with
`@supports (-webkit-touch-callout: none)`, not to a pointer or a width.

### Flutter port

This document's no-`flutter_app/**` rule applies to the original web presentation
sweep only. `.kiro/specs/mobile-visual-parity/` is the deliberate Flutter port of this
same scale: it reads the values from `tailwind.config.ts`, preserves their
size/line-height pairings, and preserves the Subtext_Rule and Compact_Row_Rule below.
It does not make this document a second source of token values.

**Not yet ported:** the 2026-11-22 field-hint change. Flutter's
`inputDecorationTheme.helperStyle` (`app_theme.dart`) is still `supportText` (body),
pinned by `controls_test.dart` and the form goldens. Moving it to `metaText` means
updating that test and regenerating `test/golden/forms`.

## Type scale

| Token | Size | Line height | Use it for |
| --- | --- | --- | --- |
| `text-meta` | 12px (`0.75rem`) | `1.4` | Chrome (badges, timestamps, counts, dense table cells, key-value micro-labels) and **field hints** |
| `text-body` | 14px (`0.875rem`) | `1.6` | Body copy, descriptions, disclosure copy, form labels, field text, and field errors |
| `text-lead` | 16px (`1rem`) | `1.5` | Lead paragraphs, card titles, emphasised single values |
| `text-subhead` | 17px (`1.0625rem`) | `1.4` | Panel and card headings |
| `text-head` | 21px (`1.3125rem`) | `1.25` | Section headings, page titles inside a shell |
| `text-display` | 28px (`1.75rem`) | `1.1` | Hero / landing headlines only |

The table is a readable mirror, not a token source: `tailwind.config.ts` owns every
size and line-height value.

### The subtext rule

**A field hint is `text-meta` and muted. All other supporting copy is `text-body` and
muted.**

```tsx
// Field hint: belongs to ONE control and sits directly under it
<Input id="tracking" aria-describedby="tracking-hint" />
<p id="tracking-hint" className="text-meta text-muted-foreground">
  Enter the number for this parcel only.
</p>

// Supporting paragraph: section, card or dialog description, disclosure
<p className="text-body text-muted-foreground">Buyer pays return postage.</p>

// WRONG: raw sizes, which is how one role ended up at several sizes
<p className="text-xs text-muted-foreground">…</p>
<p className="text-sm text-muted-foreground">…</p>
```

A **field hint** is copy attached to one control, under it (or under its label, for an
upload): what to enter, a format or limit, what the field is used for, a character
count, or a live readout of the field's own value ("Currently A$120.00", "You'd pay
A$124.20"). It is one step below the field's own text so it reads as part of the field
rather than as a paragraph competing with it.

These stay `text-body`:

- Section, card and dialog descriptions (`DialogDescription`, `CardDescription`).
- A consequence the member must not miss, even beside a field (an irreversible region
  choice). Give it its own paragraph or a `StatusNotice`, not a hint.
- Field errors (`text-body text-destructive`): an error is never quieter than the hint
  it replaces.
- An option's own description inside a control (`ChoiceTile`, `DialogRow`): that is the
  control's face, not a hint under it.

**Why this changed (2026-11-22).** The earlier rule, "de-emphasise by colour, never by
size", put every hint at 14px, the same size as the label and the text in the field, so
hints read as body copy and forms looked wordy. Material 3 sets supporting text one
step below the field (Body Small under Body Large); GOV.UK is the main design system
that keeps hints at body size. The earlier rule's accessibility concern was a lighter
muted at 12px. Muted foreground is now `215 19% 35%`, about 7.4:1 on white, which passes
WCAG AAA at 12px.

`text-meta` is still not a general "smaller subtext". A sentence a member reads that is
not a field hint is `text-body`.

### The compact-row rule — do not shrink reading text to fit a control

A dense strip (chat header, list row, composer) feels small because of **padding
and height**, not because the sentences dropped a size. Controls keep their
primitive type: `Button`, `Input`, `Textarea` and `SelectTrigger` are all `text-body`,
at every width and on every pointer. Compact variants may shorten the field; they must
not change the font size.

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

The document body is `text-body`. Unstyled copy inherits 14px so it matches the
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
   the subtext rule above: chrome or field hint → `text-meta`; any other sentence →
   `text-body`.
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
