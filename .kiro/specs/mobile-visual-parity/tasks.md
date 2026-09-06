# Implementation Plan: Mobile Visual Parity

## Overview

Port the existing Flutter presentation layer to the web mobile design system in the design's Stage 0–9 order. Work remains presentation-only: no business rules, RPCs, contract-table writes, payment code, credentials, or additional Dart domain ports. The agreement harness is introduced before the generated theme port, but its live agreement assertions land only with that port so intermediate work is not intentionally red.

## Tasks

- [x] 1. Stage 0 — establish the agreement harness and source fixtures
  - [x] 1.1 Extend `scripts/lib/mobileContract.ts` with strict parsers and comparison helpers for CSS `:root` colours and aliases, imported Tailwind type/spacing/radius/shadow values, theme-layer declarations, call-site literals, contrast pairs, icon maps, aliases, and scope scans.
    - Return source file and line references; throw on absent, empty, malformed, circular, partial, or unrecognised input. Preserve the existing mobile RPC/domain parser behaviour.
    - Implement HSL/ARGB conversion, luminance, contrast, depth-aware shadow splitting, and bidirectional finding collection.
    - _Requirements: 1.2–1.4, 1.7–1.10, 2.3–2.10, 3.2, 3.5–3.13, 12.2, 12.4, 12.8, 13.1–13.5, 14.1–14.5, 15.1–15.7_
  - [x]* 1.2 Add valid and malformed parser fixtures under `tests/unit/fixtures/mobileTheme/` plus isolated fixture tests in `tests/unit/mobileThemeAgreement.test.ts`.
    - Assert positive entry counts/values and negative failures for every parser; live-source checks must require non-empty results but must not assert the still-unported palette agreement.
    - **Properties P1, P2, P12, P13:** colour conversion round-trips; contrast symmetry/bounds; every live parser is non-empty; alias resolution terminates or throws.
    - Verify: `npx vitest --run --project domain`.
    - _Requirements: 1.2, 13.1–13.3, 15.2, 15.4–15.9_
  - [x] 1.3 Correct `.kiro/specs/design-system/typography-spacing.md` to reflect all seven Tailwind-owned levels and their current size/line-height values, and record this spec as the deliberate Flutter port without weakening the Subtext_Rule or Compact_Row_Rule.
    - _Requirements: 2.1, 2.13–2.14, 15.14_
  - [x] 1.4 Add the Stage 0 agreement-harness test skeleton without live theme assertions that would be red before Stage 1; document the required Stage 1 activation point in the test.
    - Keep the harness Node-only in the Vitest `domain` project; do not require Flutter or a browser.
    - Verify: `npx vitest --run --project domain`.
    - _Requirements: 15.8–15.9_

- [x] 2. Stage 1 — generate and adopt the web-aligned theme layer
  - [x] 2.1 Create `scripts/generate-mobile-tokens.ts` and the `flutter_app/lib/core/theme/` layer (`tokens.g.dart`, type scale, text roles, metrics, elevations, tints, contrast pairs, app theme, barrel), retaining `flutter_app/lib/core/theme.dart` as its compatibility export.
    - Generate the 28 `AppColors` constants from `app/globals.css`; hand-write the seven type levels, six spacing steps, four radii, five icon sizes, three elevations, tints, declared contrast pairs, and the one light fully-tokenised `ThemeData`.
    - Put CSS-blur conversion only in `AppElevation.blurFromCss`; set body as the default, fields to `lead`, semantic roles to one level each, and money roles to tabular/lining figures.
    - _Requirements: 1.1, 1.7–1.10, 2.1–2.7, 2.11, 2.15–2.16, 3.1, 3.6–3.12, 8.1–8.4, 8.8–8.9, 12.1, 12.8, 13.1–13.5_
  - [x] 2.2 Rewrite all Flutter uses of repurposed `primary`, `secondary`, `muted`, and `accent` in `flutter_app/lib/features/**` and `flutter_app/lib/widgets/**` to their correct new semantic token or tint in the same change as the new theme.
    - Do not use aliases for identifiers whose meanings changed; replace hard-coded colours and semantic tints only with theme-layer values.
    - _Requirements: 1.1, 1.7–1.8, 3.13, 13.3_
  - [x] 2.3 Add measured marker-comment migration aliases in `migration_aliases.dart` for only still-referenced retired colours and spacing names; delete zero-reference `ditto`, `dittoLight`, `charcoal`, and unused `xl` outright.
    - Record starting counts and replacement targets. Use the design's machine-readable marker-comment convention, not `@Deprecated`, to preserve the analyzer ceiling.
    - _Requirements: 1.4–1.6, 1.11, 3.3, 14.7–14.8_
  - [x]* 2.4 Activate live theme agreement assertions in `tests/unit/mobileThemeAgreement.test.ts` together with the generated port.
    - **Properties P4, P5, P6, P7, P8:** bidirectional token agreement; text-role resolution; spacing membership; no widget hard-coded colours; bounded elevation blur.
    - Assert aliases ratchet only downward, screen `fontSize`/spacing/shadow scans are compliant, populated `ColorScheme` slots are tokenised, and declared contrast pairs meet their floors.
    - Verify: `npx vitest --run --project domain`; then run `flutter test` and `flutter analyze` from `flutter_app/`.
    - _Requirements: 1.2–1.11, 2.1–2.16, 3.1–3.13, 13.1–13.5, 15.1–15.9_

