# Requirements Document

## Introduction

`flutter_app/` is a second client over the same Postgres schema as the Next.js web app.
It is not a second product, and this spec does not make it one. What it does is bring
the Flutter client's **presentation layer** into agreement with what the web app renders
**at mobile viewport widths**: the same colour tokens, the same type scale, the same
spacing and radius and elevation, the same shell and navigation shape, and the same
screen composition for the screens Flutter already has.

### Why this is not a cosmetic nicety

The Flutter theme's own header comment claims it "Matches the web app's CSS variables
exactly". It does not, and the gap is not a drift of a few points — it is a different
design language:

| | Web (`app/globals.css`) | Flutter (`lib/core/theme.dart`) |
| --- | --- | --- |
| Page | pure white, `0 0% 100%` | warm parchment `#F5F1EA` |
| Primary action | violet `275 38% 44%` | gold `#B8912E` |
| Brand accent | lilac family, hue 275 | "Ditto purple" `#A855D6` |
| Neutrals | tinted **toward** hue 275 | tinted warm, hue 30–42 |
| Radius | `0.5rem` (8px) | 10px, commented as "`--radius: 0.625rem`" |
| Card elevation | 4px/10px at 5% | 30px and 44px blurs |

Every one of those Flutter values is a value the web app **deliberately retired**, and
each retirement is reasoned in the source: gold was "a generic premium-fintech signal
that any marketplace could wear"; the tinted page was reverted because it cost the
product its one genuinely white surface; the 30px and 44px blurs were removed by name as
the "ghost card" tell. Flutter is not lagging the web palette. It is wearing the
previous one.

### Two source-of-truth problems this spec must resolve, not inherit

1. **`tailwind.config.ts` and `.kiro/specs/design-system/typography-spacing.md`
   disagree.** The doc's table says `body` is 14px, `lead` 16, `subhead` 18, `head` 24,
   `display` 32, and lists six levels. The config says 13 / 16 / 17 / 21 / 28 and has
   **seven**, having added `nav` at 15px for the sidebar rail. The config's own comment
   says so plainly: "THE SCALE CAME DOWN A NOTCH." The doc's first line already concedes
   that "`tailwind.config.ts` owns the values", so the config wins — but a port that read
   the doc's table would be wrong on five of seven levels on day one.

2. **`typography-spacing.md` says a sweep must not touch `flutter_app/**`.** That was
   correct for a web presentation sweep. This spec is the deliberate follow-up that
   carries the same scale across the language boundary, and it must say so rather than
   look like a violation of the rule it is completing.

### One genuine conflict, resolved rather than averaged

The web's phone chrome sizes its controls at 40px and says so deliberately: "keep controls
at `size-10`/`h-10`, not the 44px tap target used elsewhere", because every variant has to
land on the same inset-plus-54px height or the content edge shifts between routes.
`flutter_app/AUDIT.md` separately rates sub-48dp touch targets as its most severe finding.

Both are right, and neither number should move. The resolution throughout this spec is that
**visible size and hit area are separate numbers**: a control is drawn at the web's size and
given a 48dp hit area around it. Requirement 4 criterion 4, Requirement 5 criterion 5 and
Requirement 13 criterion 4 all state it that way. Do not close the gap by shrinking the hit
area to the visible size, and do not close it by inflating the chrome to 48px — that
reintroduces the drift the web comment exists to prevent.

### What is deliberately out of scope

This spec adds **no business logic and no capability**. The functional gap list — cash-sale
initiate, Identity and Connect handoff, private-deal invites, return shipping, leaving
reviews, the report flow, admin — belongs to `.kiro/specs/mobile-parity/` and stays there.
Where a web screen has no Flutter counterpart, this spec styles what exists and does not
build the missing screen. Where Flutter hands off to the website
(`lib/core/web_handoff.dart`), this spec styles the handoff affordance and leaves the
handoff in place.

### Three things the steering docs flag that are already fixed

Verified against the tree rather than taken from the docs, because a stale finding sends a
reader looking for a file that is not there:

- **`features/deals/screens/deals_screen.dart` is gone.** `.kiro/steering/flutter.md` and
  `.kiro/steering/product.md` both describe it as a live retired-vocabulary violation wired
  to `AppRoutes.trades`. No file matching `*deal*` exists under `flutter_app/`, and there is
  no reference to `DealsScreen` or `AppRoutes.deals` anywhere in `lib/`. Requirement 14
  criterion 4 keeps it gone; nothing here has to remove it.
- **The Inbox badge already counts messages.** `AUDIT.md` rates it a severity-2 defect that
  the Messages tab reads `unreadNotificationCountProvider`. It now reads
  `unreadMessagesCountProvider`; the notification provider is still watched into a variable
  that is never used, which is the one analyzer **warning** in the baseline below.
  Requirement 4 criterion 13 is a regression guard, not a fix.
- **`AUDIT.md` is wrong that there are no hardcoded colours.** Its strengths list claims
  "No random hardcoded hex colors or margin values outside the system". There are 12
  `Color(0x…)` literals outside `theme.dart` (`extensions.dart` ×2, `avatar.dart` ×8,
  `condition_badge.dart` ×2), plus 44 `Colors.white` and 8 `Colors.black`. Property P7
  covers them.

## Glossary

- **Web_Token_Source**: `tailwind.config.ts` together with the `:root` block of
  `app/globals.css`. The authoritative definition of every colour, type, spacing, radius
  and elevation token in the product.
- **Mobile_Theme**: the `AppTheme` class in `flutter_app/lib/core/theme.dart`. The single
  place a Flutter colour, size, radius or elevation value is defined.
- **Mobile_Screen**: any Dart file under `flutter_app/lib/features/**` or
  `flutter_app/lib/widgets/**` that builds a widget tree.
- **Type_Scale**: the seven named font-size levels in `Web_Token_Source`
  (`meta`, `body`, `nav`, `lead`, `subhead`, `head`, `display`), each pairing a size with
  a line-height and setting no font weight.
- **Spacing_Scale**: the six named spacing steps in `Web_Token_Source`
  (`tight` 4px, `snug` 8px, `cozy` 12px, `group` 16px, `section` 32px, `region` 64px).
- **Radius_Scale**: the `--radius` derived values in `Web_Token_Source` (`sm`, `md`, `lg`).
- **Elevation_Scale**: the named `boxShadow` entries in `Web_Token_Source`
  (`market`, `auction`, `lift`).
- **Semantic_Text_Role**: a named `TextStyle` exported by `Mobile_Theme` for one purpose
  (for example `cardTitle`, `bodyText`, `metaText`), as distinct from an inline
  `fontSize:` at a call site.
- **Subtext_Rule**: supporting copy is de-emphasised by **colour** (the muted foreground),
  never by dropping to a smaller size on the `Type_Scale`.
- **Compact_Row_Rule**: a dense row is made dense by reducing padding and height, never by
  reducing the font size of reading text below the size its neighbouring control uses.
- **Mobile_Top_Chrome**: the Flutter equivalent of the web's `MobileChromeFrame` — the
  per-route strip at the top of a screen holding the back affordance, title and up to two
  actions.
- **Mobile_Shell**: `flutter_app/lib/widgets/common/bottom_nav_shell.dart` together with
  `app_scaffold.dart`; the persistent navigation surround.
- **Hub_Set**: the five thumb-reach destinations the web presents in `MOBILE_HUBS`
  (`browse`, `contracts`, `sell`, `messages`, `account`), including which of them navigate
  and which open a sheet.
- **Icon_Set**: the icon family a client draws from. The web draws from Hugeicons in 142
  files and from `lucide-react` in none.
- **Icon_Map**: `flutter_app/lib/core/icons.dart`, the single module in which a
  Mobile_Screen names a glyph. Holds one entry per icon giving the web glyph name, the
  Flutter glyph standing in for it, and one line of reason.
- **Token_Agreement_Test**: a Vitest test at `tests/unit/mobileThemeAgreement.test.ts` that
  parses `Mobile_Theme` and compares it against `Web_Token_Source`, in the manner
  `tests/unit/mobileDomainAgreement.test.ts` already uses for domain rules and
  `tests/unit/regionCurrencyAgreement.test.ts` uses for migration 0068.
- **Mobile_Contract_Parser**: `scripts/lib/mobileContract.ts`, the existing home for Dart
  source parsers used by cross-language tests.
- **Golden_Test_Suite**: Flutter golden-file tests under `flutter_app/test/golden/**`.
- **Flutter_Analyzer**: the `flutter analyze` command as configured by
  `flutter_app/analysis_options.yaml`.
- **Colour_Conversion**: the function that turns a `Web_Token_Source` HSL triple into a
  Dart `Color`.
- **Contrast_Ratio**: the WCAG 2.1 relative-luminance contrast ratio between two colours.
- **Large_Text_Threshold**: 24 logical pixels at any weight, or 18.66 logical pixels at
  weight 700 or heavier, evaluated at a text scale factor of 1.0. The boundary between the
  4.5:1 and 3:1 Contrast_Ratio floors.
- **Retired_Vocabulary**: `Deal`, `DittoBond`, `KYC_Status`, `Police_Evidence_Pack` — names
  `tests/unit/mobileDomainAgreement.test.ts` refuses by name.
- **Advisory_Domain_Port**: the eight hand-ported rule modules under
  `flutter_app/lib/domain/` plus `flutter_app/lib/core/money.dart`. Advisory only; the
  server re-evaluates all of them.

---

## Requirements

### Requirement 1: One colour palette, ported and pinned

**User Story:** As a member who uses both the website and the app, I want the app to look like the same product, so that I trust that it is the same product handling my money.

#### Acceptance Criteria

