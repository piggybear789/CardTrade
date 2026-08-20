---
name: color-audit
description: Expert color palette audit for NoDitto — verify semantic token completeness, WCAG 2.2 AA contrast compliance, accent distribution, and surface-ramp correctness. Single light theme (cream page, obsidian ink, gold/amber accents, ditto lavender reserved for character moments).
user-invocable: true
allowed-tools: Read, Grep, Glob
---

Expert color palette audit — verify semantic token completeness, WCAG contrast compliance, accent distribution, and surface-ramp correctness across the NoDitto marketplace.

Target: $ARGUMENTS

If no target is provided, audit the full palette in `app/globals.css` and spot-check usage across `components/` and `app/`.

## Before Starting

1. Read `app/globals.css` — extract ALL color tokens from the `:root` block and every component class that hardcodes `hsl(var(--…))` pairs (`.cardtrade-eyebrow`, `.ledger-strip`, `.market-search`, `.noditto-character`, …).
2. Read `.kiro/specs/design-system/typography-spacing.md` — the type/spacing scale the audit reports against.
3. Read `tailwind.config.ts` — confirm which tokens are actually mapped to utilities.

## Palette Reference (app/globals.css)

Tokens are HSL triplets consumed as `hsl(var(--token))`.

| Token | Value | Role |
|-------|-------|------|
| `--background` | `42 26% 93%` | Cream page canvas |
| `--obsidian` | `30 9% 4%` | THE one black: ink, header, primary buttons. Never invent a second near-black — lighten with opacity only |
| `--foreground` / `--primary` | alias `--obsidian` | Body ink and primary action fill |
| `--card` / `--popover` | `40 30% 99%` | Paper surfaces |
| `--secondary` | `39 28% 88%` | Secondary fills |
| `--muted` | `40 22% 90%` | Grouping tint on card — never washed with `/20`–`/30`, never a field fill |
| `--muted-foreground` | `32 10% 34%` | Subtext — de-emphasis is by COLOR, never by smaller size |
| `--accent` | `41 32% 84%` | Hover tint |
| `--destructive` | `4 78% 40%` | Errors; cream foreground |
| `--border` | `36 18% 78%` | Quiet structural hairline (deliberately below 3:1 — see Rules) |
| `--input` | alias `--border` | Semantic field-edge class — same colour as `--border`, so fields cannot drift onto a second cream |
| `--ring` | alias `--parchment` | Cream focus ring — no ink, no Ditto on focus. Interactive borders lift to `gold/40` instead |
| `--parchment` | `40 45% 90%` | Cream utility tone (ledger strips, inverse-surface fills) |
| `--gold` | `41 56% 30%` | Brand accent — AA as text on cream/card |
| `--action` | `41 94% 50%` | Bright amber "this is your move" CTA; obsidian foreground |
| `--ditto` | `282 62% 62%` | Ditto lavender — character moments and the `ditto` button variant only |
| `--trust` | `173 80% 26%` | Success/verified |

## Audit Dimensions

### 1. TOKEN COMPLETENESS

Verify all required tokens exist in `app/globals.css` and are mapped in `tailwind.config.ts`:
- Surface ramp: `--background`, `--muted`, `--secondary`, `--accent`, `--card`, `--parchment`
- Ink: `--foreground`, `--card-foreground`, `--muted-foreground`, `--primary-foreground`
- Accents: `--gold`, `--action` (+foreground), `--ditto`, `--trust`, `--destructive` (+foreground)
- Utility: `--border`, `--input`, `--ring`, `--radius`

### 2. CONTRAST COMPLIANCE (WCAG 2.2 AA)

