# CardTrade Flutter App — Full Specification

## Overview

A native iOS/Android marketplace app for peer-to-peer trading of collectibles (trading cards, coins, stamps, comics, memorabilia). Built with Flutter, Riverpod, Supabase, and Stripe. The app provides a safety-first experience with trustless escrow, real-time messaging, and identity verification.

**Design Philosophy:** Inspired by Xianyu (闲鱼) for its casual peer-to-peer feel and quick-list UX, eBay for trust signals and structured listings, and modern apps like StockX/GOAT for clean card-based browsing. The app should feel fast, trustworthy, and simple — hiding complexity behind progressive disclosure.

---

## Architecture

### State Management: Riverpod (flutter_riverpod + riverpod_annotation)
- AsyncNotifierProvider for async data with loading/error states
- StreamProvider for real-time subscriptions
- StateProvider for simple UI state (filters, search queries)
- Code generation with @riverpod annotation for type safety

### Navigation: go_router
- Declarative routing with deep link support
- Auth redirect guard
- Nested navigation with bottom nav shell
- Modal routes for quick actions

### Data Layer: Supabase (supabase_flutter)
- Direct client matching web app's cardtrade schema
- Real-time subscriptions for trades, sales, messages
- Storage for image uploads
- Auth with email/password + magic link

### Payments: Stripe (flutter_stripe)
- Payment Element for card setup (no raw card data)
- SetupIntent flow for saving payment methods
- Connect onboarding via in-app browser

---

## Design System

### Color Palette (Slate-based, matching web app)
```
Primary: #0f172a (Slate 900) — headers, primary text
Secondary: #475569 (Slate 600) — secondary text
Accent: #2563eb (Blue 600) — CTAs, links, active states
Success: #16a34a (Green 600) — completed, verified
Warning: #d97706 (Amber 600) — pending, attention
Danger: #dc2626 (Red 600) — errors, fraud, cancel
Surface: #ffffff — cards, sheets
Background: #f8fafc (Slate 50) — page background
Border: #e2e8f0 (Slate 200) — dividers, card borders
Muted: #94a3b8 (Slate 400) — placeholder, disabled
```

### Typography
```
Display: 28sp, Bold — splash/hero (Inter/SF Pro)
H1: 24sp, SemiBold — page titles
H2: 20sp, SemiBold — section headers
H3: 16sp, Medium — card titles, list items
Body: 14sp, Regular — descriptions, content
Caption: 12sp, Regular — timestamps, metadata
Label: 12sp, Medium — badges, tags, form labels
Price: 20sp, Bold — money displays (tabular figures)
```

### Spacing Scale
```
xs: 4dp
sm: 8dp
md: 12dp
lg: 16dp
xl: 24dp
xxl: 32dp
xxxl: 48dp
```

### Component Library
- **Card styles:** Elevated (shadow), Outlined (border), Flat (background only)
- **Buttons:** Primary (filled blue), Secondary (outlined), Ghost (text only), Danger (red)
- **Badges:** Status (colored dot + text), Verification (shield icon), Condition (tag)
- **Bottom sheets:** Standard (drag handle), Full-screen (with nav bar)
- **Skeletons:** Shimmer loading for every data-dependent view
- **Empty states:** Illustration + message + CTA for every list view
- **Toast/Snackbar:** Success (green), Error (red), Info (blue), with optional action

### Motion
- Page transitions: Shared axis (horizontal for peers, vertical for depth)
- Cards: Scale on press (0.97), elevation change
- Lists: Staggered fade-in on initial load
- Pull-to-refresh: Custom indicator matching brand
- Bottom sheet: Spring physics

---

## Data Models

### Enums
```dart
enum MerchantStatus { none, pending, approved, rejected }
enum IdentityCheckStatus { none, pending, verified, failed }
enum ItemStatus { available, reserved, sold }
enum ListingKind { single, shopfront }
enum TradeState { negotiating, collateralPending, collateralLocked, inTransit, inspection, completed, disputed, fraudResolved, cancelled }
enum CashSaleStatus { agreement, paymentPending, escrowHeld, inTransit, handover, inspection, completed, disputed, cancelled, failed, refunded }
enum CashSalePayoutStatus { notDue, pending, settled, failed }
enum HoldStatus { active, voided, partiallyCaptured, fullyCaptured, failed, expired }
enum TradeCashDirection { proposerPays, counterpartPays }
enum TradeFeeStatus { pending, settled, failed, refunded }
enum HandoverMethod { inPerson, delivery }
enum OfferStatus { pending, accepted, declined, countered, withdrawn }
enum NotificationType { offer, message, trade, sale, system }
enum TradeEvent { termsAgreed, offerDeclined, holdsConfirmed, holdsFailed, bothShipped, bothReceived, bothHandoverConfirmed, handoverFailed, bothAccepted, inspectionExpired, conditionDispute, disputeResolved, fraudConfirmed }
enum TradeAction { proposeTerms, acceptTerms, declineOffer, recordShipment, recordReceipt, confirmHandover, reportHandoverFailed, recordAcceptance, raiseDispute, reportFraud }
enum FulfilmentTrackingState { labelCreated, inTransit, outForDelivery, delivered, exception, unknown }
```