- [x] 3. Stage 2 — migrate shared presentation primitives before feature screens
  - [x] 3.1 Restyle shared primitives in `flutter_app/lib/widgets/common/`: avatars, condition/status badges, `price_display.dart`, `empty_state.dart`, `error_view.dart`, `conversation_panel.dart`, shared loading presentation, and shared cards to consume `AppTheme` roles, metrics, tints, borders, and elevations.
    - Replace `shimmer` usage with the specified opacity-pulse skeleton and preserve `core/money.dart` as the sole money formatter.
    - _Requirements: 1.7–1.8, 2.5, 2.13–2.14, 3.4, 3.10, 7.4–7.8, 9.1–9.5, 11.1–11.4, 14.5_
  - [x] 3.2 Add `flutter_app/lib/widgets/common/tap_target.dart` as the layout-neutral `RenderProxyBox` hit-test expansion primitive, and use shared field/button primitives to separate 40dp visible controls from 48dp hit areas.
    - Expose target rectangles for widget tests; do not substitute `SizedBox(48)` or a new policy layer.
    - _Requirements: 4.4, 5.5, 8.7, 13.6–13.9_
  - [x]* 3.3 Add shared Flutter widget/semantics tests for skeleton timing and geometry, placeholder stability, interactive hit rectangles, accessible labels/focus order, text-scale cap, and sanitised error output.
    - **Properties P3, P14, P19, P20, P21, P24:** nondecreasing text layout; stable placeholders; non-overlapping 48dp targets; complete ordered semantics; no internal error data; no overflow through 2.0 scale.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`.
    - _Requirements: 5.2, 8.5–8.11, 11.1–11.4, 11.8, 13.6–13.12, 14.5_

- [x] 4. Stage 3 — implement mobile chrome and shell
  - [x] 4.1 Rebuild the top chrome and `widgets/common/bottom_nav_shell.dart` around the five web Hub_Set destinations, active-route ownership, 54dp/compact chrome geometry, 56dp bottom navigation, guest sign-in targeting, sheets, and message-count badge behaviour.
    - Implement `Contracts` and `Sell` sheets only with already-supported destinations; omit inert private-deal UI. Clear the existing unread-count analyzer issue in the touched shell file.
    - _Requirements: 4.1–4.13, 4.15–4.17, 13.6–13.9, 14.6–14.8_
  - [x]* 4.2 Add shell route/interaction/semantics tests and shell golden test cases (all five current hubs, none current, guest, capped `99+` badge).
    - **Properties P15, P19, P20, P22, P23:** badge threshold; target geometry; semantic order; unknown route is neutral; Dart route-to-hub ownership agrees with the imported web helper.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`; verify web-side mapping/scans with `npx vitest --run --project domain`.
    - _Requirements: 4.13–4.16, 13.6–13.9, 15.10–15.11_

