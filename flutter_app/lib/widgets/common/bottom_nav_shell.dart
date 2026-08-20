import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/messages_provider.dart';
import 'package:cardtrade/providers/notifications_provider.dart';
import 'package:cardtrade/router/router.dart';

/// Shell widget providing Material 3 bottom navigation.
class BottomNavShell extends ConsumerWidget {
  const BottomNavShell({required this.child, super.key});

  final Widget child;

  static const _tabRoutes = [
    AppRoutes.home,
    AppRoutes.trades,
    null, // Sell is a push action, not a tab
    AppRoutes.messages,
    AppRoutes.profile,
  ];

  int _selectedIndex(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    if (location.startsWith('/trades')) return 1;
    if (location.startsWith('/messages')) return 3;
    if (location.startsWith('/profile')) return 4;
    return 0; // Home/catalog is default
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedIndex = _selectedIndex(context);
    final unreadCount = ref.watch(unreadNotificationCountProvider);
    final unreadMessages = ref.watch(unreadMessagesCountProvider);
    final isAuthenticated = ref.watch(isAuthenticatedProvider);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        height: 56,
        selectedIndex: selectedIndex,
        onDestinationSelected: (index) {
          // Sell button: push to create listing (requires auth)
          if (index == 2) {
            if (!isAuthenticated) {
              context.push(AppRoutes.signIn);
            } else {
              context.push('/listings/new');
            }
            return;
          }

          // Protected tabs require auth
          if (index != 0 && !isAuthenticated) {
            context.push(AppRoutes.signIn);
            return;
          }

          if (index != selectedIndex) {
            final route = _tabRoutes[index];
            if (route != null) context.go(route);
          }
        },
        backgroundColor: AppTheme.surface,
        indicatorColor: AppTheme.accentLight,
        surfaceTintColor: Colors.transparent,
        elevation: 1,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.home_outlined, size: 20),
            selectedIcon: Icon(Icons.home, size: 20),
            label: 'Home',
          ),
          const NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined, size: 20),
            selectedIcon: Icon(Icons.receipt_long, size: 20),
            label: 'Trades',
          ),
          const NavigationDestination(
            icon: Icon(
              Icons.add_circle_outline,
              size: 22,
              color: AppTheme.accent,
            ),
            selectedIcon: Icon(
              Icons.add_circle,
              size: 22,
              color: AppTheme.accent,
            ),
            label: 'Sell',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: unreadMessages.maybeWhen(
                data: (count) => count > 0,
                orElse: () => false,
              ),
              label: unreadMessages.maybeWhen(
                data: (count) => Text('$count'),
                orElse: () => const Text(''),
              ),
              child: const Icon(Icons.chat_bubble_outline, size: 20),
            ),
            selectedIcon: Badge(
              isLabelVisible: unreadMessages.maybeWhen(
                data: (count) => count > 0,
                orElse: () => false,
              ),
              label: unreadMessages.maybeWhen(
                data: (count) => Text('$count'),
                orElse: () => const Text(''),
              ),
              child: const Icon(Icons.chat_bubble, size: 20),
            ),
            label: 'Messages',
          ),
          const NavigationDestination(
            icon: Icon(Icons.person_outline, size: 20),
            selectedIcon: Icon(Icons.person, size: 20),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