**Required ratios:**
- Normal text (< 18px): 4.5:1 minimum
- Large text (≥ 18px / ≥ 14px bold): 3:1 minimum
- UI component boundaries that must be perceived: 3:1 (but see Rules — NoDitto's hairlines are deliberately quiet)

**Critical pairs to check:**

| Pair | Background | Foreground | Context |
|------|-----------|------------|---------|
| Body text | `--background` | `--foreground` | Page copy |
| Card text | `--card` | `--card-foreground` | Cards, dialogs |
| Muted text | `--card` | `--muted-foreground` | Helper text, labels |
| Gold as text | `--card` | `--gold` | Eyebrows, links, emphasis |
| Action CTA | `--action` | `--action-foreground` | Buy now, Copy deal link |
| Ditto button | ditto mixed toward white | `--obsidian` | `ditto` button variant |
| Destructive | `--destructive` | `--destructive-foreground` | Errors, destructive buttons |
| Header | `--obsidian` | `--primary-foreground` / `--parchment` | Dark top bar |
| Trust | `--card` | `--trust` | Verified badges |

### 3. SURFACE RAMP AUDIT

Verify lightness ordering holds (no inversions):
`--card (L99)` > `--background (L93)` > `--muted (L90)` ≈ `--parchment (L90)` > `--secondary (L88)` > `--accent (L84)` > `--border (L78)`

Card must be the lightest surface — it sits ON the cream canvas to lift.

### 4. ACCENT DISTRIBUTION

- Dominant: cream surfaces + obsidian ink.
- Secondary: muted/secondary/accent tints for grouping and hover.
- Accent budget: amber `--action` for THE primary move on a screen (at most one per view); gold for brand emphasis and eyebrows; ditto lavender ONLY for character moments and the `ditto` button variant — sparse by explicit owner decision.

**Red flags:**
- Two amber/`action` CTAs competing in one view
- Ditto lavender used as broad decoration (washes, borders, focus rings)
- `--muted` washed to `/20`–`/30` (reads as dirty white, not grouping)
- Gold used as a large fill (it is a text/hairline accent, AA as text)
- A second near-black invented instead of `--obsidian` + opacity
- Field edges using a different colour than `--border` (parchment-on-card that vanishes)
- Gold/destructive/trust hairlines at opacities other than `/40`

### 5. COMPONENT SPOT-CHECK

Scan component files for violations:
- Hardcoded colors: `bg-yellow-*`, `text-gray-*`, `text-stone-*`, hex values, raw `rgb()`/`hsl()` outside `globals.css`
- Mismatched pairs: `bg-primary` without `text-primary-foreground`, `bg-action` without obsidian ink
- Opacity dropping text below AA: `text-foreground/50`, `text-muted-foreground/70` as running copy
- `text-white` on light surfaces (the app is single-light-theme; dark surfaces use explicit tokens, not a mode)
- De-emphasis via font size instead of `text-muted-foreground` (violates the subtext rule)

## Output Format

```
## Color Palette Audit

### Token Inventory
| Token | Value | Present | Status |
|-------|-------|---------|--------|

### Contrast Report
| Pair | Ratio | WCAG AA | Status |
|------|-------|---------|--------|

### Issues Found
1. [SEVERITY: CRITICAL/HIGH/MEDIUM/LOW] — description
   - Current: value
   - Recommended: value

### Surface Ramp Assessment
- Ramp ordering: [PASS/ADJUST]
- Accent distribution: [PASS/ADJUST]
```

## Rules

- Single **light** theme (`colorScheme: 'light'` in the root layout). Dark surfaces (header, auction stage) are explicit obsidian tokens, not a mode switch. Never report "missing dark mode" as an issue.
- ONE black: `--obsidian`. Lightening is via opacity, never a second HSL.
- Hairlines are deliberately quiet: `--border` (and `--input`, which aliases it) sit below 3:1 **by owner decision** — a 3:1 bronze pass was tried and rejected as heavy. Do not re-flag them; flag only NEW borders that carry meaning (state, selection) without another cue.
- **One hairline, one lift, one inverse, one tint.** Resting edges are `--border`. Interactive hover/focus edges lift to `gold/40`. Selected state is a fill (`bg-gold/10`), never a gold border. Inverse surfaces (obsidian) use `white/15` resting and `white/25` hover. Semantic callouts (gold, destructive, trust) use `/40`. Flag `border-gold/30`, `/50`, `border-primary` on cream tiles, a gold border on a selected tile, or a parchment field edge that is not `--border`.
- Two creams cannot hit 3:1 against each other; do not demand it of surface-on-surface seams.
- Ditto lavender is scoped: character art, landing selection, and the `ditto` button variant. Flag expansion beyond that.
- Never use pure white as a page background — `--card` is the only near-white and it is a surface, not the canvas.
- Present the full audit before making any changes.