### Core Models (Freezed)
```dart
@freezed class Profile — id, displayName, contactEmail, payerId, paymentMethodLabel, merchantRef, merchantStatus, merchantSettlementsEnabled, rating, ratingCount, isAdmin, isSupport, regionCode, avatarPath, identityCheckStatus, identityCheckName, createdAt, updatedAt

@freezed class PublicProfile — id, displayName, rating, ratingCount, isVerified, regionCode, avatarPath, identityCheckStatus

@freezed class Item — id, ownerId, title, description, category, condition, fmvCents, status, listingKind, closedAt, imagePaths, hidden, sellerRating, sellerIdentityVerified, locationLabel, locationCountryCode, currency, createdAt, updatedAt

@freezed class Trade — id, initiatorId, counterpartId, initiatorItemId, counterpartItemId, state, version, termsVersion, cashAmountCents, cashDirection, handoverMethod, meetingLocation, meetingAt, deliveryCostCents, conversationId, createdAt, updatedAt (+ all tracking/inspection/dispute fields)

@freezed class CashSale — id, itemId, buyerId, sellerId, amountCents, agreedPriceCents, platformFeeCents, status, itemTitle, itemDescription, itemCondition, itemImagePaths, fulfillmentMethod, shippingCostCents, conversationId, currency, createdAt, updatedAt (+ all tracking/inspection/dispute/payout fields)

@freezed class CashSaleItem — id, cashSaleId, description, condition, quantity, unitPriceCents, imagePath, sortOrder

@freezed class Offer — id, itemId, sellerId, buyerId, offeredBy, amountCents, status, parentOfferId, message, createdAt

@freezed class Conversation — id, itemId, tradeId, cashSaleId, participantA, participantB, lastMessageAt, createdAt

@freezed class Message — id, conversationId, senderId, kind, systemEvent, body, readAt, createdAt

@freezed class Notification — id, userId, type, title, body, link, readAt, createdAt

@freezed class PreAuthHold — id, tradeId, traderId, holdRef, amountCents, capturedCents, status, expiresAt, createdAt

@freezed class Region — code, label, currency, minorUnitDigits, tradingEnabled

@freezed class Review — id, reviewerId, revieweeId, rating, comment, sourceType, sourceId, createdAt

@freezed class WatchlistEntry — userId, itemId, createdAt
```

---

## Navigation Structure

### Bottom Navigation (5 tabs — Xianyu-inspired)
1. **Home** (🏠) — Browse/catalog with search, filters, categories
2. **Trades** (🔄) — Active trades + proposals
3. **Sell** (➕) — Quick-list FAB/action (center, raised)
4. **Messages** (💬) — All conversations (badge count)
5. **Profile** (👤) — My account, settings, listings

### Route Tree
```
/ → redirect to /home or /auth
/auth
  /sign-in
  /sign-up
  /forgot-password
  /verify-email
/home
  / → catalog browse
  /search → search results
  /category/:id → filtered catalog
/listings
  /:id → listing detail
  /new → create listing
  /edit/:id → edit listing
  /mine → my listings
/trades
  / → trades list (as buyer/seller)
  /:id → trade room
  /new?itemId=&counterpartId= → propose trade
/sales
  / → my purchases & sales
  /:id → contract room
  /buy/:itemId → initiate purchase
/messages
  / → conversations list
  /:id → conversation detail
/offers
  / → received/sent offers
/saved → watchlist
/profile
  / → my profile
  /edit → edit profile
  /identity → identity verification flow
  /payouts → payout setup (Connect onboarding)
  /settings → app settings
/sellers/:id → public seller profile
/notifications → notifications list
```

---

## Feature Specifications

### 1. Home / Catalog (Xianyu + eBay hybrid)