- [x] 5. Stage 4 — port catalog cards, filters, and listing detail
  - [x] 5.1 Migrate catalog grid, listing-card, watch control, and filter surface files under `flutter_app/lib/features/listings/` to the mobile mosaic, reserved cover, card price, binder/bulk disclosure, state overlays, optimistic watch behaviour, and supported filter set.
    - Remove the inert price-range control, keep unsupported dimensions absent, and clear `filter_sheet.dart`'s touched Radio deprecations.
    - _Requirements: 5.1–5.13, 13.6–13.12, 14.5–14.8_
  - [x] 5.2 Migrate listing detail screen/gallery/action-bar components to the prescribed region order, seller disclosure/fallback, advisory region copy, action sets, binder warning, description expansion, and gallery semantics.
    - Consume existing server data and existing handoffs only; do not implement eligibility or purchase/trade capability.
    - _Requirements: 6.1–6.12, 13.6–13.12, 14.6, 14.12_
  - [x]* 5.3 Add listing widget tests and goldens for required card/detail states.
    - **Properties P14 and P15:** image placeholder layout stability and description 200-character boundary behaviour.
    - Cover single/binder/reserved/sold/no-image cards and single/binder/owner/guest/region-mismatch details; add 1.0 and eligible 2.0 scale variants.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`.
    - _Requirements: 5.2, 5.10–5.12, 6.6, 6.9, 13.10, 13.13, 15.10–15.11_

- [x] 6. Resolve the blocking contract-room scope conflict before Stage 5
  - [x] 6.1 Record the Req 7.10 scope correction/resolution in the existing `.kiro/specs/mobile-parity/` artifact that owns functional gaps, cross-referencing this spec's design conflict section.
    - Move the missing server-provided step-plan/contract-data work to that existing functional scope; keep this feature limited to styling the existing room facts, unknown-status neutral presentation, and no newly declared step list in a Mobile_Screen where feasible.
    - Do not add a ninth Dart domain port, generated business-rule table, endpoint, RPC, contract-table write, or new business derivation.
    - Verify: `npm run audit:mobile`; `npx vitest --run tests/unit/mobileRpcContract.test.ts`; `npx vitest --run tests/unit/mobileDomainAgreement.test.ts`.
    - _Requirements: 7.10–7.11, 14.1–14.3, 14.6, 14.10–14.12_
  - [x] 6.2 Add/extend scope-guard assertions in `tests/unit/mobileThemeAgreement.test.ts` and the existing mobile-domain contract test only where needed to preserve the recorded resolution and retired-vocabulary coverage.
    - **Property P9:** retired vocabulary remains absent from Dart identifiers, strings, routes, assets, and golden names.
    - Verify: `npx vitest --run --project domain`; `npm run audit:mobile`; `npx vitest --run tests/unit/mobileRpcContract.test.ts`; `npx vitest --run tests/unit/mobileDomainAgreement.test.ts`.
    - _Requirements: 14.1–14.6, 14.11–14.13_

- [x] 7. Stage 5 — restyle contract rooms after the scope decision
  - [x] 7.1 Migrate sale/trade room presentation components (`trade_progress_rail.dart`, sale room, shared contract detail/money/action/timeline components) to the web rail, action-card, detail-row, money-table, and trade-collateral presentation.
    - Read existing server data and existing advisory ports only. Display unknown statuses neutrally with readable non-action regions. Clear `trade_room_screen.dart`'s two context-after-await diagnostics; leave the named `propose_trade_screen.dart` logic defect recorded for mobile-parity rather than changing it.
    - _Requirements: 7.1–7.9, 7.11–7.12, 13.6–13.12, 14.5, 14.8, 14.10–14.12_
  - [x]* 7.2 Add contract-room widget tests and goldens for sale/trade pre-payment, inspection, completed, cancelled, and unknown-status presentations.
    - **Property P22:** unrecognised statuses produce the neutral room with no done/active/halted step and no action.
    - Validate only the legally available presentation inputs; do not assert the unresolved all-status step-plan derivation from Req 7.10.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`.
    - _Requirements: 7.2–7.9, 7.11–7.12, 13.10, 13.13, 15.10–15.11_

