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
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/fullscreen_image_viewer.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';

/// Screen listing the current user's cash sales split into
/// Purchases (where user is buyer) and Sales (where user is seller).
class SalesListScreen extends ConsumerWidget {
  const SalesListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final salesAsync = ref.watch(mySalesProvider);
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
        body: salesAsync.when(
          loading: () => const LoadingIndicator(),
          error: (error, _) => ErrorView(
            message: 'Failed to load transactions',
            onRetry: () => ref.invalidate(mySalesProvider),
          ),
          data: (sales) {
            final userId = currentUser?.id ?? '';
            final purchases =
                sales.where((s) => s.buyerId == userId).toList();
            final mySales =
                sales.where((s) => s.sellerId == userId).toList();

            return TabBarView(
              children: [
                _SalesList(
                  sales: purchases,
                  emptyIcon: Icons.shopping_bag_outlined,
                  emptyTitle: 'No purchases yet',
                  emptySubtitle:
                      'Items you buy will appear here.',
                  onRefresh: () async {
                    ref.invalidate(mySalesProvider);
                    await ref.read(mySalesProvider.future);
                  },
                ),
                _SalesList(
                  sales: mySales,
                  emptyIcon: Icons.storefront_outlined,
                  emptyTitle: 'No sales yet',
                  emptySubtitle:
                      'When someone buys from you, it will appear here.',
                  onRefresh: () async {
                    ref.invalidate(mySalesProvider);
                    await ref.read(mySalesProvider.future);
                  },
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _SalesList extends StatelessWidget {
  const _SalesList({
    required this.sales,
    required this.emptyIcon,
    required this.emptyTitle,
    required this.emptySubtitle,
    required this.onRefresh,
  });

  final List<CashSaleSummary> sales;
  final IconData emptyIcon;
  final String emptyTitle;
  final String emptySubtitle;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    if (sales.isEmpty) {
      return EmptyState(
        icon: emptyIcon,
        title: emptyTitle,
        subtitle: emptySubtitle,
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.separated(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        itemCount: sales.length,
        separatorBuilder: (_, _) =>
            const SizedBox(height: AppTheme.spacingMd),
        itemBuilder: (context, index) {
          final sale = sales[index];
          return _SaleCard(
            sale: sale,
            onTap: () => context.push('/sales/${sale.id}'),
          );
        },
      ),
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
          padding: const EdgeInsets.all(AppTheme.spacingLg),
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
                    color: AppTheme.surfaceVariant,
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
                                color: AppTheme.muted, size: 24),
                          ),
                        )
                      : const Center(
                          child: Icon(Icons.image_outlined,
                              color: AppTheme.muted, size: 24),
                        ),
                ),
              ),
              const SizedBox(width: AppTheme.spacingMd),

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
                        color: AppTheme.accent,
                      ),
                    ),
                    const SizedBox(height: AppTheme.spacingXs),
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
              const SizedBox(width: AppTheme.spacingSm),

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