**Layout:** 
- Sticky search bar at top (rounded, with camera icon for visual search placeholder)
- Horizontal category chips (scrollable): Trading Cards, Coins, Stamps, Comics, Memorabilia, All
- Region indicator (pill badge, tappable to change browse region)
- Waterfall/masonry grid (2 columns) of listing cards — inspired by Xianyu's casual browsing
- Pull-to-refresh, infinite scroll pagination

**Listing Card (compact, Xianyu-style):**
- First image (16:10 aspect, rounded top corners)
- Title (2 lines max, ellipsis)
- Price in bold (formatted with currency)
- Seller avatar (tiny circle) + display name + verified badge (if applicable)
- Location badge (suburb level)
- Condition badge (small colored tag)
- Listing kind indicator (🏪 for shopfront/binder)
- Watchlist heart icon (top-right overlay on image)

**Filters (bottom sheet):**
- Category multi-select
- Condition (Mint, Near Mint, Good, Fair, Poor)
- Price range (dual slider)
- Listing kind (Single / Binder)
- Sort: Newest, Price Low-High, Price High-Low, Nearest
- Region (for cross-region browsing)

### 2. Listing Detail

**Layout (eBay-style with trust emphasis):**
- Image carousel (full-width, pinch-zoom, page indicator dots)
- Title + condition badge + listing kind badge
- Price display (large, bold) with currency
- "Buy Now" / "Make Offer" / "Propose Trade" action row (sticky bottom)
- Seller card: avatar, name, verified badge, rating stars, region
- Description section (expandable)
- Category + metadata
- Location (suburb-level map preview from Google Static Maps)
- Similar listings horizontal scroll
- Report button (subtle, bottom)

**For Shopfront/Binder listings:**
- Banner: "This is a binder listing — the seller has multiple items. Nothing is reserved until a sale is agreed."
- "Browse & Buy" CTA instead of "Buy Now"
- No "Make Offer" (offers not allowed on shopfronts)
- "Propose Trade" available (0081)

**Actions (contextual):**
- Own listing: Edit, Close (shopfront), Mark Sold, Hide/Unhide
- Other's listing: Buy, Offer, Trade, Save/Unsave, Message Seller, Report

### 3. Auth

**Sign In:**
- Email + password fields
- "Forgot password?" link
- Magic link option ("Email me a sign-in link")
- Sign Up link
- Clean, centered layout with logo at top

**Sign Up:**
- Display name, email, password, confirm password
- Terms acceptance checkbox
- "Already have an account?" link

**Forgot Password:**
- Email input + send reset link button
- Back to sign in

### 4. Create Listing (Xianyu quick-list inspired)

**Flow:** Single scrollable form, progressive disclosure

- **Images** (grid of thumbnails + add button, drag to reorder, 1-10)
- **Title** (text field, 120 char max, with character counter)
- **Category** (dropdown/selector, required)
- **Condition** (choice chips: Mint / Near Mint / Good / Fair / Poor)
- **Description** (multiline, 2000 char max)
- **Listing Kind** (toggle: "Single Item" / "Binder / Bulk Listing")
  - If Binder: info card explaining behaviour
- **Fair Market Value** (currency input, integer cents, min $0.01)
- **Location** (Google Places autocomplete, suburb-level)
- **Preview** button → full listing preview
- **Publish** button

### 5. Trade Room (contract room equivalent)

**Layout:**
- Status header (colored banner showing current trade state)
- Progress rail (horizontal stepper: Proposed → Terms → Collateral → Shipping/Handover → Inspection → Complete)
- **Terms section:** Both items displayed side-by-side (cards), cash adjustment if any, fulfilment method, meeting/delivery details
- **Actions card:** Context-dependent buttons (Accept Terms, Record Shipment, Confirm Receipt, etc.)
- **Hold status:** Collateral status for both parties (card hold indicator)
- **Tracking section:** Carrier, tracking number, status timeline
- **Inspection countdown:** Timer display when in INSPECTION state
- **Conversation panel:** Integrated messaging (scrollable, at bottom)
- **Cancel / Dispute buttons** (contextual, with confirmation dialogs)

**States drive the UI:**
- NEGOTIATING: Show terms editor, accept/decline/counter buttons
- COLLATERAL_PENDING: "Placing card holds..." loading state
- COLLATERAL_LOCKED: Show fulfilment actions (record shipment or confirm handover)
- IN_TRANSIT: Show tracking, "Record Receipt" buttons
- INSPECTION: Show inspection countdown, accept/dispute buttons
- COMPLETED/CANCELLED/DISPUTED: Final state banner

### 6. Cash Sale Contract Room

