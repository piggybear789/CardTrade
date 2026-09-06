// The member's trades — one of the two contract lists.
//
// The states come from `AsyncStateView`. Two of them were previously wrong in ways
// that mattered on a contract list: the loading state was a bare spinner, so the
// screen gave no hint of its shape; and the failure state was reached whenever the
// provider reported an error, INCLUDING a failed refresh — so a member on a train
// pulled to refresh and had their trades replaced by an apology (Req 11.5, 11.10).
//
// Requirements 11.1, 11.3–11.6, 11.8, 11.10.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/trade.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';
import 'package:cardtrade/features/trades/widgets/trade_card.dart';

/// Screen showing the current user's trades list.
class TradesListScreen extends ConsumerWidget {
  const TradesListScreen({super.key});

  /// Placeholder rows drawn while the first read runs.
  static const int _skeletonRows = 5;

  /// What a failure or a failed refresh calls this request, in member terms.
  static const String _operation = 'your trades';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Trades')),
      body: AsyncStateView<List<TradeSummary>>(
        value: ref.watch(myTradesProvider),
        operation: _operation,
        onRetry: () async {
          ref.invalidate(myTradesProvider);
          await ref.read(myTradesProvider.future);
        },
        loadingAnnouncement: 'Loading your trades',
        skeleton: (_) => _list(
          itemCount: _skeletonRows,
          itemBuilder: (_, _) => const SkeletonListTile(),
        ),
        builder: (context, trades) {
          if (trades.isEmpty) {
            return const PullableFill(
              child: EmptyState(
                icon: Icons.swap_horiz_rounded,
                title: 'No trades yet',
                subtitle:
                    'When you propose or receive a trade, it will appear here.',
              ),
            );
          }

          return _list(
            itemCount: trades.length,
            itemBuilder: (context, index) => TradeCard(
              trade: trades[index],
              onTap: () => context.push('/trades/${trades[index].id}'),
            ),
          );
        },
      ),
    );
  }

  /// One list for the placeholder and the rows, so the two share their geometry.
  static Widget _list({
    required int itemCount,
    required Widget Function(BuildContext, int) itemBuilder,
  }) {
    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(AppSpacing.cozy),
      itemCount: itemCount,
      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.snug),
      itemBuilder: itemBuilder,
    );
  }
}
