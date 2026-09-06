import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/fullscreen_image_viewer.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';

/// Screen listing the current user's cash sales split into
/// Purchases (where user is buyer) and Sales (where user is seller).
class SalesListScreen extends ConsumerWidget {
  const SalesListScreen({super.key});

  /// Placeholder rows drawn while the first read runs.
  static const int _skeletonRows = 5;

  /// What a failure or a failed refresh calls this request, in member terms.
  ///
  /// One name for both tabs, because it is one read: splitting it into "your
  /// purchases" and "your sales" would describe two requests that do not exist.
  static const String _operation = 'your purchases and sales';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentUser = ref.watch(currentUserProvider);

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My Transactions'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Purchases'),
              Tab(text: 'Sales'),
            ],
          ),
        ),
        body: AsyncStateView<List<CashSaleSummary>>(
          value: ref.watch(mySalesProvider),
          operation: _operation,
          onRetry: () async {
            ref.invalidate(mySalesProvider);
            await ref.read(mySalesProvider.future);
          },
          loadingAnnouncement: 'Loading your purchases and sales',
          // One placeholder behind both tabs: the read is one request, so a
          // per-tab placeholder would imply two.
          skeleton: (_) => ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(AppSpacing.cozy),
            itemCount: _skeletonRows,
            separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.snug),
            itemBuilder: (_, _) => const SkeletonListTile(),
          ),
          builder: (context, sales) {
            // Which side of a contract the member is on is read from the rows the
            // server sent, not decided here (Req 14.12).
            final userId = currentUser?.id ?? '';
            final purchases = sales.where((s) => s.buyerId == userId).toList();
            final mySales = sales.where((s) => s.sellerId == userId).toList();

            return TabBarView(
              children: [
                _SalesList(
                  sales: purchases,
                  emptyIcon: Icons.shopping_bag_outlined,
                  emptyTitle: 'No purchases yet',
                  emptySubtitle: 'Items you buy will appear here.',
                ),
                _SalesList(
                  sales: mySales,
                  emptyIcon: Icons.storefront_outlined,
                  emptyTitle: 'No sales yet',
                  emptySubtitle:
                      'When someone buys from you, it will appear here.',
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// One tab's rows, or its empty state.
///
/// It carries no refresh of its own: the gesture belongs to the [AsyncStateView]
/// above both tabs, so one pull refreshes the one read behind them and a pull on
/// either tab cannot start a second (Req 11.6).
class _SalesList extends StatelessWidget {
  const _SalesList({
    required this.sales,
    required this.emptyIcon,
    required this.emptyTitle,
    required this.emptySubtitle,
  });

  final List<CashSaleSummary> sales;
  final IconData emptyIcon;
  final String emptyTitle;
  final String emptySubtitle;

  @override
  Widget build(BuildContext context) {
    if (sales.isEmpty) {
      return PullableFill(
        child: EmptyState(
          icon: emptyIcon,
          title: emptyTitle,
          subtitle: emptySubtitle,
        ),
      );
    }

    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(AppSpacing.cozy),
      itemCount: sales.length,
      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.snug),
      itemBuilder: (context, index) {
        final sale = sales[index];
        return _SaleCard(
          sale: sale,
          onTap: () => context.push('/sales/${sale.id}'),
        );
      },
    );
  }
}

class _SaleCard extends StatelessWidget {
  const _SaleCard({
    required this.sale,
    this.onTap,
  });

  final CashSaleSummary sale;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasImage = sale.itemImagePaths.isNotEmpty;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.cozy),
          child: Row(
            children: [
              // ─── Item image ────────────────────────────────────
              GestureDetector(
                onTap: hasImage
                    ? () => FullscreenImageViewer.show(
                          context,
                          sale.itemImagePaths,
                        )
                    : null,
                child: Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: AppColors.muted,
                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                    border: Border.all(color: AppTheme.border),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: hasImage
                      ? Image.network(
                          sale.itemImagePaths.first,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => const Center(
                            child: Icon(Icons.image_outlined,
                                color: AppColors.mutedForeground, size: 24),
                          ),
                        )
                      : const Center(
                          child: Icon(Icons.image_outlined,
                              color: AppColors.mutedForeground, size: 24),
                        ),
                ),
              ),
              const SizedBox(width: AppSpacing.snug),

              // ─── Content ───────────────────────────────────────
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      sale.itemTitle,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      Money.format(sale.agreedPriceCents, sale.currency),
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: AppColors.irisInk,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.snug),
                    Row(
                      children: [
                        if (sale.counterpartDisplayName != null)
                          Expanded(
                            child: Text(
                              sale.counterpartDisplayName!,
                              style: theme.textTheme.labelSmall,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        Text(
                          sale.updatedAt.timeAgo,
                          style: theme.textTheme.labelSmall,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.tight),

              // ─── Status badge ──────────────────────────────────
              _buildStatusBadge(sale.status),
            ],
          ),
        ),
      ),
    );
  }

  StatusBadge _buildStatusBadge(CashSaleStatus status) {
    final label = enumToString(status).enumLabel;
    return switch (status) {
      CashSaleStatus.completed => StatusBadge.completed(label),
      CashSaleStatus.escrowHeld ||
      CashSaleStatus.inTransit ||
      CashSaleStatus.handover ||
      CashSaleStatus.inspection =>
        StatusBadge.active(label),
      CashSaleStatus.agreement || CashSaleStatus.paymentPending =>
        StatusBadge.pending(label),
      CashSaleStatus.disputed ||
      CashSaleStatus.cancelled ||
      CashSaleStatus.failed ||
      CashSaleStatus.refunded =>
        StatusBadge.error(label),
    };
  }
}
