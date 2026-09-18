# Catalog game logos

## Decision: ship the real marks

The product owner's call (18 Sept 2026) is that the category icons should be
each game's **actual symbol**, used nominatively to label a marketplace category
for that game, and that this use is acceptable. The hand-drawn monochrome marks
in `components/listings/GameIcon.tsx` are now the FALLBACK for games where no
usable vector exists yet, not the intended end state. Where a public vector
exists it is used; where only a raster reference exists the symbol is traced by
hand into a minimal SVG. Each file's origin is recorded below.

The underlying names and marks remain **trademarks of their respective owners**.

## Files

| File | Slug | Source | Licence / basis | Mark type | Aspect (w/h) |
| --- | --- | --- | --- | --- | --- |
| `pokemon.svg` | `pokemon` | [File:Poké Ball icon.svg](https://commons.wikimedia.org/wiki/File:Pok%C3%A9_Ball_icon.svg) (Commons, Andreuvv) | Public domain (`PD-ineligible`) | **Symbol** (Poké Ball) | 1.00 |
| `magic-the-gathering.svg` | `magic-the-gathering` | Hand-traced from the published M-in-a-ring symbol | Nominative use per the decision above | **Symbol** | 1.00 |
| `riftbound.svg` | `riftbound` | Hand-traced from the published orange whirl | Nominative use | **Symbol** | 1.00 |
| `disney-lorcana.svg` | `disney-lorcana` | Hand-traced: navy hexagon, gold ring, four-point compass star | Nominative use | **Symbol** | 1.00 |
| `one-piece.svg` | `one-piece` | Hand-traced from the ONE PIECE CARD GAME compass (Log Pose) device | Nominative use | **Symbol** | 1.00 |
| `yu-gi-oh.svg` | `yu-gi-oh` | Hand-traced from the Millennium Puzzle: inverted pyramid, Eye of Wdjat, ring | Nominative use | **Symbol** | 1.00 |
| `gundam.svg` | `gundam` | Hand-traced from the GUNDAM CARD GAME device: tilted quartered square with slash | Nominative use | **Symbol** | 1.00 |
| `flesh-and-blood.svg` | `flesh-and-blood` | Hand-traced from the Flesh and Blood shield lockup (shield only, no lettering) | Nominative use | **Symbol** | 1.00 |
| `star-wars-unlimited.svg` | `star-wars-unlimited` | Hand-traced Rebel Alliance starbird. The reference supplied was the STAR WARS wordmark, which is illegible at 20px; the starbird is the franchise's symbol | Nominative use | **Symbol** | 1.00 |
| `dragon-ball-super.svg` | `dragon-ball-super` | Hand-traced from the logo's own "O": an orange dragon ball with a red star | Nominative use | **Symbol** | 1.00 |
| `weiss-schwarz.svg` | `weiss-schwarz` | Hand-traced from the diagonal white/black device with the fleur | Nominative use | **Symbol** | 1.00 |
| `cardfight-vanguard.svg` | `cardfight-vanguard` | Hand-traced from the red V with blue keyline | Nominative use | **Symbol** | 1.00 |
| `union-arena.svg` | `union-arena` | Hand-traced: black tile, magenta/violet streaks, white U | Nominative use | **Symbol** | 1.00 |

All traced files are authored minimal on a 100-unit viewBox and checked at 20px
(the category band) and 56px. References for every trace were supplied by the
product owner on 18 Sept 2026.

## Still on a drawn mark

`digimon` — the publisher's mark is a wordmark only; the drawn digivice stays
until a symbol reference exists.

`sports-cards`, `other-tcg` and `all` are generic categories rather than brands,
so a drawn mark is the correct answer for them regardless.

## Historical: the earlier policy

The notes below record the previous approach — only `PD-textlogo` /
`PD-ineligible` vectors, symbols only — and why each wordmark was rejected. They
stand as the reasoning for preferring SYMBOLS over wordmarks, which still holds.

| File | Slug | Commons source | Original author | Licence | Mark type | Aspect (w/h) |
| --- | --- | --- | --- | --- | --- | --- |
| `pokemon.svg` | `pokemon` | [File:Poké Ball icon.svg](https://commons.wikimedia.org/wiki/File:Pok%C3%A9_Ball_icon.svg) | Andreuvv | Public domain | **Symbol** (Poké Ball) | 1.00 |

## Only square symbols ship here

A category icon sits directly above a label that already names the game, in a
row of otherwise monochrome marks. A **wordmark** therefore fails twice: it
repeats the name, and its brand colours fight every drawn mark beside it. At
the ~20px band these rows use, a wide lockup is also illegible.

These five were downloaded, reviewed, and **rejected on those grounds**. They
are not in the repo. Re-fetch from the source below if a use case appears —
and see `GAME_LOGO_ASPECT` in `components/listings/GameIcon.tsx`, where adding
the slug back is a one-line change.

| Slug | Commons source | Aspect (w/h) | Why rejected |
| --- | --- | --- | --- |
| `dragon-ball-super` | [File:Dragonball Anime-Serie Original-Logo.svg](https://commons.wikimedia.org/wiki/File:Dragonball_Anime-Serie_Original-Logo.svg) | 1.33 | Wordmark, unreadable at 26px. Also the *Dragon Ball* franchise logo, not *Super* — no Super-specific vector exists on Commons. |
| `star-wars-unlimited` | [File:Star Wars Logo.svg](https://commons.wikimedia.org/wiki/File:Star_Wars_Logo.svg) | 1.65 | Wordmark, and ships an opaque black backing plate (the mark is `#FFE81F`, invisible on cream). Franchise logo, not the *Unlimited* lockup. |
| `magic-the-gathering` | [File:Magicthegathering-logo.svg](https://commons.wikimedia.org/wiki/File:Magicthegathering-logo.svg) | 3.50 | Wordmark. The current 2017 lockup was also rejected: it embeds a base64 raster and weighs 400 KB after SVGO. |
| `digimon` | [File:The Digimon Logo.svg](https://commons.wikimedia.org/wiki/File:The_Digimon_Logo.svg) | 4.32 | Wordmark. |
| `one-piece` | [File:One piece logo 1.svg](https://commons.wikimedia.org/wiki/File:One_piece_logo_1.svg) | 5.49 | Wordmark, and the widest of the set. |

## Slugs with no real asset

These have no licensable vector anywhere on Wikimedia Commons, English
Wikipedia, or the publishers' own sites (all of which serve raster logos), so
they keep the original hand-drawn monochrome marks in
`components/listings/GameIcon.tsx`:

`yu-gi-oh`, `riftbound`, `disney-lorcana`, `gundam`, `flesh-and-blood`,
`weiss-schwarz`, `cardfight-vanguard`, `union-arena`, `sports-cards`,
`other-tcg`, and `all`.

`sports-cards`, `other-tcg` and `all` are generic categories rather than
brands, so a drawn mark is the correct answer for them regardless.