1. THE Mobile_Theme SHALL define exactly one Dart `Color` constant, declared exactly once, for each of the following `Web_Token_Source` variables, named as the variable with its leading `--` removed and converted to lowerCamelCase (`--card-foreground` → `cardForeground`): `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--sidebar`, `--obsidian`, `--primary`, `--primary-foreground`, `--iris`, `--iris-ink`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--trust`, `--action`, `--action-foreground`, `--action-border`, `--mist`.
2. THE Token_Agreement_Test SHALL read the palette from the `Web_Token_Source` files themselves rather than from any copy of them, resolve each variable transitively where its value is another variable, and assert for every variable listed in criterion 1 that the `Mobile_Theme` constant equals `Colour_Conversion` applied to the resolved HSL triple, fully opaque, to a tolerance of 1 per 8-bit channel.
3. IF a colour-valued variable declared in the `:root` block of `Web_Token_Source` has no `Mobile_Theme` constant under the naming rule in criterion 1, or a declaration in either source cannot be parsed, THEN THE Token_Agreement_Test SHALL fail and name the variable or unparsed declaration, and SHALL NOT skip it; a variable whose resolved value is not an HSL triple is out of scope.
4. IF `Mobile_Theme` declares a colour constant whose name matches no `Web_Token_Source` variable under the naming rule in criterion 1, THEN THE Token_Agreement_Test SHALL fail and name the surplus constant, unless that constant is a deprecated alias satisfying criterion 5.
5. WHILE any Mobile_Screen migration named in Requirements 4 through 11 remains incomplete, THE Mobile_Theme SHALL declare each retired warm palette identifier (`gold`, `goldLight`, `parchment`, `ditto`, `dittoLight`, `charcoal`, `accentDark`, `surface`, `surfaceVariant`) as a `@Deprecated` alias whose annotation names exactly one replacement constant from criterion 1 and whose value equals that constant.
6. IF the number of Mobile_Screen references to a deprecated alias exceeds the count recorded for that alias when the migration began, THEN THE Token_Agreement_Test SHALL fail and name the alias and the referencing Mobile_Screen.
7. IF a colour used anywhere in `Mobile_Theme` has red, green and blue channels matching no variable listed in criterion 1 within the tolerance in criterion 2, THEN THE Token_Agreement_Test SHALL fail and name the identifier or literal.
8. THE Mobile_Theme SHALL express every semantic tint (a callout wash, a badge fill, a selected state) as a constant from criterion 1 at an explicit alpha within 0.01 of the alpha `Web_Token_Source` applies to the same tint, and THE Token_Agreement_Test SHALL fail and name any tint alpha that has no `Web_Token_Source` counterpart.
9. THE Mobile_Theme SHALL expose exactly one `ThemeData`, with light brightness, SHALL NOT expose a dark `ThemeData`, and SHALL NOT vary any colour with the operating-system appearance setting; dark surfaces SHALL be built from `obsidian` and `mist`.
10. WHERE `Web_Token_Source` contains a `.dark` block, THE Token_Agreement_Test SHALL resolve every comparison in criterion 2 from the `:root` block only, SHALL ignore any `.dark` override of a `:root` variable, and SHALL treat a variable declared only in `.dark` as out of scope, requiring no `Mobile_Theme` constant for it and reporting no failure under criterion 3.
11. IF a deprecated alias has zero Mobile_Screen references, THEN THE Token_Agreement_Test SHALL fail and name that alias until it is removed from `Mobile_Theme`.

### Requirement 2: One type scale, seven levels, weight left explicit

**User Story:** As a member reading a contract on my phone, I want a sentence to be the same size in the app as it is on the website, so that the app does not read as a cut-down version of the thing I agreed to.

#### Acceptance Criteria

1. THE Mobile_Theme SHALL define exactly seven font-size levels, named `meta`, `body`, `nav`, `lead`, `subhead`, `head` and `display`, each carrying a size in logical pixels equal to that level's `Web_Token_Source` `rem` value multiplied by 16 and a `height` multiplier numerically equal to that level's unitless CSS `line-height`, taking every value from the `fontSize` block of `tailwind.config.ts` and none from `.kiro/specs/design-system/typography-spacing.md`.
2. THE Mobile_Theme SHALL carry the CSS `line-height` across as the Dart `height` multiplier unchanged and unconverted, because a unitless CSS `line-height` and a Flutter `height` are both multipliers of the element's own font size.
3. THE Token_Agreement_Test SHALL read the `fontSize` block of `tailwind.config.ts` and assert, for each of the seven levels, that the `Mobile_Theme` size equals that level's `rem` value multiplied by 16 exactly and that its `height` equals that level's unitless `line-height` to within 0.001, failing and naming both the level and the disagreeing attribute when either differs or when a level is present on one side and absent from the other.
4. THE Mobile_Theme SHALL set neither a `fontWeight` nor a colour on any level named in criterion 1, and THE Token_Agreement_Test SHALL fail naming any level that carries either, so that a call site's weight is the only weight applied.
5. THE Mobile_Theme SHALL express every Semantic_Text_Role it exports — the twelve being `priceHero`, `priceCard`, `priceInline`, `cardTitle`, `rowName`, `bodyText`, `supportText`, `metaText`, `badgeText`, `sectionLabel`, `detailLabel` and `detailValue` — as exactly one level from criterion 1 combined with a weight and a colour token from Requirement 1 criterion 1, and SHALL NOT introduce a size or a `height` that is absent from criterion 1.
6. THE Token_Agreement_Test SHALL assert, for every Semantic_Text_Role, that its size equals exactly one criterion 1 level's size and that its `height` equals that same level's multiplier, failing and naming any role whose size matches no level or whose `height` differs from that of the level its size matches.
7. THE Mobile_Theme SHALL resolve every Material text-theme slot it populates to exactly one level from criterion 1 for size and `height`, and THE Token_Agreement_Test SHALL fail naming any populated slot whose size is absent from criterion 1, because copy that names no Semantic_Text_Role takes its size from a slot.
8. WHERE a Mobile_Screen sets a font size, THE Mobile_Screen SHALL do so by naming a Semantic_Text_Role or a level from criterion 1, and THE Token_Agreement_Test SHALL fail, naming the file and the line, on a `fontSize` named argument bound to a numeric literal anywhere under `flutter_app/lib/features/**` or `flutter_app/lib/widgets/**`.
9. THE Token_Agreement_Test SHALL treat as a font-size literal only a `fontSize` named argument bound to a numeric literal outside comments and string literals, and SHALL NOT treat `size`, `iconSize`, `strokeWidth`, `width`, `height`, `radius`, `blurRadius`, `letterSpacing`, `elevation` or a read of a `fontSize` property as one, because an icon size, a box dimension and a stroke width are not font sizes.
10. IF the Mobile_Contract_Parser cannot interpret a Dart file it is given or the `fontSize` block of `tailwind.config.ts`, THEN THE Token_Agreement_Test SHALL fail and name that file rather than report an empty set of findings, because a check that passes vacuously is worse than no check.
11. THE Mobile_Theme SHALL apply the `body` level as the default text size for the widget tree, so that copy naming no Semantic_Text_Role renders at the size a button label uses rather than at the platform default.
12. THE Mobile_Theme SHALL define the `nav` level so that the token sets agree in both directions, and THE Token_Agreement_Test SHALL fail, naming the file and the line, on any reference to the `nav` level from a Mobile_Screen, because every web use of `text-nav` sits behind the `md:` breakpoint and therefore never renders at mobile width.
13. WHERE reading copy is supporting rather than primary, THE Mobile_Screen SHALL keep it at the `body` level and de-emphasise it with the `--muted-foreground` token, honouring the Subtext_Rule.
14. WHERE a row is presented densely, THE Mobile_Screen SHALL reduce only its padding and its height, naming a step from the Spacing_Scale for that padding, and SHALL render its reading text at the same criterion 1 level that the same content uses in the row's non-dense form, honouring the Compact_Row_Rule.
15. THE Mobile_Theme SHALL set the input, text-area and select control text to the `lead` level and SHALL NOT step it down to the `body` level, because the parity target is what the web renders at mobile width, where the 16px field floor applies and the web's precise-pointer step-down does not.
16. THE Mobile_Theme SHALL give every level in criterion 1 a letter-spacing of −0.01 multiplied by that level's size in logical pixels, because `app/globals.css` states the root tracking in `em` while Flutter states it in logical pixels, and SHALL permit a Semantic_Text_Role to override that tracking only where `Web_Token_Source` gives the same treatment tracking of its own.

### Requirement 3: One spacing, radius and elevation scale

**User Story:** As a designer, I want a Flutter screen's rhythm to be built from the same steps the web uses, so that a screenshot of one can be compared to the other without allowing for a different underlying grid.

#### Acceptance Criteria

1. THE Mobile_Theme SHALL define exactly six spacing steps, named `tight`, `snug`, `cozy`, `group`, `section` and `region`, at 4, 8, 12, 16, 32 and 64 logical pixels respectively, being the `Web_Token_Source` values converted at 16 pixels per `rem`, and SHALL define no seventh step.
2. THE Token_Agreement_Test SHALL read the `spacing` block of `tailwind.config.ts`, convert each value to logical pixels at 16 pixels per `rem`, and assert equality with the `Mobile_Theme` steps at a tolerance of zero, failing and naming any step present on one side and absent from the other and any step whose two values differ, reporting both values.
3. THE Mobile_Theme SHALL express the retired t-shirt-sized steps (`spacingXs`, `spacingSm`, `spacingMd`, `spacingLg`, `spacingXl`, `spacingXxl`, `spacingXxxl`) as `@Deprecated` aliases, each naming its replacement step and resolving to one of the six criterion 1 values by the snapping table in `.kiro/specs/design-system/typography-spacing.md` rather than to the value it previously held, so that the 2 and 24 logical-pixel steps move rather than persist, and SHALL contain none of them once the migration of every Mobile_Screen named in Requirements 4 through 11 is complete.
4. THE Mobile_Screen SHALL express every padding, margin, inset, gap between siblings and spacer extent as a named step from criterion 1 or as zero.
5. IF a numeric literal under `flutter_app/lib/features/**` or `flutter_app/lib/widgets/**` supplies a padding, margin, inset, sibling gap or spacer extent whose value is neither zero nor one of the six criterion 1 values, THEN THE Token_Agreement_Test SHALL fail and name the file, the line and the value; and THE Token_Agreement_Test SHALL exempt a numeric literal that supplies a border or divider width, an icon or glyph extent, an aspect ratio, an animation duration, an opacity or alpha, a font size or line height, or a minimum hit area or control height stated elsewhere in this specification, because none of those is spacing.
6. THE Mobile_Theme SHALL define the Radius_Scale from the `Web_Token_Source` `--radius` value of `0.5rem`, giving `sm` 4, `md` 6 and `lg` 8 logical pixels, being `--radius` minus 4px, `--radius` minus 2px and `--radius`; and THE Token_Agreement_Test SHALL derive those three figures from `--radius` rather than hold them as constants, so that a change to `--radius` fails rather than passes, and SHALL fail on a radius still derived from the retired 10 logical-pixel value.
7. THE Mobile_Theme SHALL define exactly one additional radius, named `full`, at no less than 999 logical pixels for pill and circular shapes, and THE Token_Agreement_Test SHALL treat `full` as the only Radius_Scale member with no `Web_Token_Source` counterpart, failing and naming any other radius identifier that has none, `xl` at 14 logical pixels being the one currently present.
8. THE Mobile_Theme SHALL define the Elevation_Scale as `market`, `auction` and `lift`, each an ordered list holding one shadow per comma-separated layer of the same-named `boxShadow` entry in `Web_Token_Source`, each layer reproducing that layer's horizontal and vertical offset in logical pixels, its blur radius in logical pixels, and its alpha to two decimal places, drawn in the `--obsidian` token with a zero spread because no web layer declares one, and ordered so that the layer the web paints nearest the surface is the layer Flutter paints nearest the surface.
9. IF a Mobile_Theme shadow declares a blur radius greater than the largest blur radius in `Web_Token_Source` — 16 logical pixels, the `auction` blur — THEN THE Token_Agreement_Test SHALL fail and name the identifier and its declared value, because the 30 and 44 logical-pixel blurs currently in `Mobile_Theme` are the values `Web_Token_Source` removed by name as the ghost-card tell.
10. THE Mobile_Theme SHALL bound every card surface with a one-logical-pixel border in the `--border` token, matching the width the web's one-CSS-pixel border renders at, on every card including those that also carry an Elevation_Scale shadow, SHALL NOT use a fractional width, and SHALL NOT substitute a shadow for that border, so that a card is bounded by its edge rather than by a shadow.
11. THE Mobile_Theme SHALL state every Elevation_Scale blur in the CSS `box-shadow` blur-radius convention, which is the number `Web_Token_Source` declares and is approximately twice the Gaussian standard deviation Flutter renders from, SHALL perform that conversion in exactly one named place within `Mobile_Theme`, and THE Token_Agreement_Test SHALL compare blur radii on both sides in that convention and fail naming any second conversion or any call site that restates the relationship.
12. THE Token_Agreement_Test SHALL assert, for each Elevation_Scale entry, that the number of Flutter shadow layers equals the number of layers the same-named `boxShadow` entry declares — two for `market`, two for `lift` and one for `auction` — and SHALL fail and name the entry when a layer is collapsed, added, or ordered so that a different layer sits nearest the surface.
13. IF a shadow is constructed under `flutter_app/lib/features/**` or `flutter_app/lib/widgets/**` rather than named from the Elevation_Scale, THEN THE Token_Agreement_Test SHALL fail and name the file, the line and the declared blur, because a call-site shadow escapes the bound criterion 9 places on `Mobile_Theme`.

### Requirement 4: The app shell matches the web's mobile chrome

**User Story:** As a member moving between screens, I want the top strip and the bottom bar to sit where they do on the website, so that the app does not require me to learn a second navigation model.

#### Acceptance Criteria

1. THE Mobile_Top_Chrome SHALL render on the `--background` token with a bottom border of zero width and an elevation of zero logical pixels, matching `MobileChromeFrame`.
2. THE Mobile_Top_Chrome SHALL measure, from the top edge of the display to the top edge of the screen content below it, the status-bar inset plus 54 logical pixels in its default form and the status-bar inset alone in its compact form, in both cases within 1 logical pixel.
3. WHILE a Mobile_Screen is scrolled to any offset other than the top, THE Mobile_Top_Chrome SHALL hold its elevation at zero logical pixels, keep the `--background` token, and add no bottom border, because the web strip gains none.
4. THE Mobile_Top_Chrome SHALL draw each of its controls at 40 logical pixels of visible diameter, SHALL give each a hit area of at least 48 logical pixels on both axes, SHALL leave the height in criterion 2 unchanged where a hit area exceeds the visible diameter, and SHALL present at most two action controls beside the back affordance.
5. THE Mobile_Shell SHALL present exactly five destinations in the Hub_Set's left-to-right order, labelled `Browse`, `Contracts`, `Sell`, `Inbox` and `Account`, of which `Browse`, `Inbox` and `Account` navigate to one screen each — the catalog, the message inbox and the account screen — and `Contracts` and `Sell` open a sheet.
6. WHERE a Hub_Set entry opens a sheet on the web rather than navigating (`Contracts` and `Sell`), THE Mobile_Shell SHALL open a bottom sheet listing `Purchases`, `Sales` and `Trades` for `Contracts` and `Sell an item`, `My Listings` and `Offers` for `Sell`, and SHALL omit the web's `Private Deal` entry rather than present it inert, because private-deal invites remain with `.kiro/specs/mobile-parity/`.
7. THE Mobile_Shell SHALL render its destination labels at the `meta` level with that level's line-height, matching the `text-meta` the web's bottom nav applies, and SHALL set no size of its own on them.
8. THE Mobile_Shell SHALL stand exactly 56 logical pixels tall within 1 logical pixel, and SHALL add the bottom safe-area inset as padding below that 56 rather than counting the inset inside it.
9. WHILE a destination is the current one, THE Mobile_Shell SHALL colour that destination's icon with the `--iris-ink` token and its label with the `--foreground` token at semibold weight, and SHALL draw no selection indicator shape behind the icon, so that weight rather than colour alone marks the current destination.
10. WHILE a destination is not the current one, THE Mobile_Shell SHALL colour both its icon and its label with the `--muted-foreground` token at medium weight.
11. THE Mobile_Shell SHALL present all five destinations to an unauthenticated member in the same order and with the same labels as to an authenticated one, enabled rather than disabled or hidden, and SHALL give each authentication-gated destination a semantic label stating that sign-in is required.
12. IF an unauthenticated member selects one of the four authentication-gated destinations (`Contracts`, `Sell`, `Inbox`, `Account`), THEN THE Mobile_Shell SHALL navigate to sign-in carrying that destination as the post-sign-in target — the single screen for a navigating entry, and the first listed sheet destination for a sheet entry — and SHALL NOT open the sheet.
13. THE Mobile_Shell SHALL show a count badge on the `Inbox` destination sourced from the unread **message** count and not from the unread notification count, SHALL render a count of 1 to 99 as that number, SHALL render a count above 99 as `99+`, and SHALL show no badge while the count is zero or not yet resolved.
14. THE Golden_Test_Suite SHALL contain one golden for the Mobile_Shell per current destination across the five Hub_Set entries, one with no destination current, one for an unauthenticated member, and one with the `Inbox` badge at its capped `99+` form.
15. WHEN the active route changes, THE Mobile_Shell SHALL mark as current the one Hub_Set entry whose section owns that route under the same section rule the web applies in `isMarketplaceSectionActive`, where `Browse` owns the catalog, listing-detail and seller-profile screens, `Contracts` owns the purchases, sales and trades screens, `Sell` owns the create-listing, my-listings, listing-edit and offers screens, `Inbox` owns the conversation screens, and `Account` owns the profile, notifications, saved and staff screens.
16. IF the active route is owned by no Hub_Set entry, THEN THE Mobile_Shell SHALL present all five destinations in the not-current treatment of criterion 10 rather than marking the first destination current.
17. THE Mobile_Shell SHALL read no value that it does not render, clearing the `unused_local_variable` issue the analyzer baseline records against `widgets/common/bottom_nav_shell.dart:36`, so that Flutter_Analyzer reports at most 9 issues once this requirement is implemented.

### Requirement 5: Catalog and listing cards

**User Story:** As a buyer browsing on my phone, I want the app's catalog to present the same card, the same price treatment and the same badges as the website's, so that I can compare listings across the two without re-reading the layout.

#### Acceptance Criteria

1. THE catalog grid SHALL present two columns at every viewport width below 768 logical pixels, separated by the `tight` Spacing_Scale step on both axes and inset from the viewport edges by the `group` step, and SHALL size each tile to its own cover so the two columns stagger rather than align into rows, matching the web's below-`md` mosaic. The web's phone gutter literal of 6 logical pixels resolves to `tight` under the snapping table in `.kiro/specs/design-system/typography-spacing.md`.
2. THE listing card SHALL present its cover image at the aspect ratio the web derives from `items.image_dims`, SHALL fall back to a square when those dimensions are absent, and SHALL reserve that cover box and fill it with the `--muted` token until the image resolves, so that a tile's height does not change when the photo arrives.
3. THE listing card SHALL present the title at the `body` level in medium weight clamped to two lines, the category and the condition at the `body` level in the `--muted-foreground` token, and the price with the Semantic_Text_Role for a card price, being the currency symbol at the `body` level, the major units at the `head` level and the minor units at the `body` level, all in bold weight in the `--iris-ink` token. Location SHALL be absent from the card, as it is on the web's phone tile.
4. THE listing card SHALL draw its price with tabular figures, matching the `.display-value` treatment in `app/globals.css`.
5. THE listing card SHALL draw its watchlist control at 32 logical pixels of visible diameter, matching the web's phone size, and SHALL give it a hit area of at least 48 logical pixels on both axes without enlarging the visible diameter to reach it.
6. WHEN a member activates the watchlist control, THE listing card SHALL present the new state within 100 milliseconds and before the network call resolves, and SHALL restore the previous state together with an error indication that the change did not save IF the call fails or has not resolved within 10 seconds.
7. WHERE a listing is a binder or bulk listing, THE listing card SHALL carry a marker on its cover reading "Binder" at the `meta` level in medium weight in the `--mist` token on the `--obsidian` token at 75 percent alpha, SHALL prefix its price with an indicative "from" marker at the `meta` level, and SHALL state that nothing is held either on the tile or in the accessible label the tile carries.
8. THE listing card SHALL use the member-facing term "binder or bulk listing" and SHALL NOT use the internal term "shopfront".
9. THE catalog filter surface SHALL present exactly the filter dimensions the Flutter client already applies, being free-text search, category, condition, sort order and region; SHALL leave price bounds, include-sold, pagination, multi-select category, multi-select condition and the rating sort option absent rather than present and inert, those dimensions belonging to `.kiro/specs/mobile-parity/`; and SHALL NOT clear a dimension it does not present when a member applies it. The price-range slider that `filter_sheet.dart` presents today is read by nothing on apply and is therefore removed rather than restyled.
10. THE Golden_Test_Suite SHALL contain goldens at the two-column phone width for a single-listing card, a binder card, a reserved card, a sold card and a card with no cover image.
11. WHERE a listing is reserved, sold, or a binder or bulk listing whose owner has closed it, THE listing card SHALL draw a scrim over the whole cover in the `--obsidian` token at 45 percent alpha carrying one centred label at the `meta` level in semibold weight in the `--mist` token, reading RESERVED, SOLD or CLOSED for those three cases respectively, SHALL desaturate the cover by 35 percent, and SHALL draw the whole tile at 70 percent opacity. A binder or bulk listing SHALL never carry the RESERVED or SOLD label, because it is never reserved and never sold.
12. IF the cover image is absent or fails to load, THEN THE listing card SHALL fill the reserved cover box with the card-shaped empty treatment the web's `ListingPhotoEmpty` draws, carrying the listing title, and SHALL NOT draw a broken-image glyph, because a broken glyph reads as the client having failed rather than the listing having no photo.
13. WHEN the catalog filter surface of criterion 9 is implemented, THE Flutter_Analyzer SHALL report zero issues for `flutter_app/lib/features/listings/widgets/filter_sheet.dart`, clearing the two baseline `deprecated_member_use` issues at lines 146 and 147, so that the recorded baseline of 10 issues falls by two.

### Requirement 6: Listing detail

**User Story:** As a buyer deciding whether to buy, I want the app's listing page to disclose the same facts in the same order as the website's, so that I am not asked to commit on less information.

#### Acceptance Criteria

1. THE listing detail screen SHALL order its scrolling regions as the web does — gallery, then price and title, then condition and category, then seller disclosure, then description, then location — and SHALL place the actions region in a bar docked immediately above the Mobile_Shell, reserving that bar's height at the foot of the scroll so it covers no content, whenever the viewing member does not own the listing, the listing is open and the member holds no live contract on it, and inline as the last region of the scroll otherwise.
2. THE listing detail screen SHALL present the price with the Semantic_Text_Role for a hero price, SHALL resolve that role to the `display` level of the Type_Scale, and SHALL apply no larger level to any other text on the screen.
3. THE listing detail screen SHALL present the seller identity disclosure — the provider-verified legal name, or the fallback name where no document-verified one exists — with the `--trust` token, matching the web's verified treatment, and SHALL label it in text so that colour is not the only signal.
4. WHERE the seller's identity disclosure is absent, THE listing detail screen SHALL present the seller's display name and trading history — their rating on the 1-to-5 scale and the number of reviews behind it, or text stating there are none yet where that count is zero — in its place, SHALL present no empty or placeholder name row, and SHALL withhold the buy, offer and trade actions with text in their place stating that the seller cannot yet accept a purchase or a trade.
5. THE listing detail screen SHALL make the seller region navigate to that seller's public profile, or to the viewing member's own profile where they own the listing, so that its chevron is not a false affordance, and SHALL give that region a hit area of at least 48 logical pixels on both axes.
6. WHERE a description runs longer than 200 characters, THE listing detail screen SHALL present it clamped to four lines with a gradient fade and an expand control carrying both a label and a chevron and a hit area of at least 48 logical pixels on both axes, and SHALL present a description of 200 characters or fewer in full with neither fade nor expand control.
7. WHERE the listing is a binder or bulk listing, THE listing detail screen SHALL present the binder explanation at the `body` level with the caution treatment `app/globals.css` defines for `.cardtrade-warning` — the `--action-border` edge and the `--action` wash at the alphas that rule sets — and that explanation SHALL state that nothing is held until both members agree terms and SHALL use the member-facing term "binder or bulk listing" rather than "shopfront".
8. THE listing detail screen SHALL present exactly one primary action to a member who does not own the listing — buy on a single listing, browse on a binder or bulk listing, and sign-in carrying the listing as its post-sign-in target for an unauthenticated member — SHALL give it the `--action` fill, the `--action-foreground` label and the `--action-border` edge, because a pastel fill needs a defined edge to read as a control, and SHALL NOT present it disabled unless the reason is presented as text adjacent to it.
9. THE Golden_Test_Suite SHALL contain goldens for a single listing, a binder listing, a listing the viewing member owns, a listing viewed by an unauthenticated member, and a listing whose seller trades in a region incompatible with the viewing member's.
10. THE listing detail screen SHALL present the action set the web presents for the viewing member's role: edit and close-or-remove controls plus a link to each live contract against the listing for its owner, with no buy, offer, trade or watchlist control; and watch, message and buy for a signed-in non-owner, with offer and trade presented only on a single listing.
11. THE listing detail screen SHALL admit between 1 and 10 photos in its gallery, and SHALL mark the active photo with one page dot per photo plus an accessible label stating that photo's position and the total count, only while more than one photo is present.
12. WHERE the viewing member's trading region is incompatible with the seller's, THE listing detail screen SHALL present that incompatibility as advisory text adjacent to the actions region, SHALL leave every action enabled, and WHEN the member proceeds anyway SHALL surface the server's refusal, because the advisory text is disclosure and the orchestrator is the enforcement point.

### Requirement 7: Contract rooms

**User Story:** As a party to a live contract, I want the app's contract room to show the same progress, the same money and the same next action as the website's, so that the two clients cannot appear to disagree about what I owe or what happens next.

#### Acceptance Criteria

1. THE sale room and the trade room SHALL each present the regions the web contract room presents: header, progress rail, action card, detail rows, money table, timeline and conversation panel.
2. THE progress rail SHALL render every step label at the `meta` level of the Type_Scale, replacing the current 9-point labels, on a single line truncated with a trailing ellipsis where its column is narrower than the label, SHALL keep every step of the step list in one row of equal-width columns at a viewport width of 320 logical pixels rather than scrolling the row, wrapping it, or omitting a step, and SHALL disclose the step's full label and its detail line when the member activates that step's marker.
3. THE progress rail SHALL distinguish a done step, an active step, a pending step and a halted step from one another by shape as well as by colour — a tick for done, a filled marker for active, an unfilled marker for pending, a cross for halted — SHALL NOT mark a halted step with a tick, SHALL label the halted step with the outcome copy the step list carries for it, and SHALL mark every step after the halted step as not reached.
4. THE money table SHALL present one row per disclosed figure — for a sale, the item price, the shipping cost, the platform fee at its stated percentage, and the viewer's own total, being the amount charged for a buyer and the amount received for a seller; for a trade, the value of each side, the viewer's trade fee, and the collateral held against the viewer's card — and SHALL right-align every value and draw it with tabular figures so that the digits align down the column.
5. THE money table SHALL format every figure through `flutter_app/lib/core/money.dart`, SHALL present each fee, total and trade side value as the figure the server records on the contract where the contract carries one and otherwise as the figure the Advisory_Domain_Port returns, and SHALL NOT introduce a second formatting path, recompute a fee for display, or sum item values to derive a side value.
6. THE action card SHALL present exactly one primary action while the step list has an active step and no primary action while it has none, SHALL style the primary action as in Requirement 6 criterion 8, and SHALL present any secondary action as an outlined control.
7. WHERE collateral is described to a member, THE contract room SHALL call it "trade collateral", SHALL state that it is a temporary card hold released without a charge when the trade completes, and SHALL NOT describe it as escrow or name it with a Retired_Vocabulary term.
8. THE conversation panel SHALL use the shared `conversation_panel.dart` widget in both rooms, so that a message renders identically in a room and in a standalone thread.
9. THE Golden_Test_Suite SHALL contain, for the sale room and for the trade room, one golden in a pre-payment state (a sale in AGREEMENT, a trade in NEGOTIATING), one in an in-flight state (both in INSPECTION), one in a completed state, and one in a halted state (both CANCELLED).
10. THE progress rail and the action card SHALL render the ordered step list that the Advisory_Domain_Port of `domain/contract/cashSaleSteps.ts` and `domain/contract/tradeSteps.ts` — pinned to the TypeScript by `tests/unit/mobileDomainAgreement.test.ts` — returns for the contract's live facts, one column per step in the order returned, for each of the 13 Cash_Sale statuses and each of the 9 Trade_States, and SHALL NOT declare a step list in a Mobile_Screen.
11. IF the contract's status is one the Advisory_Domain_Port does not recognise, THEN THE contract room SHALL present the status the server reported, SHALL mark no step as done, active or halted, SHALL present no primary and no secondary action, and SHALL leave the header, money table, timeline and conversation panel readable rather than raising an error or defaulting to the first step.
12. THE Flutter_Analyzer SHALL report no `use_build_context_synchronously` issue for `flutter_app/lib/features/trades/screens/trade_room_screen.dart`, clearing the two baseline issues at lines 141 and 153 as Requirement 14 criterion 8 requires.

### Requirement 8: Forms and inputs

**User Story:** As a seller filling in a listing on my phone, I want the app's fields to look and behave like the website's, so that a form I have completed once on the web is familiar in the app.

#### Acceptance Criteria

1. THE Mobile_Theme SHALL give every text field a one-device-pixel resting border in the `--input` token, which is a darker value than `--border` because a field's edge is the only thing identifying it as a control.
2. WHILE a text field holds focus, THE Mobile_Theme SHALL draw its border in the `--ring` token at full opacity and SHALL leave the border width and the field's drawn bounds unchanged, so that taking focus does not reflow the fields around it.
3. THE Mobile_Theme SHALL render field text at the `lead` level and field labels and helper text at the `body` level.
4. THE Mobile_Theme SHALL render field helper text in the `--muted-foreground` token rather than at a smaller size, honouring the Subtext_Rule.
5. WHILE a field is invalid, THE Mobile_Theme SHALL draw that field's border in the `--destructive` token, SHALL render its message in the `--destructive` token at the `body` level immediately below that field and inside the same group as its helper text, and SHALL keep the message rendered until the field becomes valid.
6. WHEN a form validation failure concerns a field the Mobile_Screen presents, THE Mobile_Screen SHALL render that failure's message in the position criterion 5 gives it, SHALL expose the field as invalid to assistive technology with the message as that field's accessible description so that a screen reader reaching the field reads the two together, SHALL announce the message once when it first appears without moving focus off the field the member is editing, and SHALL NOT present the failure in a transient snack bar or toast.
7. THE Mobile_Theme SHALL draw every button and every text field at the visible height its size variant is given at mobile viewport width in Web_Token_Source, which is 40 logical pixels at its largest, SHALL give each a hit area of at least 48 logical pixels on both axes extended outside the drawn bounds as in Requirement 4 criterion 4 and Requirement 13 criterion 6, SHALL NOT inflate a drawn height to reach that hit area, and SHALL render a button label at the `body` level regardless of the button's size variant.
8. THE Mobile_Theme SHALL give the choice controls (chips, segmented buttons, radio rows) the `--accent` fill and `--accent-foreground` label in their selected state, matching the web's selected pair.
9. WHILE a control cannot be activated, THE Mobile_Theme SHALL fill it with the `--muted` token, draw its border in the `--muted` token, render its label in the `--muted-foreground` token, present no press feedback, and keep the drawn height and hit area criterion 7 gives it.
10. WHILE a control is awaiting the result of a server call, THE Mobile_Screen SHALL present that control with the criterion 9 treatment, SHALL present a progress indicator within the control's existing bounds rather than replacing or resizing the control, SHALL expose the control as busy to assistive technology, and SHALL return the control to its activatable state when the call returns, whether it succeeds or fails.
11. IF a server action returns a failure result, THEN THE Mobile_Screen SHALL retain every value the member entered, SHALL present the failure's message inline on the field whose name matches the field name the failure reports, per criteria 5 and 6, and SHALL present a form-level summary above the submit control only where the failure reports no field name or reports a field name the form does not present, keeping that summary rendered until the next submission.
12. THE Golden_Test_Suite SHALL contain goldens for a text field at rest, focused, invalid and disabled, for the primary, outlined and destructive buttons in their enabled, disabled and busy states, and for a form presenting a form-level summary.

### Requirement 9: Messages

**User Story:** As a member in a conversation, I want the app's thread to read like the website's, so that a quoted message looks the same wherever I read it.

#### Acceptance Criteria

1. THE message thread SHALL present each message body at the `body` level and each timestamp at the `meta` level, SHALL preserve the line breaks its author typed, SHALL wrap a body of up to 4000 characters onto as many lines as it needs without truncating any part of it, and WHILE the conversation holds no messages SHALL present a centred hint at the `body` level in the `--muted-foreground` token in place of the bubble list.
2. THE message bubble SHALL fill an own-message bubble with the `--primary` token and its text with `--primary-foreground`, and a counterparty bubble with the `--muted` token and its text with `--foreground`.
3. THE message bubble SHALL apply the `lg` radius from the Radius_Scale, SHALL occupy at most 82 percent of the viewport width and wrap its body rather than exceed that bound, and SHALL sit against the thread's trailing edge when the viewing member is its author and against the leading edge otherwise.
4. WHERE consecutive messages come from one author and are sent within five minutes of one another, THE message thread SHALL present them as one run separated by the `tight` step, SHALL separate one run from the next by at least the `group` step, SHALL present one timestamp at the `meta` level after the run's last bubble rather than one per message, and SHALL end a run at a change of calendar day or at a contract notice.
5. WHERE a message carries an attachment, THE message bubble SHALL present an image attachment as a thumbnail bounded to 224 logical pixels on both axes and cropped to fill rather than distorted, SHALL open that image at full size when the thumbnail is activated, SHALL present a non-image attachment as a row naming the file and its size, and WHERE the message carries no body text SHALL present the attachment with no body area and no placeholder line.
6. THE message composer SHALL render its field per Requirement 8, SHALL open at one line and grow with the draft to at most four lines before scrolling its own content, SHALL return to a shorter height as the draft shortens, SHALL accept no more than 4000 characters into the draft, and SHALL keep the send control at a hit area of at least 48 logical pixels on both axes.
7. IF a send fails, THEN THE message composer SHALL return the draft text and the staged attachment to the field, SHALL remove the unsent message from the thread, SHALL present an error beside the field stating what failed, and SHALL allow the same draft to be sent again without it being retyped.
8. THE conversation list row SHALL present the counterparty name at the `body` level in semibold, the message preview at the `body` level in the `--muted-foreground` token truncated to one line, and the relative time at the `meta` level, formatted as a just-now label below 45 seconds, whole minutes below one hour, whole hours below one day, whole days below one week, and an absolute day and month beyond one week.
9. WHILE a conversation has unread messages, THE conversation list row SHALL present its name and preview at semibold weight and SHALL present a marker carrying the unread count, labelled with that count for assistive technology, so that colour is not the only signal.
10. THE Golden_Test_Suite SHALL contain goldens for a thread containing an own message, a counterparty message, an attachment-only message, a run of consecutive messages from one author, and a thread holding no messages.

### Requirement 10: Profile, identity and payout surfaces

**User Story:** As a member setting up to sell, I want the app's verification screens to present the same two steps in the same order as the website's, so that I understand which gate I have passed.

#### Acceptance Criteria

1. THE profile screen SHALL present the same three sections the web presents under `/profile` — profile, verification and payouts — in that order and using the labels the web uses.
2. THE verification section SHALL present the identity step first and the payout step second, and SHALL derive each step's presented status from that step's own server-reported status alone, so that neither step's presentation is inferred from the other's.
3. THE verification section SHALL present each of the four combinations of the two steps as its own state: with neither step passed, both marked pending and the identity step named as the outstanding one; with the identity step passed and the payout step not, the identity step marked passed and the payout step marked pending, presented as a complete and valid state and not as an error or a warning; with the payout step passed and the identity step not, the payout step marked passed and the identity step marked pending and named as the outstanding one, again without an error or a warning; and with both steps passed, both marked passed and no step outstanding.
4. THE verification section SHALL colour a passed step with the `--trust` token and a pending step with the `--muted-foreground` token, and SHALL label each step's status in text as passed or pending, so that colour is not the only signal.
5. THE verification section SHALL state beside each step what that step unlocks — for the identity step, listing, selling and entering a trade; for the payout step, receiving money — and SHALL confine every mention of a photo identity document to the identity step's copy.
6. WHERE the Flutter client hands a step off to the website, THE verification section SHALL present the handoff as an explicit outbound action, SHALL name the website page it opens, and SHALL indicate that the action leaves the app.
7. WHEN the member returns to the app from a handoff, THE verification section SHALL re-read both steps' statuses from the server, SHALL present a step as passed only where that re-read reports it passed rather than because the handoff was opened or returned, and SHALL retain the last status the server reported together with a retry action where the re-read has not completed within 10 seconds.
8. THE profile screen SHALL present a listing, trade or sale count as a numeral only where that count has been read from server data, SHALL present no constant in a count's place, and SHALL present a non-numeric placeholder in that count's position while the count is loading or unavailable, so that a count which has not loaded is distinguishable from a count of zero.
9. THE Golden_Test_Suite SHALL contain one golden for each of the four combinations of the two steps named in criterion 3, and one golden for the profile screen with its counts still loading.
10. THE Flutter_Analyzer SHALL report no `use_build_context_synchronously` issue in `features/profile/screens/settings_screen.dart` once this requirement is implemented, clearing the baseline issue at line 118 of that file as Requirement 14 criterion 8 requires.

### Requirement 11: Empty, loading and error states

**User Story:** As a member on a slow connection, I want the app's waiting and empty states to look like the website's, so that a slow screen looks unfinished rather than broken.

#### Acceptance Criteria

1. THE loading state SHALL present a skeleton whose blocks occupy the position and size of the content they replace, matching the web's skeleton treatment, drawing one block per line of reading text at 0.9 times the font size of the Type_Scale level that line uses, so that replacing the skeleton with the loaded content moves no element by more than 1 logical pixel and leaves the list's scroll extent unchanged; and THE loading state SHALL exclude its blocks from the accessibility tree while announcing once per load that content is loading, without interrupting an announcement already in progress.
2. THE skeleton SHALL draw its blocks in the `--muted` token at 0.70 alpha, matching the web's skeleton fill, SHALL animate their opacity between 1.0 and 0.5 and back on a 2000-millisecond loop, and SHALL hold them static at 1.0 opacity while the platform reduce-motion setting is enabled.
3. THE empty state SHALL present an illustration excluded from the accessibility tree, a heading at the `subhead` level, an explanation at the `body` level in the `--muted-foreground` token, and at most one primary action; and WHEN it replaces the loading state, THE empty state SHALL announce its heading followed by its explanation.
4. THE error state SHALL present a heading, an explanation naming in member-facing terms which operation failed, and a retry action that reissues that operation without leaving the screen; THE explanation SHALL contain no payment-provider reference, no internal record identifier, no exception type and no stack trace; and WHEN the error state replaces content or a loading state, THE Mobile_Screen SHALL announce it, interrupting an announcement already in progress.
5. WHILE a list is refreshing in response to a pull gesture, THE Mobile_Screen SHALL keep the existing content visible, SHALL NOT present the skeleton of criterion 1, and SHALL report a failed refresh without replacing that content with the error state.
6. THE Mobile_Screen SHALL offer a pull-to-refresh gesture on every scrollable list that presents server data, including at least the catalog, the contracts list and the inbox, and SHALL ignore a further pull while a refresh it started is still in flight rather than issuing a second request.
7. THE Golden_Test_Suite SHALL contain goldens for the loading, empty, filtered-to-empty, error and offline states of the catalog, the contracts list and the inbox, each captured at a fixed point in the skeleton's pulse cycle so that the golden is deterministic.
8. IF the data a loading state stands in for resolves within 200 milliseconds of the request starting, THEN THE Mobile_Screen SHALL present the loaded content without having presented the skeleton, and once the skeleton has been presented THE Mobile_Screen SHALL keep it visible for at least 500 milliseconds before replacing it.
9. WHERE a list resolves to zero rows and at least one filter or search term is active, THE Mobile_Screen SHALL present a filtered-to-empty state naming the active filters or search term as the reason and offering exactly one action that clears them, and SHALL reserve the empty state of criterion 3 for a list that resolves to zero rows with no filter or search term active.
10. IF a request fails because the device has no network connectivity, THEN THE Mobile_Screen SHALL present the error state of criterion 4 with an explanation naming the lost connection rather than a server fault, SHALL retain any content already loaded rather than clearing it, and SHALL keep the retry action enabled while offline.

### Requirement 12: Iconography and typeface delivery

**User Story:** As a member, I want an icon in the app to be the same glyph as the icon on the website, so that the two clients do not appear to be drawn by different hands.

#### Acceptance Criteria

1. THE Flutter client SHALL draw its icons from the same family the web draws from, using the official [Hugeicons Flutter package](https://github.com/hugeicons/hugeicons-flutter) whose free tier supplies the stroke-rounded style the web's free set uses, at one stroke width of 1.75 on a 24-logical-pixel glyph box, declared once in `Mobile_Theme`, being the width the web's icon call sites pass.
2. WHERE a glyph the web uses is absent from the free Flutter tier, THE Flutter client SHALL substitute the nearest available glyph from the same family and SHALL record the substitution in the Icon_Map — a single module at `flutter_app/lib/core/icons.dart` that is the only place a Mobile_Screen names a glyph, holding one entry per icon giving the web glyph name, the Flutter glyph standing in for it, and one line of reason — and THE Token_Agreement_Test SHALL read the Icon_Map against the glyph names the web imports and SHALL fail on a Flutter glyph name that differs from its web counterpart with no Icon_Map entry, so that an undocumented substitution fails.
3. THE Flutter client SHALL remove the `lucide_icons` dependency, which is declared in `pubspec.yaml` and referenced in zero Dart files, and SHALL leave the Hugeicons package as the only icon dependency `pubspec.yaml` declares.
4. THE Token_Agreement_Test SHALL fail on a reference to a Material `Icons.` constant under `flutter_app/lib/features/**` or `flutter_app/lib/widgets/**`, once the icon migration is complete, except for a platform-conventional navigation glyph (a platform back chevron) that the Icon_Map records as a named platform exception, which THE Token_Agreement_Test SHALL accept only where that entry exists.
5. THE Flutter client SHALL bundle the Plus Jakarta Sans font files as assets rather than fetching them at runtime, covering exactly the four weights the web uses — 400, 500, 600 and 700 — so that the first paint on a device with no network uses the product typeface rather than the platform default.
6. THE Flutter client SHALL declare exactly one font family, matching the web's one-typeface rule, and SHALL NOT declare a monospace family.
7. THE Flutter client SHALL enable tabular figures for money and ledger values through the tabular- and lining-figure font features the web applies to its ledger figures, applied to the single family named in criterion 6 rather than through a second family.
8. THE Mobile_Theme SHALL define exactly five named icon sizes — 12, 14, 16, 20 and 24 logical pixels, being the web's `size-3`, `size-3.5`, `size-4`, `size-5` and `size-6` — and SHALL use 14 for an icon inside a button, as the web's button rule sets it; WHERE a Mobile_Screen renders an icon it SHALL name one of those five, and THE Token_Agreement_Test SHALL fail on a numeric icon size or stroke-width literal found under `flutter_app/lib/features/**` or `flutter_app/lib/widgets/**`.
9. IF the free Hugeicons Flutter tier supplies no same-family glyph for more than 10 per cent of the distinct glyph names the web imports across its 142 files, THEN THE Flutter client SHALL keep Material icons across every Mobile_Screen rather than render two icon families at once, and THE specification SHALL record in this requirement the measured shortfall, the date it was measured and the decision to drop icon parity, so that the drop is a recorded decision rather than a silent regression.
10. IF `Mobile_Theme` or a Mobile_Screen applies a font weight that criterion 5 does not bundle, THEN THE Token_Agreement_Test SHALL fail and name the weight, so that a missing face is a failure rather than a weight synthesised from the nearest bundled one.

#### Decision record for criterion 9 — icon parity is DROPPED

**Measured 2026-09-06. Criterion 9 has fired. Criteria 1, 2 and 4 are foreclosed and
must not be implemented; Material icons stay on every Mobile_Screen.**

Measured web set: **104** distinct glyph names imported from
`@hugeicons/core-free-icons` across **143** files under `components/**` and `app/**`
(the criterion's "142 files" figure is stale; the distinct-name count is unchanged at
104).

Candidate measured: the official Flutter package `hugeicons`, pinned exactly at
**1.1.7** (published 2026-05-12), added to `flutter_app/pubspec.yaml` for the
measurement only and removed again per the decision rule. Coverage was decided by the
Dart analyzer against a generated fixture referencing one member per web glyph, not by
reading documentation.

**Shortfall: 53 of 104 glyph names do not resolve — 51.0 per cent, against a 10 per cent
(11-glyph) threshold.** The threshold is exceeded five times over.

Missing (analyzer `undefined_getter`, all 53): `BadgeCheckIcon`, `BadgeXIcon`,
`BanknoteIcon`, `BellIcon`, `BellOffIcon`, `CalendarDaysIcon`, `CheckIcon`,
`CheckCheckIcon`, `ChevronDownIcon`, `ChevronLeftIcon`, `ChevronRightIcon`,
`ChevronUpIcon`, `CircleDotIcon`, `ExternalLinkIcon`, `EyeOffIcon`, `FileTextIcon`,
`FlaskConicalIcon`, `GavelIcon`, `HandshakeIcon`, `HeartIcon`, `ImageOffIcon`,
`ImagePlusIcon`, `InfoIcon`, `KeyRoundIcon`, `LinkIcon`, `LoaderCircleIcon`,
`LogInIcon`, `LogOutIcon`, `MailCheckIcon`, `MenuIcon`, `MessageCircleIcon`,
`MessageSquareIcon`, `MessageSquarePlusIcon`, `PackageCheckIcon`, `PackagePlusIcon`,
`PaperclipIcon`, `PencilLineIcon`, `PlusIcon`, `RefreshCwIcon`, `RotateCcwIcon`,
`ScaleIcon`, `ScanFaceIcon`, `SendIcon`, `SendHorizontalIcon`, `ShieldAlertIcon`,
`ShieldCheckIcon`, `TicketPercentIcon`, `TriangleAlertIcon`, `UserPlusIcon`,
`UserRoundIcon`, `UsersIcon`, `XIcon`, `ZoomInIcon`.

**Why the two free tiers are not the same set.** The design's Q2 predicted a shortfall
of roughly zero on the grounds that both free tiers are the stroke-rounded style. The
style is indeed the same; the **name sets are not**, and three measured facts explain
the gap:

1. The JS free package additionally ships **Lucide-compatible aliases** — `CheckIcon`,
   `PlusIcon`, `XIcon`, `BellIcon`, `HeartIcon`, `MenuIcon`, `InfoIcon`,
   `TriangleAlertIcon` — which the web took as its glyph vocabulary when it migrated off
   `lucide-react`. The Dart package exposes Hugeicons' native names only
   (`strokeRoundedTick01`, `strokeRoundedAdd01`, `strokeRoundedCancel01`,
   `strokeRoundedNotification01`, `strokeRoundedFavourite`, `strokeRoundedMenu01`,
   `strokeRoundedInformationCircle`, `strokeRoundedAlert02` all verified present). So
   most of the 53 are a naming divergence rather than a drawing that does not exist.
2. The tiers differ in size regardless: **5,159** free stroke-rounded members in Dart
   1.1.7 against **6,025** exports in JS `@hugeicons/core-free-icons` 4.3.0, and the
   package's own description says "4,700+". Some of the 53 have no counterpart at all —
   `strokeRoundedShieldTick` was probed and is absent.
3. The transform the design assumed does not exist either. The real public accessor is
   `HugeIcons.strokeRounded<PascalName>`; `HugeIconsStrokeRounded` is not exported from
   the package's entry library. And the members are `List<List<dynamic>>` SVG path data
   rendered by `HugeIcon` through `flutter_svg`, **not** `IconData` — so criterion 1's
   "one stroke width of 1.75 declared once in `Mobile_Theme`" and criterion 8's
   `IconTheme`-shaped sizing rule have no single place to live on this package, and the
   whole icon surface would move off `Icon`/`IconTheme`.

**Why a hand-authored mapping is not the escape hatch.** Criterion 2 admits substitution,
and 53 substitutions could in principle be hand-chosen. That is not what criterion 2
contemplates: it exists for the occasional absent glyph, not for half the set. 53
hand-picked, hand-reasoned entries is a per-glyph design exercise with 53 chances to pick
a drawing that means something slightly different from the web's, no mechanical check
behind any of them, and it buys an SVG-rendered icon layer in place of a font-rendered
one. Criterion 9 was written for exactly this outcome and it is unambiguous: keep
Material icons rather than render two families at once.

**Consequences, recorded so they are not rediscovered:**

- Task 10.2 is foreclosed. `flutter_app/lib/core/icons.dart` is **not** created, so
  Property P10 and the `dartIconMap` parser in `scripts/lib/mobileContract.ts` stay
  unexercised. The parser is kept — it is the check that would enforce parity if this
  decision is ever revisited — and it must not be repurposed to assert Material names.
- Criterion 4's ban on `Icons.` references under `flutter_app/lib/features/**` and
  `flutter_app/lib/widgets/**` is **void**; its condition ("once the icon migration is
  complete") is never met. The `materialIcon` and `glyphName` call-site scans stay
  measurement-only and must not be raised into failures.
- The `hugeicons` dependency was removed from `flutter_app/pubspec.yaml` in the same
  change that recorded this. Criterion 3's removal of the unreferenced `lucide_icons`
  dependency still stands on its own merits, but no Hugeicons package replaces it.
- Criteria 5, 6, 7 and 10 — the Plus Jakarta Sans bundling and one-family rule — are
  untouched by this decision. Task 10.3 proceeds.
- Icon parity is dropped from this spec's scope. If it is wanted later, the work is a
  reasoned 104-entry map against Hugeicons' native names, sized as its own feature, not
  a substitution clause on a visual-parity port.

### Requirement 13: Accessibility of the ported design

**User Story:** As a member using a screen reader or a larger system font, I want the restyled app to remain usable, so that a visual refresh does not cost me access to my own contracts.

#### Acceptance Criteria

1. THE Mobile_Theme SHALL pair every foreground token with each background token it is drawn on such that text below the Large_Text_Threshold achieves a Contrast_Ratio of at least 4.5 to 1, where that threshold is 24 logical pixels at any weight or 18.66 logical pixels at weight 700 or heavier, evaluated at a text scale factor of 1.0 so that the classification never depends on a member's setting. On the Type_Scale the 4.5 to 1 floor therefore applies to `meta`, `body`, `nav`, `lead`, `subhead`, and to `head` at any weight below 700.
2. THE Mobile_Theme SHALL pair each of the following with the background token it is drawn on such that the Contrast_Ratio is at least 3 to 1: text at or above the Large_Text_Threshold in criterion 1 (on the Type_Scale, `display` at any weight and `head` at weight 700 or heavier), every boundary that identifies a control, every focus indicator, and every icon or shape that carries state. A hairline that separates content without identifying a control is outside this set, as `Web_Token_Source` records for `--border` at 1.51 to 1 against `--background`; a field edge is inside it, which is why `--input` is a separate and darker token measuring 3.30 to 1.
3. THE Token_Agreement_Test SHALL measure the Contrast_Ratio of every pair the Mobile_Contract_Parser resolves as a foreground drawn on a background — each Semantic_Text_Role against every surface token `Mobile_Theme` declares it against, and each colour a Mobile_Screen applies to text, to a boundary or to a state-bearing graphic against the surface token of its nearest enclosing container — and SHALL fail on a pair below the floor criterion 1 or criterion 2 gives it, naming both tokens, the measured ratio and that floor.
4. IF the resolved pair set is empty, or omits a Semantic_Text_Role, a surface token or a Mobile_Screen colour that the Mobile_Contract_Parser has read, THEN THE Token_Agreement_Test SHALL fail naming what was read but not paired, so that the check cannot pass by measuring nothing.
5. WHERE a pair required by criterion 1 or criterion 2 measures below its floor using the `Web_Token_Source` values themselves, THE Mobile_Theme SHALL keep the `Web_Token_Source` value rather than diverge from it, and THE Token_Agreement_Test SHALL fail unless that pair appears in one recorded exception list carrying both token names, the measured ratio, the floor it misses and the reason `Web_Token_Source` states for the value, and SHALL fail on a recorded pair that measures at or above its floor so that the list cannot outlive the exception.
6. THE Mobile_Screen SHALL give every interactive element a hit area of at least 48 logical pixels on both axes that contains the element's visible bounds, independently of the element's visible size, and SHALL NOT let the hit area of one interactive element intersect the hit area of another, spacing adjacent controls apart where their 48-pixel areas would otherwise overlap.
7. THE Mobile_Screen SHALL give every interactive element that carries no visible text label an accessible label naming the action that element performs, and SHALL leave no interactive element with an empty accessible label.
8. WHEN an interactive element takes focus, THE Mobile_Screen SHALL draw a focus indicator on that element in the `--ring` token at full opacity, never at an alpha below 100 per cent, and SHALL scroll the element and its indicator fully into view.
9. THE Mobile_Screen SHALL order focus traversal to follow visual reading order, top to bottom and then leading to trailing, reaching every interactive element on the screen and no element that performs no action.
10. THE Mobile_Screen SHALL apply the system text scale factor up to a maximum of 2.0, so that a reported factor above 2.0 renders as 2.0, and at every factor it applies SHALL present each glyph of its reading text and each control label without clipping, without ellipsis and without layout overflow, reflowing onto additional lines where a line no longer fits.
11. THE Mobile_Screen SHALL convey every state it signals by colour or by animation with a second signal that persists without motion, being text, shape, weight or an icon, so that two states of the same element remain distinguishable when the rendering is reduced to greyscale.
12. WHILE the platform reduce-motion setting is enabled, THE Mobile_Screen SHALL apply the end state of a transition or state-change animation immediately rather than animating to it, matching the reduced-motion block in `Web_Token_Source`, which collapses durations to effectively zero and keeps the end state rather than dropping the state change.
13. THE Golden_Test_Suite SHALL contain, for each screen state it covers, one golden at a text scale factor of 1.0 and one at 2.0, both rendered at the same logical viewport size so that the factor is the only difference between the pair.

### Requirement 14: The scope boundary holds

**User Story:** As a maintainer, I want this presentation change to be provably a presentation change, so that a visual sweep cannot quietly become a second implementation of a money rule.

#### Acceptance Criteria

1. THE Flutter client SHALL contain exactly the Advisory_Domain_Port files that exist when this work begins — the eight rule modules under `flutter_app/lib/domain/` plus `flutter_app/lib/core/money.dart` — and THE Token_Agreement_Test SHALL fail and name the file IF a ninth rule module appears under `flutter_app/lib/domain/` or IF any of those files is removed.
2. THE Flutter client SHALL leave every assertion present in `tests/unit/mobileDomainAgreement.test.ts` and `tests/unit/mobileRpcContract.test.ts` when this work begins in force — no assertion deleted, no expected set narrowed, no case skipped or marked as expected to fail — and both files SHALL report zero failures under `npx vitest --run --project domain`, while an added assertion is permitted.
3. THE Flutter client SHALL add no Supabase RPC call, no insert, update, upsert or delete against any table `tests/unit/mobileRpcContract.test.ts` classifies as a contract table, and no route handler under the mobile write API, so that `npm run audit:mobile` reports no RPC call site and no contract-table write that is absent from its report at the start of this work.
4. THE Token_Agreement_Test SHALL fail, naming the file and the occurrence, IF any Retired_Vocabulary name (`Deal`, `DittoBond`, `KYC_Status`, `Police_Evidence_Pack`) or its plural appears under `flutter_app/` as a Dart identifier, a member-facing string literal, a route name, an asset name or a golden file name, matched as a whole word without regard to case or to word separators, so that copy compliance is a test result rather than an intention.
5. THE Mobile_Screen SHALL render every currency amount through `flutter_app/lib/core/money.dart`, and THE Token_Agreement_Test SHALL fail, naming the file, on a currency symbol literal or a hand-written minor-unit divisor found under `flutter_app/lib/features/**` or `flutter_app/lib/widgets/**`.
6. THE Flutter client SHALL add no capability that `.kiro/specs/mobile-parity/` lists as a gap, and SHALL leave every existing website handoff in `flutter_app/lib/core/web_handoff.dart` in place with no fewer call sites than it has when this work begins, styling the handoff affordance rather than replacing the handoff.
7. WHEN each requirement in this specification is implemented, THE Flutter_Analyzer SHALL report zero errors, no more than the 10 issues recorded in the Analyzer baseline below, and no issue whose file-and-rule-name pairing is absent from that table.
8. WHERE this specification modifies a file listed in the Analyzer baseline, THE change set that modifies it SHALL also clear that file's baseline issue, so that the recorded issue count only falls and never rises.
9. WHEN each requirement in this specification is implemented, THE `flutter test` command SHALL report zero failing tests and no test newly skipped or newly marked as expected to fail by that work.
10. WHERE a baseline analyzer issue reports a logic defect rather than a presentation defect — an issue whose fix changes which branch runs, which values are compared, or what a screen decides — THE specification SHALL record it in `.kiro/specs/mobile-parity/`, SHALL leave it listed in the Analyzer baseline, and SHALL name that specification as the owner of the functional gap list rather than restate its contents, because a type mismatch in a trade screen is not a styling change.
11. WHERE a Mobile_Screen needs a rule an Advisory_Domain_Port already evaluates, THE Mobile_Screen SHALL read that port and SHALL add no exported function, branch, threshold, constant or enum member to it, and THE Token_Agreement_Test SHALL fail and name the symbol IF an Advisory_Domain_Port gains an exported symbol that has no counterpart in the TypeScript module it is pinned to.
12. THE Flutter client SHALL introduce no conditional that decides eligibility, permission, a price or money amount, or a contract state, and WHERE a Mobile_Screen must vary its presentation on such a decision, THE Mobile_Screen SHALL take that decision from the server data it already receives or from an existing Advisory_Domain_Port, because a server that re-evaluates the rule is the only authority for it.
13. IF a change in this specification would require a credential that is not browser-safe, or a package that reads one, THEN THE Flutter client SHALL add neither the credential nor the package, SHALL leave the affordance as a website handoff, and SHALL record the gap in `.kiro/specs/mobile-parity/`, so that the app bundle continues to carry only the member session credential and the project's browser-safe key.

#### Analyzer baseline

`flutter analyze --no-pub` reports **10 issues** (9 info, 1 warning) at the time of writing:

| File | Issue |
| --- | --- |
| `domain/state_machine/machine.dart:13` | `unintended_html_in_doc_comment` |
| `features/listings/widgets/filter_sheet.dart:146,147` | `deprecated_member_use` — `Radio.groupValue` / `onChanged` |
| `features/profile/screens/settings_screen.dart:118` | `use_build_context_synchronously` |
| `features/trades/screens/propose_trade_screen.dart:152` | `unrelated_type_equality_checks` — `ItemStatus` compared to `String` |
| `features/trades/screens/trade_room_screen.dart:141,153` | `use_build_context_synchronously` |
| `services/api_client.dart:12` | `unintended_html_in_doc_comment` |
| `services/supabase_service.dart:18` | `deprecated_member_use` — `anonKey` |
| `widgets/common/bottom_nav_shell.dart:36` | `unused_local_variable` — `unreadCount` |

Two of these fall inside files this specification touches and are cleared by criterion 8: the `filter_sheet.dart` radio deprecation (Requirement 5 criterion 9) and the `bottom_nav_shell.dart` unused variable (Requirement 4). The `propose_trade_screen.dart:152` comparison of an `ItemStatus` against a `String` is always false and is a **logic defect**, so criterion 10 routes it out of this specification — into `.kiro/specs/mobile-parity/`, which owns the functional gap list.

**The table above is the baseline as recorded at the time of writing, and is retained as history. Every issue in it is now closed.** `flutter analyze` reports `No issues found!` — **0 issues, down from 10**, with nothing suppressed or allowlisted.

Criterion 10 routed the `propose_trade_screen.dart` issue OUT of this specification and required it to stay listed here while it existed; it did **not** assert that the warning would remain forever, and this specification never had authority to fix it. It was fixed in the spec that owns it: the file now declares a documented top-level predicate, `canOfferItemInTrade(item) => item.status == ItemStatus.available && item.listingKind == ListingKind.single`, comparing an enum to an enum and matching the website's own-item picker (`.eq('status','AVAILABLE').eq('listing_kind','SINGLE')`). The routing decision stands and was vindicated — establishing what the branch was meant to gate is precisely why it did not belong in a presentation spec. Criterion 10 requires a *live* logic defect to remain listed, not a fixed one to be re-listed, so criterion 7's ceiling and criterion 8's floor-only rule are both satisfied at 0. The `services/supabase_service.dart:18` `anonKey` deprecation closed the same way: `publishableKey` is a pure parameter rename over the same value, with `Env.supabaseAnonKey` and the `SUPABASE_ANON_KEY` define unchanged.

### Requirement 15: The verification harness

**User Story:** As a reviewer, I want a mechanical answer to "does the app match the web", so that agreement is a test result rather than an opinion formed from two screenshots.

#### Acceptance Criteria

1. THE Mobile_Contract_Parser SHALL expose parsers that read colour constants, font-size levels, spacing steps, radius values, shadow definitions and Semantic_Text_Role definitions from `Mobile_Theme`, each returning every entry it found as the declared identifier, the parsed value and the source line, so that a later comparison can name the entry it disagreed about.
2. IF the Mobile_Contract_Parser reaches a declaration inside a `Mobile_Theme` block it cannot reduce to a value, or locates a block that yields zero entries, THEN THE Mobile_Contract_Parser SHALL throw an error naming the file, the line and the offending text, and SHALL NOT skip the declaration, return a partial set, or return an empty set.
3. THE Mobile_Contract_Parser SHALL expose parsers that read the `fontSize`, `spacing`, `boxShadow` and `borderRadius` blocks of `tailwind.config.ts` and the `:root` colour variables of `app/globals.css`, returning each entry as its token name and its value in the unit the source states.
4. IF a `Web_Token_Source` block named in criterion 3 is absent, yields zero entries, or holds a value the parser cannot reduce to a number or an HSL triple, THEN THE Mobile_Contract_Parser SHALL throw an error naming the file, the block, the token and the offending text, so that a vacuous pass is impossible.
5. THE Mobile_Contract_Parser SHALL resolve `var(--token)` indirection to a literal HSL triple, and SHALL throw naming the token IF an alias chain is circular or does not terminate in a literal triple, because `--card-foreground`, `--popover-foreground` and `--ring` are declared as aliases and a parser that returned the alias text would compare a string against a colour.
6. THE Mobile_Contract_Parser SHALL report every size it reads in logical pixels, converting `rem` at 16 pixels per `rem`, reducing a `calc()` expression of the form `var(--token)` minus a pixel literal — the form `borderRadius` states `md` and `sm` in — and rounding to two decimal places, because `Web_Token_Source` states sizes in `rem` and in `calc()` while `Mobile_Theme` states them in logical pixels.
7. THE Mobile_Contract_Parser SHALL read each `boxShadow` entry as an ordered list of layers, each carrying its own horizontal offset, vertical offset, blur radius, spread and alpha, because `market` and `lift` each declare two layers and a parser that read only the first would miss the blur that criterion 9 of Requirement 3 bounds.
8. THE Token_Agreement_Test SHALL run inside the existing Vitest `domain` project and SHALL require no browser environment and no Flutter toolchain, so that `npx vitest --run --project domain` covers it on a machine that has never built the app.
9. THE Token_Agreement_Test SHALL cover each parser named in criteria 1 and 3 with a positive case asserting the entry count and values parsed from fixture source held beside the test, and with a negative case asserting that fixture source carrying a malformed declaration makes the parser throw, and SHALL fail IF a parser returns zero entries from the live sources, because an assertion over an empty set passes without checking anything.
10. THE Golden_Test_Suite SHALL run under `flutter test` with no additional command, SHALL hold its reference images in version control beside the tests under `flutter_app/test/golden/`, and SHALL perform its pixel comparison only on the single host platform this specification designates, skipping with a stated reason on any other host platform, because font rasterisation differs between platforms and a difference there is not a parity difference.
11. WHEN the Golden_Test_Suite renders a golden, THE Golden_Test_Suite SHALL hold the bundled font assets, the device pixel ratio, the logical surface size, the text scale factor and the clock at values declared in the test, SHALL build from fixture data rather than from a network or database read, SHALL advance every animation to its end state before capture, and SHALL compare at a tolerance of zero differing pixels, so that a re-run on the designated host platform reproduces the same image.
12. WHEN a change to `Mobile_Theme` or to a Mobile_Screen alters rendered output deliberately, THE Golden_Test_Suite SHALL be re-baselined by regenerating its reference images through the golden-update invocation of `flutter test` on the designated host platform, committing them in the same change as the code that moved them and naming each image that moved, and SHALL NOT have a reference image regenerated for a mismatch whose cause has not been identified as an intended change.
13. WHERE parity for a screen region cannot be established by a parser or a golden, THE specification SHALL enter that region in the manual-review register held in this specification's design document, naming the region, the web component it is compared against, and the attributes a reviewer compares, so that no region this specification covers is absent from all three of the parsers, the goldens and that register.
14. THE `.kiro/specs/design-system/typography-spacing.md` document SHALL be corrected so that its type-scale table lists all seven levels — `meta`, `body`, `nav`, `lead`, `subhead`, `head`, `display` — with the size and line-height `tailwind.config.ts` currently defines for each, SHALL record that this specification carries that same scale into `flutter_app/**` in place of that document's exclusion of `flutter_app/**`, and SHALL leave the Subtext_Rule and the Compact_Row_Rule stated no more permissively than they are today, because those two rules are the reason the scale exists and a correction that relaxes them removes the thing being ported.

---

## Correctness Properties

The tests below are stated in the form the implementation should assert them. Each is
labelled with whether property-based testing earns its cost, applying the decision guide:
a property test is worth it when behaviour varies meaningfully with input and the code
under test is ours.

### Property-based, with a generator

**P1 — Colour_Conversion round-trips.** For all hue in [0, 360), saturation in [0, 100] and
lightness in [0, 100], converting an HSL triple to a Dart `Color` and back recovers the
triple within a tolerance of one 8-bit channel step. This is the function the entire port
rests on, and behaviour genuinely varies with input: the achromatic branch, the six hue
sextants and the `l = 0` and `l = 100` boundaries are separate code paths. Round-trip
property (category 2).

**P2 — Contrast_Ratio is symmetric and bounded.** For all colour pairs, the ratio equals
the ratio of the pair reversed, lies in [1.0, 21.0], and equals exactly 1.0 when the two
colours are identical. Invariant and metamorphic properties (categories 1 and 4). Worth
generating because the luminance function has a piecewise branch at the 0.03928 threshold
that a hand-picked pair set will miss.

**P3 — Text scaling does not reduce a laid-out size.** For all text scale factors f1 < f2
in [1.0, 2.0], the laid-out height of a paragraph at f2 is greater than or equal to its
height at f1. Metamorphic property (category 4). Sample the factor rather than exhausting
it, because each case lays out a widget tree.

**P13 — Alias resolution terminates.** For all `var(--token)` chains the parser resolves,
resolution reaches a literal HSL triple or throws, and never loops. Termination property;
worth generating because a chain's depth and its cycles are exactly what a hand-written
fixture set fails to cover.

### Exhaustive table checks, where the domain is finite

Property-based testing buys nothing here — the input set is a fixed, enumerable list of
tokens, so enumerating it *is* the exhaustive check, and 100 random draws from a
28-element set would be strictly weaker.

**P4 — Token sets agree, in both directions.** Every `Web_Token_Source` colour, font size,
spacing step, radius and shadow has exactly one `Mobile_Theme` counterpart with an equal
value, and every non-deprecated `Mobile_Theme` token has exactly one `Web_Token_Source`
counterpart. Model-based agreement (category 5), and the same shape as
`regionCurrencyAgreement.test.ts`.

**P5 — Every Semantic_Text_Role resolves to exactly one Type_Scale level.** No role
introduces a size, and no role names two.

**P6 — The Spacing_Scale admits no half-steps.** Every spacing literal parsed out of
`flutter_app/lib/features/**` and `flutter_app/lib/widgets/**` is a member of the six-step
scale.

**P7 — No widget hard-codes a colour.** Every colour reference under
`flutter_app/lib/features/**` and `flutter_app/lib/widgets/**` resolves through
`Mobile_Theme`. `Colors.transparent` is the sole allowed literal, because it names an
absence rather than a colour. The current count to clear is 12 `Color(0x…)` literals
(`extensions.dart` ×2, `avatar.dart` ×8, `condition_badge.dart` ×2), 44 `Colors.white` and
8 `Colors.black`.

**P8 — Elevation blur is bounded by the web's largest.** No `Mobile_Theme` shadow declares
a blur greater than the largest blur in `Web_Token_Source`. This is the check that keeps
the retired 30px and 44px blurs from returning.

**P9 — Retired vocabulary stays absent.** Extends the existing assertion in
`mobileDomainAgreement.test.ts` to the strings this spec's copy changes introduce.

**P10 — Every icon is named from the Icon_Map.** No Mobile_Screen names a glyph directly
and no Flutter glyph differs from its web counterpart without an Icon_Map entry recording
the substitution. The enumerated set is the glyph names the web imports, which is a fixed
list read off the source, so a random draw from it would test a subset of what enumeration
already covers. (Req 12)

**P11 — Every applied font weight is bundled.** The set of weights `Mobile_Theme` and the
Mobile_Screens apply is a subset of the four bundled faces, so a missing face fails rather
than being synthesised. Four values on one side and a parsed set on the other: generating
inputs would invent weights nothing applies. (Req 12)

**P12 — Every parser reports a non-empty set from the live sources.** A parser returning
zero entries is itself a failure, because an assertion over an empty set passes without
checking anything. The parsers are a known list and each is asked once, so there is nothing
for a generator to vary. (Req 15)

### Not a property test

**Golden files.** A golden compares rendered pixels to a stored reference; it varies with
no input and 100 iterations find nothing that one does not. One golden per state.

**Font asset bundling.** Either the asset is declared and resolves, or it is not. A smoke
assertion.

**The `flutter analyze` and `flutter test` gates.** Single-execution commands.

**Whether the app "looks like" the web.** No mechanical check establishes this, and
pretending otherwise would be the vacuous pass that `scripts/lib/mobileContract.ts` is
written to refuse. Requirement 15 criterion 13 requires each such region to be named
against the web component it is judged against, and reviewed by a person.

---

## Open questions for review

These are decisions the requirements above have taken a position on, and which are worth
confirming before design rather than discovering during implementation.

1. **Is `flutter_app/lib/core/theme.dart`'s warm palette really dead, or is it in use
   somewhere deliberately?** This specification assumes the violet palette is the product
   and the warm one is stale. If the Flutter app is intentionally on a different palette,
   Requirement 1 is wrong at its root.
2. **Does the Hugeicons free Flutter tier cover the glyphs the web uses across 142 files?**
   Requirement 12 criterion 2 admits substitution, but if the shortfall is large the
   honest alternative is to keep Material Icons and drop icon parity from scope.
3. **How many screens should the Golden_Test_Suite cover?** The requirements name goldens
   per surface, which is roughly 40 files including the text-scale pairs. Goldens are cheap
   to run and expensive to maintain across a restyle; halving the set is a legitimate call.
4. **Should the retired-token aliases in Requirements 1.5 and 3.3 exist at all?** They
   allow the migration to land incrementally with a green analyzer. A single atomic change
   avoids the aliases entirely at the cost of one very large diff.
5. **Which host platform should the Golden_Test_Suite designate?** Requirement 15
   criterion 10 requires one, because font rasterisation differs between platforms and a
   difference there is not a parity difference. The development machine is Windows; CI is
   not yet decided. Designating Windows makes the suite runnable where the work happens but
   pins the reference images to the least common CI host.
