import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/screens/sign_in_screen.dart';
import '../features/auth/screens/sign_up_screen.dart';
import '../features/auth/screens/forgot_password_screen.dart';
import '../features/listings/screens/catalog_screen.dart';
import '../features/listings/screens/listing_detail_screen.dart';
import '../features/listings/screens/create_listing_screen.dart';
import '../features/listings/screens/edit_listing_screen.dart';
import '../features/listings/screens/my_listings_screen.dart';
import '../features/trades/screens/trades_list_screen.dart';
import '../features/trades/screens/trade_room_screen.dart';
import '../features/trades/screens/propose_trade_screen.dart';
import '../features/sales/screens/sales_list_screen.dart';
import '../features/sales/screens/sale_room_screen.dart';
import '../features/sales/screens/purchase_flow_screen.dart';
import '../features/messages/screens/conversations_screen.dart';
import '../features/messages/screens/conversation_detail_screen.dart';
import '../features/profile/screens/my_profile_screen.dart';
import '../features/profile/screens/edit_profile_screen.dart';
import '../features/profile/screens/seller_profile_screen.dart';
import '../features/profile/screens/identity_verification_screen.dart';
import '../features/profile/screens/payout_setup_screen.dart';
import '../features/profile/screens/settings_screen.dart';
import '../features/notifications/screens/notifications_screen.dart';
import '../features/offers/screens/offers_screen.dart';
import '../features/saved/screens/saved_screen.dart';
import '../features/invites/screens/invite_screen.dart';
import '../widgets/common/bottom_nav_shell.dart';
import '../providers/auth_provider.dart';
import '../providers/profile_provider.dart';
import 'deep_link_routing.dart';
import 'pending_deep_link.dart';

/// Route paths as constants to avoid typos.
abstract final class AppRoutes {
  static const signIn = '/auth/sign-in';
  static const signUp = '/auth/sign-up';
  static const forgotPassword = '/auth/forgot-password';
  static const home = '/home';
  static const trades = '/trades';
  static const sell = '/listings/new';
  static const messages = '/messages';
  static const profile = '/profile';

  // The remaining section roots, named so that the Hub_Set in `hub_set.dart`
  // maps a route to the destination that owns it without repeating path
  // literals that the route table below already states once.
  static const myListings = '/listings/mine';
  static const editListing = '/listings/edit';
  static const purchases = '/purchases';
  static const sales = '/sales';
  static const offers = '/offers';
  static const saved = '/saved';
  static const notifications = '/notifications';
  static const sellers = '/sellers';

  /// The two verification steps, named because `deep_link_routing.dart` routes a
  /// return marker to them and a path literal in two places is a path literal
  /// that can differ in one of them.
  static const identity = '/profile/identity';
  static const payouts = '/profile/payouts';

  /// The private-invite root. `/t/{token}` matches `invitePath` in
  /// `lib/actions/dealInvites.ts`, so a link works on either client.
  ///
  /// Not an allowlisted deep-link prefix: `kKnownRoutePrefixes` deliberately
  /// excludes it so an invite resolves through the resolver's token branch and
  /// not as an ordinary path.
  static const invite = '/t';

  /// Staff surfaces. The Flutter client has none yet, and the Account hub still
  /// claims the section so a route added later is owned rather than orphaned.
  static const staff = '/admin';
}

