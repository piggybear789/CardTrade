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
import '../widgets/common/bottom_nav_shell.dart';
import '../providers/auth_provider.dart';

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
}

/// The main router provider.
final routerProvider = Provider<GoRouter>((ref) {
  final isAuthenticated = ref.watch(isAuthenticatedProvider);

  return GoRouter(
    initialLocation: AppRoutes.home,
    debugLogDiagnostics: false,
    redirect: (context, state) {
      final isAuthRoute = state.matchedLocation.startsWith('/auth');
      final path = state.matchedLocation;

      // Public routes that don't require auth
      final isPublicRoute = path == '/home' ||
          path.startsWith('/listings/') && !path.startsWith('/listings/new') && !path.startsWith('/listings/edit') && !path.startsWith('/listings/mine') ||
          path.startsWith('/sellers/');

      // Authenticated users shouldn't see auth screens
      if (isAuthenticated && isAuthRoute) {
        return AppRoutes.home;
      }

      // Unauthenticated users can browse public routes
      if (!isAuthenticated && !isAuthRoute && !isPublicRoute) {
        return AppRoutes.signIn;
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

      // ─── Profile sub-pages ────────────────────────────────────────────────
      GoRoute(
        path: '/profile/edit',
        builder: (context, state) => const EditProfileScreen(),
      ),
      GoRoute(
        path: '/profile/identity',
        builder: (context, state) => const IdentityVerificationScreen(),
      ),
      GoRoute(
        path: '/profile/payouts',
        builder: (context, state) => const PayoutSetupScreen(),
      ),
      GoRoute(
        path: '/profile/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
    ],
  );
});
