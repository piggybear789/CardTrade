# NoDitto redesign mockup board — round 2

Static HTML mockups of every member-facing surface, at desktop (1280) and mobile (390),
drawn in the app's real tokens. Open `index.html` in a browser — no build step, no server.

```cmd
start design\mockups\index.html
```

Nothing here is wired to the app. It is a design artefact: no imports from `components/`,
no app code touched.

## Round 2 — what changed after review

Round 1 proposed changes to all 28 surfaces. This round keeps only what the review
accepted and renders the **current build** everywhere it won. Plates badged
`CURRENT DESIGN KEPT` are the app as it stands, drawn from the code.

| Sheet | Surfaces |
|---|---|
| `index.html` | Palette correction, the five status tones, defects found in the build, accepted/dropped scope |
| `01-discovery.html` | Catalog, listing detail, create/edit, my listings, saved, seller profile |
| `02-entry.html` | Sign in, sign up, recovery, onboarding *(kept)*, identity *(kept)*, payout setup *(kept)* |
| `03-contracts.html` | Cash sale room *(kept)*, trade room *(kept)*, dispute, contract lists, offers, propose a trade *(kept)*, deal invite |
| `04-comms-account.html` | Inbox, thread, notifications, profile, payouts |
| `05-admin-system.html` | Admin ops, arbitration queue, case view, help, system states |

Dropped after review: the contract-room restructure, progress rails in the live rooms,
applied-filter chips, facet counts, the catalog FAB and result pill, the listing trust
strip, the onboarding/identity/payout-setup rebuilds, and the propose-a-trade rebuild.

## Two corrections I owe the record

**The palette is not disharmonious the way round 1 claimed.** Round 1 read HSL saturation
as perceptual chroma and concluded the accents shout over the violet. Reading
`app/globals.css` shows every value was measured — six teal alternatives were tested and
173° won on contrast *and* hue distance; `--action` was already moved off safety orange and
gained `--action-border` because a pastel fill cannot be its own edge. The real defect is
narrower: `--action` (40°) and `--destructive` (0°) are 40° apart, the tightest gap in the
wheel, while carrying the most opposed meanings in the product. **One token moves:**
`--destructive` → 352°, which opens the gap to 48° and pulls red into the 275°-tinted
family. Luminance is unchanged at constant S/L so the measured contrast still holds.

**"Don't abuse the purple" is a frequency problem, not a hue problem.** `--iris-ink` was on
every price in the app — the most repeated element there is — so violet meant "money" as
well as "platform". Prices become ink. Violet then means one thing: the platform's own
presence (rail, active nav, custody, focus ring).

**The onboarding progress "bug" was not one.** Round 1 said the dots vanishing on the seller
step was a defect. The array's own comment gives the reason and it is correct — counting a
seller-only step would tell a buyer they are on "step 4 of 5" of something they will never
see. The real defect is smaller: `PROGRESS_STEPS` includes `welcome` but the dots are hidden
on it, so the first number a member ever sees is "Step 2 of 4".

## Defects found in the current build

Listed with sources on `index.html#bugs`. Ordered by cost to a member.

- **B1** Step labels describe the viewer in the third person — "Buyer confirms the item
  arrived" — and that label is the action dock's `<h3>`. The correctly-voiced `detail`
  beneath it is `hidden` below `md`, so the phone shows only the wrong one. Voice is also
  inconsistent across steps (imperative / passive / third person).
- **B2** `InspectionCountdown` is a banner in the trade room and lives inside the
  *Protection tab* in the cash sale — so the deadline that completes the sale and pays the
  seller is two taps away on a phone. Same component, one visible and one not.
- **B3** The onboarding counter never says "1" (see above).
- **B4** `CANCELLED` renders `outline` on a cash sale and `secondary` on a trade.
- **B5** Two desktop search fields with different scopes and identical appearance — the rail
  one filters only loaded items, so on page 1 of 27 it searches 48 of 1,284. Not actioned.
- **B6** The tab is "Payout setup"; the card inside it is headed "Payout destination".
- **B7** `--action` is 1.55:1 against the page and depends entirely on `--action-border`.
  Documented, but it means any usage dropping the border degrades the buy control to a tag.

## Verification

The board is checked by rendering it, not by eyeballing it:

```cmd
node design\mockups\verify.mjs          :: all sheets, reports defects, writes _shots\
node design\mockups\shoot.mjs 01-discovery.html seller   :: one plate, for a closer look
```

`verify.mjs` reports, per sheet: frames whose content runs more than 90px past their own
height (a screen edge is fine, losing a card is not), horizontal overflow inside a device
frame, `.rowgrid` tables whose columns fail to align across rows, panes clipping content
inside an `overflow:hidden` container, and console errors. It also asserts the two palette
decisions actually landed in the computed styles.

Current state: **54 frames, no defects**, both `.rowgrid` tables column-aligned, price
resolving to ink and destructive to the 352° red.

Three defects were found this way and fixed: mobile frames sliced mid-card (now marked with
a fold fade and given height where earned), annotation pins colliding with mobile content,
and emoji nav glyphs falling back inconsistently — those were only ever stand-ins for
Hugeicons, so they are gone from the rails.

## Tokens

`board.css` copies colour, type and spacing verbatim from `app/globals.css` and
`tailwind.config.ts`, with the single `--destructive` change marked in a comment. If the two
disagree, the app is correct and `board.css` is stale.

Frame scale is two properties at the top of the file:

```css
--sd: 0.66; /* desktop 1280 */
--sm: 0.8;  /* mobile 390  */
```

## Relationship to `ux-audit-findings.md`

That file is the code-level usability backlog (F1–F37, R1–R2) and stays the source of truth
for those items. This board is a pattern-level pass: composition, hierarchy and information
architecture. B1–B7 above are new and not in that file.

Reference patterns came from [Mobbin](https://mobbin.com) and are cited per note.
Descriptions are paraphrased; content was rephrased for compliance with licensing
restrictions.
