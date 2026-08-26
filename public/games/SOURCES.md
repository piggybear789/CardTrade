# Catalog game logos

Every SVG in this folder was downloaded from Wikimedia Commons via
`https://commons.wikimedia.org/wiki/Special:FilePath/<File name>`, then run
through SVGO (`--multipass`, precision 1–2, `removeViewBox` disabled so the
files keep an intrinsic aspect ratio). Nothing here is hand-authored.

Hosted on Commons under **Public domain** — a `PD-textlogo` / `PD-ineligible`
case, meaning the mark is a typographic or simple-geometry design that falls
below the threshold of originality for copyright. The underlying names and
marks remain **trademarks of their respective owners** and are used here
nominatively, to label a marketplace category for that game.

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