**Similar to Trade Room but simpler (one direction):**
- Status header with progress rail
- Item details (snapshot from purchase time)
- Contract line items (for shopfront purchases)
- Price breakdown: Item price + shipping + platform fee (5%) = total
- Payment status indicator
- Fulfilment section (tracking or handover)
- Inspection countdown
- Conversation panel
- Actions: Accept/Dispute (buyer), Ship/Confirm (seller)

### 7. Messages

**Conversations List (WhatsApp-style):**
- Avatar + name + last message preview + timestamp
- Unread indicator (bold + badge count)
- Context badge (what the conversation is about: listing title, trade, sale)
- Swipe actions: Mute, Archive

**Conversation Detail:**
- Message bubbles (sent right/blue, received left/gray)
- System messages (centered, muted, italic)
- Message input bar with send button
- "View Contract" link if associated with trade/sale
- Scroll-to-bottom FAB when scrolled up

### 8. Profile

**My Profile:**
- Avatar (large, editable)
- Display name + edit button
- Verification status card:
  - Identity: Verified ✓ / Not verified (with "Verify" CTA)
  - Payouts: Set up ✓ / Not set up (with "Set up" CTA)
- Rating display (stars + count)
- Region display
- Quick stats: X listings, Y trades completed, Z sales
- "My Listings" link
- "My Purchases" / "My Sales" links
- Settings gear icon

**Seller Profile (public view):**
- Avatar + display name + verified badge
- Rating + review count
- Member since date
- Region
- Active listings grid (their available items)
- Reviews section

### 9. Identity Verification

**Flow (in-app browser to Stripe Identity):**
1. Explanation screen: "Verify your identity to start selling"
2. Opens Stripe Identity verification session (document + selfie)
3. Return handling: poll/refresh status
4. Success: "You're verified!" celebration screen
5. Failure: "Verification failed" with retry option

### 10. Payout Setup

**Flow (in-app browser to Stripe Connect):**
1. Explanation: "Set up payouts to receive money from sales"
2. Opens Stripe Connect onboarding link
3. Return handling: check merchant_settlements_enabled
4. Success: "Payouts are active" with bank details summary
5. Incomplete: "Finish setting up" with continue link

### 11. Notifications

**List view:**
- Icon (color-coded by type) + title + body preview + timestamp
- Unread: bold text, blue dot indicator
- Tap: navigate to linked resource (trade, sale, listing)
- "Mark all read" action in app bar

### 12. Offers

**Received/Sent tabs:**
- Offer card: Item image + title + offer amount + status badge
- Actions: Accept, Decline, Counter (received), Withdraw (sent)
- Counter-offer: inline amount editor

### 13. Saved / Watchlist

**Simple grid:**
- Same card layout as catalog
- "Remove" swipe action
- Empty state: "Save listings to find them later"

---

## Real-time Subscriptions

- **Trades:** Subscribe to trade row changes (state transitions, tracking updates)
- **Cash Sales:** Subscribe to sale status changes
- **Messages:** Subscribe to new messages in active conversations
- **Notifications:** Subscribe to new notifications (badge count update)

---

## Error Handling & Edge Cases

- **Network offline:** Show banner, cache last-known state, queue actions
- **Auth expired:** Auto-redirect to sign-in, preserve navigation state
- **Region mismatch:** Show clear error when trying to buy cross-region
- **Identity gate:** Block sell/trade actions with "Verify identity" CTA
- **Payout gate:** Block payout actions with "Set up payouts" CTA
- **Shopfront double-sale:** Warning banner on shopfront purchases
- **Hold expiry:** Alert when trade collateral is approaching expiry

---