/// The main router provider.
final routerProvider = Provider<GoRouter>((ref) {
  final isAuthenticated = ref.watch(isAuthenticatedProvider);

  // Read, not watched: the slot must outlive this provider, which is rebuilt on
  // every auth change. See `pending_deep_link.dart`.
  final pending = ref.read(pendingDeepLinkProvider);

  return GoRouter(
    // Cold start (Req 4.8). `go_router` prefers the PLATFORM's initial route over
    // this value whenever the platform supplied one, so a link that launched the
    // process wins and this is only the no-link default. The switch that would
    // change that is `overridePlatformDefaultLocation`; it defaults to false and
    // setting it true is precisely what would drop a cold-start link, so it stays
    // unset. What cannot be verified without a device is the step before Dart:
    // whether the embedding hands over the intent data at all — that is M5 and M8
    // in the design's manual register.
    initialLocation: AppRoutes.home,
    debugLogDiagnostics: false,
    // Req 4.6: a location no route matches opens the catalog and says nothing
    // about the link. `errorBuilder` would draw a page naming it instead.
    onException: (context, state, router) => router.go(AppRoutes.home),
    redirect: (context, state) {
      // A received link decides where the member is going BEFORE auth is
      // considered, so that what gets retained for a signed-out member is the
      // target and not the raw link (Req 4.3–4.6).
      final arrival = deepLinkArrival(state.uri);
      if (arrival != null) {
        if (arrival.reReadsProfile) {
          // Req 4.4, 4.5. The marker says the member came back from somewhere and
          // says nothing about the outcome, so the row read before they left is
          // dropped and the screen asks the server. The screens also re-read on
          // every app resume (`ProfileReRead`), which covers the ordinary return
          // from a hosted flow; this covers an arrival that delivers no resume.
          // Deferred, because a provider must not be invalidated part-way through
          // route resolution.
          Future.microtask(() => ref.invalidate(myProfileProvider));
        }
        if (arrival.location != state.uri.toString()) return arrival.location;
      }

      final isAuthRoute = state.matchedLocation.startsWith('/auth');
      final path = state.matchedLocation;

      // Public routes that don't require auth
      final isPublicRoute = path == '/home' ||
          path.startsWith('/listings/') && !path.startsWith('/listings/new') && !path.startsWith('/listings/edit') && !path.startsWith('/listings/mine') ||
          path.startsWith('/sellers/');

      // Authenticated users shouldn't see auth screens. Req 4.7: resume to what
      // they were trying to open, which is the catalog only if nothing was.
      if (isAuthenticated && isAuthRoute) {
        return pending.take() ?? AppRoutes.home;
      }

      // Unauthenticated users can browse public routes. Anyone else is bounced —
      // and the destination is retained on the way out rather than discarded,
      // which is the whole of Req 4.7 and applies to a tapped link and a
      // protected route alike.
      if (!isAuthenticated && !isAuthRoute && !isPublicRoute) {
        pending.retain(state.uri.toString());
        return AppRoutes.signIn;
      }

      // Arrived, with a session. The slot is spent so a later sign-in does not
      // replay a destination the member has already been to.
      if (isAuthenticated && pending.peek == state.uri.toString()) {
        pending.clear();
      }

      return null;
    },
    routes: [
      // ─── Auth routes (no bottom nav) ─────────────────────────────────────
      GoRoute(
        path: AppRoutes.signIn,
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: AppRoutes.signUp,
        builder: (context, state) => const SignUpScreen(),
      ),
      GoRoute(
        path: AppRoutes.forgotPassword,
        builder: (context, state) => const ForgotPasswordScreen(),
      ),

      // ─── Main app with bottom navigation shell ───────────────────────────
      ShellRoute(
        builder: (context, state, child) => BottomNavShell(child: child),
        routes: [
          GoRoute(
            path: AppRoutes.home,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: CatalogScreen(),
            ),
          ),
          GoRoute(
            path: AppRoutes.trades,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: TradesListScreen(),
            ),
          ),
          GoRoute(
            path: AppRoutes.messages,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: ConversationsScreen(),
            ),
          ),
          GoRoute(
            path: AppRoutes.profile,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: MyProfileScreen(),
            ),
          ),
        ],
      ),

      // ─── Listings ─────────────────────────────────────────────────────────
      // IMPORTANT: Static paths BEFORE parameterized paths to avoid conflicts
      GoRoute(
        path: '/listings/new',
        builder: (context, state) => const CreateListingScreen(),
      ),
      GoRoute(
        path: '/listings/mine',
        builder: (context, state) => const MyListingsScreen(),
      ),
      GoRoute(
        path: '/listings/edit/:id',
        builder: (context, state) => EditListingScreen(
          itemId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: '/listings/:id',
        builder: (context, state) => ListingDetailScreen(
          itemId: state.pathParameters['id']!,
        ),
      ),

      // ─── Trades ───────────────────────────────────────────────────────────
      GoRoute(
        path: '/trades/new',
        builder: (context, state) => ProposeTradeScreen(
          itemId: state.uri.queryParameters['itemId'],
          counterpartId: state.uri.queryParameters['counterpartId'],
        ),
      ),
      GoRoute(
        path: '/trades/:id',
        builder: (context, state) => TradeRoomScreen(
          tradeId: state.pathParameters['id']!,
        ),
      ),

      // ─── Sales / Purchases ────────────────────────────────────────────────
      GoRoute(
        path: '/sales/buy/:itemId',
        builder: (context, state) => PurchaseFlowScreen(
          itemId: state.pathParameters['itemId']!,
        ),
      ),
      GoRoute(
        path: '/sales',
        builder: (context, state) => const SalesListScreen(),
      ),
      GoRoute(
        path: '/purchases',
        builder: (context, state) => const SalesListScreen(),
      ),
      GoRoute(
        path: '/sales/:id',
        builder: (context, state) => SaleRoomScreen(
          saleId: state.pathParameters['id']!,
        ),
      ),

      // ─── Messages ─────────────────────────────────────────────────────────
      GoRoute(
        path: '/messages/:id',
        builder: (context, state) => ConversationDetailScreen(
          conversationId: state.pathParameters['id']!,
        ),
      ),

      // ─── Offers ───────────────────────────────────────────────────────────
      GoRoute(
        path: '/offers',
        builder: (context, state) => const OffersScreen(),
      ),

      // ─── Saved / Watchlist ────────────────────────────────────────────────
      GoRoute(
        path: '/saved',
        builder: (context, state) => const SavedScreen(),
      ),

      // ─── Notifications ────────────────────────────────────────────────────
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),

      // ─── Sellers ──────────────────────────────────────────────────────────
      GoRoute(
        path: '/sellers/:id',
        builder: (context, state) => SellerProfileScreen(
          userId: state.pathParameters['id']!,
        ),
      ),

      // ─── Private invites ──────────────────────────────────────────────────
      // Deliberately not a public route: a signed-out member who taps an invite
      // is bounced to sign-in and resumed here afterwards (Req 4.7), which is the
      // same sequence the website's join page performs.
      GoRoute(
        path: '/t/:token',
        builder: (context, state) => InviteScreen(
          token: state.pathParameters['token']!,
        ),
      ),

      // ─── Profile sub-pages ────────────────────────────────────────────────
      GoRoute(
        path: '/profile/edit',
        builder: (context, state) => const EditProfileScreen(),
      ),
      GoRoute(
        path: AppRoutes.identity,
        builder: (context, state) => const IdentityVerificationScreen(),
      ),
      GoRoute(
        path: AppRoutes.payouts,
        builder: (context, state) => const PayoutSetupScreen(),
      ),
      GoRoute(
        path: '/profile/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
    ],
  );
});
