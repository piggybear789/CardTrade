# UX Design Audit Report — CardTrade Flutter App

**Scope:** Full audit of the Flutter mobile app (86 Dart files, ~12,300 LOC)  
**Source:** All 15 key screen files, 12 shared widget files, router, providers  
**Interface type:** Peer-to-peer marketplace (listings, trades, cash sales, messaging, profiles)  
**Framework:** Flutter + Material 3, Riverpod, go_router, Supabase

---

## How to Read This Report
Findings are rated on a 0–4 severity scale (4 = users can't complete tasks, 1 = cosmetic only). Each finding references an established usability principle. Start from the top — the most impactful issues are listed first.

---

## Summary

| Severity | Count |
|----------|-------|
| 4 - Catastrophe | 2 |
| 3 - Major | 8 |
| 2 - Minor | 10 |
| 1 - Cosmetic | 5 |
| **Total findings** | **25** |

---

## Quick Wins
The highest-impact issues that are also straightforward to fix:
1. **Touch targets below 48dp** (Severity 4) — Wrap small icons in `SizedBox(48×48)` with `InkWell`
2. **Float precision money bug** (Severity 4) — Replace `double.tryParse * 100` with integer-only parsing
3. **Missing condition validation** (Severity 3) — Add null check before form submit
4. **Progress rail 9px labels** (Severity 3) — Increase to minimum 11px
5. **Offers counter asks for cents** (Severity 3) — Change to dollar input with cents conversion

---

## Findings

### [Severity 4] Touch targets below Material 3 minimum (48dp)

- **Principle:** Accessibility (13), Tolerance and Forgiveness (15)
- **Location:** Multiple files:
  - `listing_card.dart` — Heart overlay: `Container(padding: 6) + Icon(size: 18)` = ~30dp
  - `listing_detail_screen.dart` — Back button: `CircleAvatar(radius: 18)` = 36dp
  - `create_listing_screen.dart` — Image remove: `Container(padding: 2) + Icon(size: 14)` = ~18dp
  - `my_profile_screen.dart` — Camera overlay: `Container(padding: 6) + Icon(size: 16)` = ~28dp
  - `sign_up_screen.dart` — Terms checkbox: `SizedBox(24×24)` = 24dp
- **Issue:** Five distinct interactive elements are significantly below the 48dp minimum touch target required by Material 3 accessibility guidelines. Users with motor impairments, large fingers, or who are using the device one-handed will consistently miss these targets.
- **User impact:** Users will accidentally navigate to listing detail when trying to tap the heart, accidentally remove the wrong image, struggle to toggle terms acceptance, and miss the back button — causing frustration and incorrect actions.
- **Fix:** Wrap all small interactive elements in a minimum 48×48dp hit area using `SizedBox(width: 48, height: 48)` containing an `InkWell` or `IconButton` with appropriate padding. For the checkbox, use `Checkbox` widget which enforces minimum hit area automatically.

---

### [Severity 4] Float precision bug in FMV/price input

- **Principle:** Error Prevention (5)
- **Location:** `create_listing_screen.dart` — price conversion logic
- **Issue:** The FMV field uses `double.tryParse(value) * 100` to convert dollars to cents. Floating-point arithmetic produces precision errors: `19.99 * 100 = 1998.9999...` which truncates to `1998` cents instead of `1999`.
- **User impact:** Sellers listing at common prices ($19.99, $9.95, etc.) will have their listing stored at 1 cent less than intended. Over thousands of listings and 5% platform fee, this creates cumulative financial errors. This is exactly the kind of money bug the web app's `domain/` layer explicitly prevents by using integer cents end-to-end.
- **Fix:** Parse as string manipulation: split on decimal, parse whole and fractional parts separately, combine as `(whole * 100) + fractional`. Or use `(double.parse(value) * 100).round()` which handles the rounding correctly for 2-decimal currency inputs.

---

### [Severity 3] No Semantics on custom interactive widgets

- **Principle:** Accessibility (13)
- **Location:** Systemic across:
  - `catalog_screen.dart` — Region pill (`GestureDetector`, no label)
  - `listing_card.dart` — Heart overlay, entire card
  - `listing_detail_screen.dart` — Description expand, seller card
  - `my_profile_screen.dart` — Camera avatar overlay
  - `trade_room_screen.dart` — Status banner, action area
- **Issue:** Multiple custom interactive elements use bare `GestureDetector` without `Semantics` wrappers. Screen readers (TalkBack/VoiceOver) cannot identify these as buttons or describe their purpose.
- **User impact:** Visually impaired users cannot use the watchlist, navigate via region, expand descriptions, change avatars, or identify interactive areas — effectively making large portions of the app unusable for them.
- **Fix:** Wrap each `GestureDetector` in `Semantics(button: true, label: 'descriptive label', child: ...)` or replace with `InkWell` + `Tooltip`.

---

### [Severity 3] Missing condition validation allows crash

- **Principle:** Error Prevention (5)
- **Location:** `create_listing_screen.dart` — submit logic
- **Issue:** The `_selectedCondition` state variable defaults to `null` and is used with `!` null-assertion on submit (`_selectedCondition!`). There is no form validator or null check, so submitting without selecting a condition will throw a `Null check operator used on a null value` exception, crashing the screen.
- **User impact:** Users who skip the condition chips and tap "Publish" get an unhandled exception — the app freezes or shows a generic error with no indication of what went wrong.
- **Fix:** Add a null check in the submit handler: `if (_selectedCondition == null) { context.showError('Please select a condition'); return; }` — or better, add inline validation by making the condition section show an error border.

---

### [Severity 3] Progress rail step labels at 9px are unreadable

- **Principle:** Perceptibility (14)
- **Location:** `sale_room_screen.dart` — `_SaleProgressRail` widget, also `trade_progress_rail.dart`
- **Issue:** Step labels in the progress rail use `fontSize: 9` which is below the minimum legible text size on mobile (11–12sp per Material guidelines). On high-density screens this renders at roughly 2mm physical height.
- **User impact:** Users cannot read which stage their transaction is in, defeating the purpose of the progress indicator. They must rely on the status banner alone, losing context about the overall flow.
- **Fix:** Increase to `fontSize: 11` minimum. If horizontal space is constrained, show only the current + adjacent step labels, or switch to an icon-based stepper with tooltip labels.

---

### [Severity 3] Offers counter input asks for cents instead of dollars

- **Principle:** Match Between System and Real World (2)
- **Location:** `offers_screen.dart` — counter-offer input field
- **Issue:** The counter-offer amount field has hint text "Counter amount (cents)" and submits the raw integer value. Users think in dollars, not cents. The web app formats display as dollars and converts internally.
- **User impact:** Users entering "50" thinking they mean $50 will actually counter-offer at $0.50. Or users entering "5000" for $50 creates confusion and requires mental math. Either outcome leads to incorrect offers that may be accidentally accepted.
- **Fix:** Change input to dollar format with a `$` prefix, parse with the same pattern as the create listing screen (with the float precision fix), and show a live preview: "Your counter-offer: $50.00".

---

### [Severity 3] Seller card chevron is misleading affordance

- **Principle:** Affordances and Signifiers (11)
- **Location:** `listing_detail_screen.dart` — seller info card
- **Issue:** The seller card displays a trailing chevron icon (`Icons.chevron_right`) which universally signals "tap to navigate". However the card has no `onTap` handler — it's purely static display.
- **User impact:** Users repeatedly tap the seller card expecting to see the seller's profile, get no response, and assume the app is broken. This is a common frustration pattern — false affordance is worse than no affordance.
- **Fix:** Either (a) make the card tappable and navigate to `/sellers/${sellerId}`, or (b) remove the chevron. Option (a) is clearly better — users want to check seller reputation before buying.

---

### [Severity 3] Report button shows instant fake success

- **Principle:** Visibility of System Status (1), Error Prevention (5)
- **Location:** `listing_detail_screen.dart` — report action
- **Issue:** The "Report this listing" button immediately shows a success snackbar ("Report submitted") without actually calling any API or collecting report details. There's no reason input, no confirmation, no server call.
- **User impact:** Users believe they've reported problematic content but nothing actually happens. Legitimate safety reports are silently lost. This also trains users not to trust platform safety mechanisms.
- **Fix:** Implement a proper report flow: show a bottom sheet asking for reason (dropdown) + optional details (text field), then submit to the API. Show loading state and real success/error feedback.

---

### [Severity 3] Region pill has no ripple feedback or semantic label

- **Principle:** Affordances and Signifiers (11), Accessibility (13)
- **Location:** `catalog_screen.dart` — region indicator
- **Issue:** The region pill uses a bare `GestureDetector` wrapping a `Container` with no `InkWell` or `Material` — meaning there's no touch ripple/splash to indicate the tap was registered. Additionally, no `Semantics` label tells screen readers this is a button or what it does.
- **User impact:** Sighted users tap the pill and see no visual confirmation for the 100ms before the dialog appears. They may double-tap thinking the first tap failed. Blind users cannot discover or activate this control.
- **Fix:** Replace `GestureDetector` with `InkWell(borderRadius: ...)` wrapped in `Semantics(button: true, label: 'Change browse region, currently Australia')`.

---

### [Severity 3] Conversation panel duplicated across rooms

- **Principle:** Consistency and Standards (4)
- **Location:** `trade_room_screen.dart` (~100 lines), `sale_room_screen.dart` (~100 lines)
- **Issue:** The conversation panel (message list + input + send logic) is copy-pasted between trade room and sale room with minor differences. Each has its own `_MessageBubble` implementation that differs from the shared `MessageBubble` widget used in `conversation_detail_screen.dart`.
- **User impact:** Inconsistent message display between the contract rooms and standalone conversations. Bugs fixed in one location won't be fixed in the other. Users may notice subtle visual differences in how their messages appear.
- **Fix:** Extract to a shared `ConversationPanel` widget in `widgets/common/` that accepts `conversationId` and handles its own stream subscription, matching the pattern already established in `conversation_detail_screen.dart`.

---

### [Severity 3] No confirmation for destructive trade actions

- **Principle:** Error Prevention (5), User Control and Freedom (3)
- **Location:** `trade_room_screen.dart` — action card buttons
- **Issue:** "Cancel Trade" correctly shows a confirmation dialog, but "Report Handover Failed" and "Raise Dispute" (both irreversible, high-consequence actions) fire immediately on tap without any confirmation.
- **User impact:** A user who accidentally taps "Report Handover Failed" freezes their trade with no undo path. A user who taps "Raise Dispute" starts a formal process they may not have intended. Both cause real financial and relationship consequences.
- **Fix:** Add `ConfirmationDialog.show()` (already available) before executing `reportHandoverFailed` and `raiseDispute` actions. Use the danger variant for dispute.

---

### [Severity 2] No pull-to-refresh on notifications and offers

- **Principle:** User Control and Freedom (3)
- **Location:** `notifications_screen.dart`, `offers_screen.dart`
- **Issue:** These screens load data once on build but provide no way to manually refresh. Users who know new data exists (they received a push notification) must leave and re-enter the screen to see updates.
- **User impact:** Users feel the app is stuck or stale when they can't pull-to-refresh, a universal mobile gesture they expect everywhere.
- **Fix:** Wrap the ListView in `RefreshIndicator` and invalidate the relevant provider on refresh. Same pattern already used in catalog screen.

---

### [Severity 2] No share action on listing detail

- **Principle:** Flexibility and Efficiency (7)
- **Location:** `listing_detail_screen.dart`
- **Issue:** There's no way to share a listing with others (social media, messaging apps, copy link). Marketplace listings are inherently shareable content.
- **User impact:** Users who find interesting items cannot easily share them, reducing organic growth and word-of-mouth. They must screenshot and manually describe the listing.
- **Fix:** Add a share `IconButton` in the app bar. Use `share_plus` package (already in pubspec) to share a deep link URL.

---

### [Severity 2] Quick stats hardcoded to 0

- **Principle:** Visibility of System Status (1)
- **Location:** `my_profile_screen.dart` — stats row
- **Issue:** The "Listings", "Trades", and "Sales" stat counters are hardcoded to `0` instead of fetching real data.
- **User impact:** Users see zeros regardless of their actual activity, making the stats useless and potentially concerning (did my data disappear?).
- **Fix:** Add providers that count the user's items, completed trades, and completed sales, and wire them to the stats display.

---

### [Severity 2] Terms checkbox error via SnackBar not inline

- **Principle:** Error Recovery (9)
- **Location:** `sign_up_screen.dart` — terms validation
- **Issue:** If the user doesn't check the terms checkbox, the error appears as a transient SnackBar at the bottom of the screen rather than inline next to the checkbox. SnackBars auto-dismiss and the user may not connect the message to the checkbox.
- **User impact:** Users see "Please accept terms" flash and disappear, can't figure out what to fix because the checkbox isn't visibly marked as invalid, then get frustrated trying to submit repeatedly.
- **Fix:** Add an inline error message below the checkbox row (`Text('Required', style: TextStyle(color: AppTheme.danger, fontSize: 12))`) that appears when submission attempted without acceptance.

---

### [Severity 2] Magic link doesn't validate email format

- **Principle:** Error Prevention (5)
- **Location:** `sign_in_screen.dart` — magic link button
- **Issue:** The "Send magic link" button only checks that the email field is non-empty (`text.isEmpty`) but doesn't validate email format. A typo like "user@gmailcom" will submit successfully to Supabase which silently fails to deliver.
- **User impact:** Users with typos wait for a link that never arrives, blame the app, and eventually abandon.
- **Fix:** Apply the same email validation (contains `@` and `.`) as the sign-in button does before calling `sendMagicLink`.

---

### [Severity 2] "Mark all read" has no loading state

- **Principle:** Visibility of System Status (1)
- **Location:** `notifications_screen.dart` — app bar action
- **Issue:** "Mark all read" fires the API call with no loading indicator, no disabled state on the button, and no success/error feedback. The user doesn't know if it worked.
- **User impact:** Users tap, nothing visibly changes (unread dots disappear after provider invalidation which may take a beat), tap again thinking it failed, potentially sending duplicate requests.
- **Fix:** Show a brief loading indicator, then success SnackBar, and disable the button while processing. Or optimistically update the UI immediately and revert on error.

---

### [Severity 2] Messages badge may show wrong count

- **Principle:** Match Between System and Real World (2)
- **Location:** `bottom_nav_shell.dart` — Messages tab badge
- **Issue:** The badge reads `unreadNotificationCountProvider` which counts ALL unread notifications (offers, trades, sales, system), not just unread messages. A user with 5 offer notifications will see "5" on the Messages tab.
- **User impact:** Users navigate to Messages expecting unread conversations, find nothing new, lose trust in the badge accuracy, and start ignoring it.
- **Fix:** Create a dedicated `unreadMessagesCountProvider` that counts unread messages specifically, and use that for the Messages tab badge.

---

### [Severity 2] Description expand has no visual affordance

- **Principle:** Affordances and Signifiers (11)
- **Location:** `listing_detail_screen.dart` — description section
- **Issue:** Long descriptions are truncated and a "Read more" text link appears, but there's no chevron, icon, or visual indicator that the section is expandable. The "Read more" text is styled the same as regular body text with only color difference (accent).
- **User impact:** Users may not notice the content is truncated, especially if the cut-off happens mid-sentence. They miss important listing details because the expand control is too subtle.
- **Fix:** Add a fade gradient at the truncation point and make "Read more" more prominent — either as a Row with `Icon(Icons.expand_more)` or a small `TextButton.icon`.

---

### [Severity 2] No optimistic updates for watchlist toggle

- **Principle:** Visibility of System Status (1)
- **Location:** `listing_card.dart`, `listing_detail_screen.dart` — heart/save toggle
- **Issue:** Tapping the heart icon makes an API call and only updates the UI after the server responds. On slow connections, the heart appears non-responsive for several hundred milliseconds.
- **User impact:** Users tap the heart, see no immediate change, tap again (undoing the action), end up confused about whether the item is saved or not.
- **Fix:** Immediately toggle the heart state locally (optimistic update), then make the API call. If it fails, revert and show an error.

---

### [Severity 1] Icon-only empty state illustrations

- **Principle:** Aesthetic and Minimalist Design (8)
- **Location:** `empty_state.dart`, used across all list screens
- **Issue:** Empty states use only `Icon(IconData, size: 64)` which feels utilitarian and generic. Modern apps (Xianyu, eBay) use friendly illustrations or branded imagery for empty states.
- **User impact:** The app feels less polished and professional. Empty states are missed opportunities for engagement (encouraging first actions).
- **Fix:** Support an `imagePath` parameter for SVG/PNG illustrations alongside the icon fallback. Add a set of branded empty state illustrations in `assets/images/empty_states/`.

---

### [Severity 1] Sign-up stays on same screen after success

- **Principle:** Visibility of System Status (1)
- **Location:** `sign_up_screen.dart` — post-submit behavior
- **Issue:** After successful registration, a SnackBar shows "Check your email" but the user remains on the sign-up form with all fields still filled. No navigation to a confirmation screen or sign-in.
- **User impact:** Users are momentarily confused — "did it work? should I do something else?" The form being visible with data suggests they should submit again.
- **Fix:** After success, either navigate to a dedicated "check your email" confirmation screen, or navigate to sign-in with a pre-filled email and a success banner.

---

### [Severity 1] No "show password" before typing

- **Principle:** Recognition Over Recall (6)
- **Location:** `sign_in_screen.dart`, `sign_up_screen.dart` — password fields
- **Issue:** Password visibility toggle only appears after the user has typed (icon button). There's no indication before typing that the toggle exists, so some users may not discover it.
- **User impact:** Minor — most users know to look for an eye icon. But first-time users of the app may not immediately realize they can reveal their password if they make a typo.
- **Fix:** Show the visibility toggle icon (in disabled/muted state) even when the field is empty, so users know the option exists. This is a common M3 pattern.

---

### [Severity 1] Inconsistent use of SnackBars for errors

- **Principle:** Consistency and Standards (4)
- **Location:** Auth screens, create listing screen, trade room
- **Issue:** Some screens show errors as SnackBars (auto-dismiss), some show them inline in the form, and the trade room uses `context.showError()` extension. The behavior is mostly consistent but the error persistence varies — form validation is persistent until fixed, but server errors disappear after 4 seconds.
- **User impact:** Minor inconsistency. Users can usually read the error in time, but on longer error messages the SnackBar may dismiss before they finish reading.
- **Fix:** Standardize: use inline errors for form validation (persistent), SnackBars for action confirmations (transient), and a persistent error banner for server/network errors that require user action.

---

### [Severity 1] Color-only status indicators

- **Principle:** Accessibility (13), Perceptibility (14)
- **Location:** `status_badge.dart`, unread dots in notifications, progress rail
- **Issue:** Status is communicated primarily through color (green=complete, red=error, blue dot=unread). While text labels usually accompany the color, the unread dot in notifications and the progress rail active dot rely on color alone.
- **User impact:** Users with color vision deficiency (8% of males) may not distinguish between active/complete states or notice the unread indicator.
- **Fix:** Add secondary indicators: fill/outline difference, size difference, or a small icon inside colored dots. For unread, bold text already helps — ensure the dot isn't the only signal.

---

## Strengths

1. **Consistent async state handling** — Every data-dependent screen uses `AsyncValue.when(loading: ..., error: ..., data: ...)` providing universal loading, error, and empty states. Users always know what's happening.

2. **Material 3 component usage** — The app correctly uses `NavigationBar`, `FilledButton`, `SearchBar`, `SegmentedButton`, `FilterChip`, and other M3 components throughout, giving it a modern, platform-consistent feel.

3. **Real-time streams for contract rooms** — Trade and sale rooms use Supabase Realtime streams, so status changes appear instantly without manual refresh. This is excellent for trust in a financial app.

4. **Design token system** — `AppTheme` provides consistent spacing, color, and radius tokens used across all files. No random hardcoded hex colors or margin values outside the system.

5. **Proper money handling (almost)** — The integer-cents convention is maintained throughout models and services, with `Money.format()` handling display correctly. Only the input conversion has the float bug.

6. **Progressive disclosure** — Listing detail, trade room, and sale room all show information hierarchically: summary first, details on demand. The shopfront binder banner explains an unusual concept clearly.

---
