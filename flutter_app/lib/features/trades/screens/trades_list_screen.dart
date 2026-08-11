import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';
import 'package:cardtrade/features/trades/widgets/trade_card.dart';

/// Screen showing the current user's trades list.
///
/// Uses [myTradesProvider] for data, pull-to-refresh to invalidate,
/// and navigates to /trades/:id on tap.
class TradesListScreen extends ConsumerWidget {
  const TradesListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tradesAsync = ref.watch(myTradesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Trades'),
      ),
      body: tradesAsync.when(
        loading: () => const LoadingIndicator(),
        error: (error, stack) => ErrorView(
          message: 'Failed to load trades',
          onRetry: () => ref.invalidate(myTradesProvider),
        ),
        data: (trades) {
          if (trades.isEmpty) {
            return const EmptyState(
              icon: Icons.swap_horiz_rounded,
              title: 'No trades yet',
              subtitle:
                  'When you propose or receive a trade, it will appear here.',
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(myTradesProvider);
              await ref.read(myTradesProvider.future);
            },
            child: ListView.separated(
              padding: const EdgeInsets.all(AppTheme.spacingLg),
              itemCount: trades.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTheme.spacingMd),
              itemBuilder: (context, index) {
                final trade = trades[index];
                return TradeCard(
                  trade: trade,
                  onTap: () => context.push('/trades/${trade.id}'),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