- [x] 8. Stage 6 — port form controls and messages
  - [x] 8.1 Update shared form-field/button/choice-control surfaces and listing/trade/message form call sites for field states, inline server failures, busy/disabled treatment, focus semantics, and 40dp visible / 48dp hit-area behavior.
    - Retain entered values and use existing ActionResult field errors; do not alter validation or server action behaviour.
    - _Requirements: 8.1–8.12, 13.6–13.12, 14.12_
  - [x] 8.2 Migrate message thread/list/composer and `conversation_panel.dart` call sites for bubbles, runs, attachments, retry handling, composer bounds, relative time, and unread treatment.
    - Preserve existing transport and attachment flows; style only.
    - _Requirements: 9.1–9.10, 13.6–13.12, 14.5, 14.12_
  - [x]* 8.3 Add form/message widget tests and goldens for all required control and message states.
    - **Properties P16, P17, P18:** message-run partitioning; complete bounded message bubbles; monotonic bounded composer height. Include P15 relative-time boundary cases.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`.
    - _Requirements: 8.12, 9.1–9.10, 13.10, 13.13, 15.10–15.11_

- [x] 9. Stage 7 — port profile gates and async state surfaces
  - [x] 9.1 Update profile/verification/payout presentation files for the three-section order, independent Identity/Payout states, explicit web handoffs, server re-reads, and honest loading/unavailable counts.
    - Clear `settings_screen.dart`'s touched context-after-await diagnostic without changing gate semantics.
    - _Requirements: 10.1–10.10, 13.6–13.12, 14.6, 14.8, 14.12_
  - [x] 9.2 Complete catalog/contracts/inbox loading, empty, filtered-empty, error, offline, and pull-to-refresh presentation using shared state primitives and existing request sources.
    - Preserve loaded content on refresh/offline failure and add no new request capability.
    - _Requirements: 11.1–11.10, 13.6–13.12, 14.12_
  - [x]* 9.3 Add profile/state widget tests and required goldens with fixed skeleton phases.
    - **Properties P15 and P21:** skeleton 200ms suppression/500ms minimum boundaries; error explanations never expose provider references, IDs, exception types, or stack data.
    - Cover all four gate combinations, loading counts, and required catalog/contracts/inbox state variants at required text scales.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`.
    - _Requirements: 10.3, 10.9, 11.1–11.10, 13.10, 13.13, 15.10–15.11_