## File Structure
```
flutter_app/
├── pubspec.yaml
├── analysis_options.yaml
├── build.yaml
├── lib/
│   ├── main.dart
│   ├── app.dart
│   ├── core/
│   │   ├── constants.dart
│   │   ├── env.dart
│   │   ├── theme.dart
│   │   ├── extensions.dart
│   │   └── money.dart
│   ├── models/
│   │   ├── enums.dart
│   │   ├── profile.dart
│   │   ├── item.dart
│   │   ├── trade.dart
│   │   ├── cash_sale.dart
│   │   ├── cash_sale_item.dart
│   │   ├── offer.dart
│   │   ├── conversation.dart
│   │   ├── message.dart
│   │   ├── notification.dart
│   │   ├── pre_auth_hold.dart
│   │   ├── region.dart
│   │   ├── review.dart
│   │   └── watchlist_entry.dart
│   ├── services/
│   │   ├── supabase_service.dart
│   │   ├── auth_service.dart
│   │   ├── listings_service.dart
│   │   ├── trades_service.dart
│   │   ├── sales_service.dart
│   │   ├── messages_service.dart
│   │   ├── offers_service.dart
│   │   ├── notifications_service.dart
│   │   ├── profile_service.dart
│   │   ├── storage_service.dart
│   │   └── watchlist_service.dart
│   ├── providers/
│   │   ├── auth_provider.dart
│   │   ├── profile_provider.dart
│   │   ├── listings_provider.dart
│   │   ├── trades_provider.dart
│   │   ├── sales_provider.dart
│   │   ├── messages_provider.dart
│   │   ├── offers_provider.dart
│   │   ├── notifications_provider.dart
│   │   ├── watchlist_provider.dart
│   │   └── region_provider.dart
│   ├── router/
│   │   ├── router.dart
│   │   └── guards.dart
│   ├── features/
│   │   ├── auth/
│   │   │   ├── screens/
│   │   │   │   ├── sign_in_screen.dart
│   │   │   │   ├── sign_up_screen.dart
│   │   │   │   └── forgot_password_screen.dart
│   │   │   └── widgets/
│   │   │       └── auth_form_field.dart
│   │   ├── listings/
│   │   │   ├── screens/
│   │   │   │   ├── catalog_screen.dart
│   │   │   │   ├── listing_detail_screen.dart
│   │   │   │   ├── create_listing_screen.dart
│   │   │   │   ├── edit_listing_screen.dart
│   │   │   │   └── my_listings_screen.dart
│   │   │   └── widgets/
│   │   │       ├── listing_card.dart
│   │   │       ├── listing_grid.dart
│   │   │       ├── category_chips.dart
│   │   │       ├── filter_sheet.dart
│   │   │       ├── image_carousel.dart
│   │   │       └── seller_card.dart
│   │   ├── trades/
│   │   │   ├── screens/
│   │   │   │   ├── trades_list_screen.dart
│   │   │   │   ├── trade_room_screen.dart
│   │   │   │   └── propose_trade_screen.dart
│   │   │   └── widgets/
│   │   │       ├── trade_card.dart
│   │   │       ├── trade_progress_rail.dart
│   │   │       ├── trade_terms_editor.dart
│   │   │       ├── trade_action_card.dart
│   │   │       └── hold_status_indicator.dart
│   │   ├── sales/
│   │   │   ├── screens/
│   │   │   │   ├── sales_list_screen.dart
│   │   │   │   ├── sale_room_screen.dart
│   │   │   │   └── purchase_flow_screen.dart
│   │   │   └── widgets/
│   │   │       ├── sale_card.dart
│   │   │       ├── sale_progress_rail.dart
│   │   │       ├── price_breakdown.dart
│   │   │       ├── contract_line_items.dart
│   │   │       └── inspection_countdown.dart
│   │   ├── messages/
│   │   │   ├── screens/
│   │   │   │   ├── conversations_screen.dart
│   │   │   │   └── conversation_detail_screen.dart
│   │   │   └── widgets/
│   │   │       ├── conversation_tile.dart
│   │   │       ├── message_bubble.dart
│   │   │       └── message_input.dart
│   │   ├── profile/
│   │   │   ├── screens/
│   │   │   │   ├── my_profile_screen.dart
│   │   │   │   ├── edit_profile_screen.dart
│   │   │   │   ├── seller_profile_screen.dart
│   │   │   │   ├── identity_verification_screen.dart
│   │   │   │   ├── payout_setup_screen.dart
│   │   │   │   └── settings_screen.dart
│   │   │   └── widgets/
│   │   │       ├── profile_header.dart
│   │   │       ├── verification_status_card.dart
│   │   │       └── stats_row.dart
│   │   ├── notifications/
│   │   │   └── screens/
│   │   │       └── notifications_screen.dart
│   │   ├── offers/
│   │   │   └── screens/
│   │   │       └── offers_screen.dart
│   │   └── saved/
│   │       └── screens/
│   │           └── saved_screen.dart
│   └── widgets/
│       └── common/
│           ├── app_scaffold.dart
│           ├── loading_indicator.dart
│           ├── error_view.dart
│           ├── empty_state.dart
│           ├── price_display.dart
│           ├── status_badge.dart
│           ├── verified_badge.dart
│           ├── condition_badge.dart
│           ├── image_gallery.dart
│           ├── avatar.dart
│           ├── shimmer_loading.dart
│           ├── confirmation_dialog.dart
│           └── bottom_nav_shell.dart
├── assets/
│   ├── images/
│   │   ├── logo.png
│   │   └── empty_states/
│   └── fonts/
└── test/
    └── widget_test.dart
```