- [x] 10. Stage 8 — make the icon/family decision, then complete the chosen presentation path
  - [x] 10.1 Measure Hugeicons Flutter free-tier coverage before changing existing icon call sites.
    - Add the candidate package at an exact version in an isolated branch/task, enumerate the transformed names for all web glyph imports, compile a fixture that references each member, and record the measured shortfall/date in the appropriate existing spec requirement/decision record.
    - If missing glyphs are 11 or more of the measured web set (>=10%), record the required keep-Material-icons decision and remove the candidate dependency; do not begin a mixed-family migration. Otherwise proceed to 10.2.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`; verify map inputs with `npx vitest --run --project domain`.
    - _Requirements: 12.1–12.4, 12.9, 14.7, 14.13_
  - [-] 10.2 NOT APPLICABLE — foreclosed by 10.1's measurement. Conditional on shortfall below 10%, add `flutter_app/lib/core/icons.dart`, migrate all Mobile_Screen glyph references through it, and remove `lucide_icons` only after its Dart reference count is zero.
    - **Foreclosed 2026-09-06.** 10.1 measured 53 of 104 web glyph names missing against `hugeicons` 1.1.7 (51.0%), against a 10% threshold, so Req 12.9 fired and Material icons stay. `flutter_app/lib/core/icons.dart` is NOT created and the candidate dependency is NOT added. Decision record: Requirement 12, criterion 9 in `requirements.md` ("Decision record for criterion 9 — icon parity is DROPPED"). Property P10 and the `dartIconMap` parser stay unexercised by design.
    - Permit only the documented platform back-chevron exception; record every same-family substitution with its reason.
    - **Property P10:** every web glyph is represented by Icon_Map and no screen names a glyph directly.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`; verify `npx vitest --run --project domain`.
    - _Requirements: 12.1–12.4, 12.8–12.9_
  - [x] 10.3 Bundle the four Plus Jakarta Sans assets, declare one family in `pubspec.yaml`, migrate typography to it, and remove `google_fonts` and `shimmer` only after references are zero.
    - **Property P11:** every applied weight is one of 400/500/600/700 bundled faces; enforce no monospace or unbundled weights.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`; verify `npx vitest --run --project domain`.
    - _Requirements: 11.2, 12.5–12.7, 12.10_

- [x] 11. Establish deterministic golden infrastructure before committing reference images
  - [x] 11.1 Record the designated host decision as Windows and implement `GoldenHost.designated = TargetPlatform.windows` in `flutter_app/test/golden/_harness/golden_harness.dart` with the design's Linux-successor/regeneration comment.
    - Build `pumpGolden`, font loading, provider overrides, fixed device sizes/DPR/clock/text scale, reduce-motion default, zero-tolerance comparator, and explicit non-Windows skip reason before adding any `.png` references.
    - Verify from `flutter_app/`: `flutter test` and `flutter analyze`.
    - _Requirements: 11.2, 13.12–13.13, 15.10–15.12_
  - [x]* 11.2 Add the required golden reference files only after the harness and affected widget cases are stable, generating them on the designated Windows host and pairing 2.0-scale references wherever text/control labels can reflow.
    - Keep each reference next to its test, use fixtures only, and document the scoped `flutter test --update-goldens test/golden/<area>` re-baselining procedure in test comments.
    - _Requirements: 4.14, 5.10, 6.9, 7.9, 8.12, 9.10, 10.9, 11.7, 13.13, 15.10–15.12_

- [x] 12. Stage 9 — close the migration ratchet and perform final scope/regression verification
  - [x] 12.1 Remove every colour and spacing migration alias, then delete `migration_aliases.dart`, only after the agreement scanner reports zero Mobile_Screen references for each alias.
    - Do not delete an alias early and do not leave a zero-reference alias behind.
    - Verify: `npx vitest --run --project domain`; then from `flutter_app/`, `flutter test` and `flutter analyze`.
    - _Requirements: 1.6, 1.11, 3.3, 14.7–14.9_
  - [x] 12.2 Perform the final presentation-only regression and documentation audit.
    - Confirm the typography/spacing design-note correction remains accurate; clear baseline analyzer issues only in touched presentation files, retaining the explicitly out-of-scope logic issue in `.kiro/specs/mobile-parity/`; update the manual-review register only for coverage affected by delivered presentation work.
    - Run `npm run audit:mobile`, `npx vitest --run tests/unit/mobileRpcContract.test.ts`, `npx vitest --run tests/unit/mobileDomainAgreement.test.ts`, and `npx vitest --run --project domain`; then run `flutter test` and `flutter analyze` from `flutter_app/`.
    - _Requirements: 14.1–14.13, 15.13–15.14_

## Notes

- Tasks marked with `*` are optional test tasks. They remain scheduled because they carry the listed correctness properties and acceptance checks.
- Stage 5 is blocked by task 6.1. It must not be “solved” inside this visual spec with a ninth domain port, generated contract-plan table, endpoint, or new derivation.
- Task 10.1 is a blocking measurement gate. A Hugeicons shortfall of 10% or more records a keep-Material-icons decision; it does not permit mixing families.
- **10.1 measured 2026-09-06: 53 of 104 web glyph names missing (51.0%) against `hugeicons` 1.1.7. Req 12.9 fired, so task 10.2 is FORECLOSED — do not create `flutter_app/lib/core/icons.dart` and do not add the candidate dependency. The full decision record is under Requirement 12 criterion 9 in `requirements.md`. Task 10.3 (typeface) is unaffected and still proceeds.**
- Task 11.1 must precede all committed golden references. Golden regeneration is scoped to intended changes on Windows only.
- No task authorises changes to domain business logic, mobile API capabilities, contract writes, payments, credentials, or server handoffs.
- **Post-completion state, so the task text above is not misread as current.** Tasks 7.1 and 12.2 instruct this spec to leave the `propose_trade_screen.dart` logic defect recorded for `mobile-parity` rather than fix it. That instruction was followed and remains the correct account of what this spec did — but the defect itself is now **FIXED**, in the spec that owns it, along with the `anonKey` deprecation. `flutter analyze` reports `No issues found!` (0 issues, down from the 10-issue baseline); `flutter test` 903 passed / 1 skipped including 156 goldens; `npx vitest --run --project domain` 691 passed / 55 files. See §"Measured final state" in `design.md`. The theme-agreement file may need `--testTimeout=30000` on some machines — a runner limit, not a failure.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["2.3"] },
    { "id": 6, "tasks": ["2.4"] },
    { "id": 7, "tasks": ["3.1"] },
    { "id": 8, "tasks": ["3.2"] },
    { "id": 9, "tasks": ["3.3"] },
    { "id": 10, "tasks": ["4.1"] },
    { "id": 11, "tasks": ["4.2"] },
    { "id": 12, "tasks": ["5.1", "6.1"] },
    { "id": 13, "tasks": ["5.2", "6.2"] },
    { "id": 14, "tasks": ["5.3"] },
    { "id": 15, "tasks": ["7.1"] },
    { "id": 16, "tasks": ["7.2"] },
    { "id": 17, "tasks": ["8.1"] },
    { "id": 18, "tasks": ["8.2"] },
    { "id": 19, "tasks": ["8.3"] },
    { "id": 20, "tasks": ["9.1"] },
    { "id": 21, "tasks": ["9.2"] },
    { "id": 22, "tasks": ["9.3", "10.1"] },
    { "id": 23, "tasks": ["10.2"] },
    { "id": 24, "tasks": ["10.3"] },
    { "id": 25, "tasks": ["11.1"] },
    { "id": 26, "tasks": ["11.2"] },
    { "id": 27, "tasks": ["12.1"] },
    { "id": 28, "tasks": ["12.2"] }
  ]
}
```