import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/offer.dart';
import 'package:cardtrade/providers/offers_provider.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';

/// Offers screen with Received / Sent tabs.
///
/// Received tab: offer cards with item image, title, offer amount, status badge,
/// and Accept/Decline/Counter actions. Sent tab: offer cards with Withdraw.
class OffersScreen extends ConsumerStatefulWidget {
  const OffersScreen({super.key});

  @override
  ConsumerState<OffersScreen> createState() => _OffersScreenState();
}

class _OffersScreenState extends ConsumerState<OffersScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Offers'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Received'),
            Tab(text: 'Sent'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          _ReceivedOffersTab(),
          _SentOffersTab(),
        ],
      ),
    );
  }
}

/// Received offers tab content.
class _ReceivedOffersTab extends ConsumerWidget {
  const _ReceivedOffersTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final offersAsync = ref.watch(receivedOffersProvider);

    return offersAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => ErrorView(
        message: error.toString(),
        onRetry: () => ref.invalidate(receivedOffersProvider),
      ),
      data: (offers) {
        if (offers.isEmpty) {
          return const EmptyState(
            icon: Icons.local_offer_outlined,
            title: 'No offers received',
            subtitle: 'Offers from buyers will appear here.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(receivedOffersProvider);
            await ref.read(receivedOffersProvider.future);
          },
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            itemCount: offers.length,
            separatorBuilder: (_, _) =>
                const SizedBox(height: AppTheme.spacingMd),
            itemBuilder: (context, index) {
              return _ReceivedOfferCard(offer: offers[index]);
            },
          ),
        );
      },
    );
  }
}

/// Sent offers tab content.
class _SentOffersTab extends ConsumerWidget {
  const _SentOffersTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final offersAsync = ref.watch(sentOffersProvider);

    return offersAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => ErrorView(
        message: error.toString(),
        onRetry: () => ref.invalidate(sentOffersProvider),
      ),
      data: (offers) {
        if (offers.isEmpty) {
          return const EmptyState(
            icon: Icons.send_rounded,
            title: 'No offers sent',
            subtitle: 'Offers you make on listings will appear here.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(sentOffersProvider);
            await ref.read(sentOffersProvider.future);
          },
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            itemCount: offers.length,
            separatorBuilder: (_, _) =>
                const SizedBox(height: AppTheme.spacingMd),
            itemBuilder: (context, index) {
              return _SentOfferCard(offer: offers[index]);
            },
          ),
        );
      },
    );
  }
}

/// Card for a received offer with Accept/Decline/Counter actions.
class _ReceivedOfferCard extends ConsumerStatefulWidget {
  const _ReceivedOfferCard({required this.offer});

  final Offer offer;

  @override
  ConsumerState<_ReceivedOfferCard> createState() =>
      _ReceivedOfferCardState();
}

class _ReceivedOfferCardState extends ConsumerState<_ReceivedOfferCard> {
  bool _showCounter = false;
  bool _isLoading = false;
  final _counterController = TextEditingController();

  @override
  void dispose() {
    _counterController.dispose();
    super.dispose();
  }

  void _invalidateOffers() {
    ref.invalidate(receivedOffersProvider);
    ref.invalidate(sentOffersProvider);
  }

  Future<void> _acceptOffer() async {
    setState(() => _isLoading = true);
    try {
      final service = ref.read(offersServiceProvider);
      await service.acceptOffer(widget.offer.id);
      _invalidateOffers();
      if (mounted) context.showSuccess('Offer accepted');
    } catch (e) {
      if (mounted) context.showError('Failed to accept: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _declineOffer() async {
    final confirmed = await ConfirmationDialog.danger(
      context: context,
      title: 'Decline offer?',
      message: 'Are you sure you want to decline this offer? This cannot be undone.',
      confirmLabel: 'Decline',
    );
    if (!confirmed || !mounted) return;

    setState(() => _isLoading = true);
    try {
      final service = ref.read(offersServiceProvider);
      await service.declineOffer(widget.offer.id);
      _invalidateOffers();
      if (mounted) context.showSuccess('Offer declined');
    } catch (e) {
      if (mounted) context.showError('Failed to decline: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _submitCounter() async {
    final text = _counterController.text.replaceAll(RegExp(r'[^0-9.]'), '');
    if (text.isEmpty) return;
    final parts = text.split('.');
    final whole = int.tryParse(parts[0]) ?? 0;
    final fraction = parts.length > 1
        ? parts[1].padRight(2, '0').substring(0, 2)
        : '00';
    final cents = whole * 100 + (int.tryParse(fraction) ?? 0);

    if (cents <= 0) {
      context.showError('Enter a valid amount');
      return;
    }

    setState(() => _isLoading = true);
    try {
      final service = ref.read(offersServiceProvider);
      await service.counterOffer(
        offerId: widget.offer.id,
        amountCents: cents,
      );
      _invalidateOffers();
      if (mounted) {
        context.showSuccess('Counter offer sent');
        setState(() => _showCounter = false);
      }
    } catch (e) {
      if (mounted) context.showError('Failed to counter: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  StatusBadgeVariant _badgeVariant(OfferStatus status) {
    return switch (status) {
      OfferStatus.pending => StatusBadgeVariant.pending,
      OfferStatus.accepted => StatusBadgeVariant.completed,
      OfferStatus.declined => StatusBadgeVariant.error,
      OfferStatus.countered => StatusBadgeVariant.active,
      OfferStatus.withdrawn => StatusBadgeVariant.neutral,
    };
  }

  @override
  Widget build(BuildContext context) {
    final offer = widget.offer;
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ─── Header ────────────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Money.format(offer.amountCents, 'aud'),
                        style: theme.textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        offer.createdAt.timeAgo,
                        style: theme.textTheme.labelSmall,
                      ),
                    ],
                  ),
                ),
                StatusBadge(
                  label: offer.status.name.capitalized,
                  variant: _badgeVariant(offer.status),
                ),
              ],
            ),

            if (offer.message != null && offer.message!.isNotEmpty) ...[
              const SizedBox(height: AppTheme.spacingSm),
              Text(
                offer.message!,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontStyle: FontStyle.italic,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],

            // ─── Actions ───────────────────────────────────────────
            if (offer.isPending) ...[
              const SizedBox(height: AppTheme.spacingMd),

              if (_showCounter) ...[
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _counterController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(
                          hintText: 'Counter amount',
                          prefixText: '\$ ',
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 10,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: AppTheme.spacingSm),
                    IconButton.filled(
                      onPressed: _isLoading ? null : _submitCounter,
                      icon: _isLoading
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.check_rounded, size: 18),
                      style: IconButton.styleFrom(
                        backgroundColor: AppTheme.accent,
                      ),
                    ),
                    IconButton(
                      onPressed: _isLoading
                          ? null
                          : () => setState(() => _showCounter = false),
                      icon: const Icon(Icons.close_rounded, size: 18),
                    ),
                  ],
                ),
              ] else
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        onPressed: _isLoading ? null : _acceptOffer,
                        child: _isLoading
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text('Accept'),
                      ),
                    ),
                    const SizedBox(width: AppTheme.spacingSm),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _isLoading ? null : _declineOffer,
                        child: const Text('Decline'),
                      ),
                    ),
                    const SizedBox(width: AppTheme.spacingSm),
                    Expanded(
                      child: TextButton(
                        onPressed: _isLoading
                            ? null
                            : () => setState(() => _showCounter = true),
                        child: const Text('Counter'),
                      ),
                    ),
                  ],
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Card for a sent offer with Withdraw action.
class _SentOfferCard extends ConsumerStatefulWidget {
  const _SentOfferCard({required this.offer});

  final Offer offer;

  @override
  ConsumerState<_SentOfferCard> createState() => _SentOfferCardState();
}

class _SentOfferCardState extends ConsumerState<_SentOfferCard> {
  bool _isLoading = false;

  Future<void> _withdrawOffer() async {
    final confirmed = await ConfirmationDialog.danger(
      context: context,
      title: 'Withdraw offer?',
      message: 'Are you sure you want to withdraw this offer?',
      confirmLabel: 'Withdraw',
    );
    if (!confirmed || !mounted) return;

    setState(() => _isLoading = true);
    try {
      final service = ref.read(offersServiceProvider);
      await service.withdrawOffer(widget.offer.id);
      ref.invalidate(receivedOffersProvider);
      ref.invalidate(sentOffersProvider);
      if (mounted) context.showSuccess('Offer withdrawn');
    } catch (e) {
      if (mounted) context.showError('Failed to withdraw: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  StatusBadgeVariant _badgeVariant(OfferStatus status) {
    return switch (status) {
      OfferStatus.pending => StatusBadgeVariant.pending,
      OfferStatus.accepted => StatusBadgeVariant.completed,
      OfferStatus.declined => StatusBadgeVariant.error,
      OfferStatus.countered => StatusBadgeVariant.active,
      OfferStatus.withdrawn => StatusBadgeVariant.neutral,
    };
  }

  @override
  Widget build(BuildContext context) {
    final offer = widget.offer;
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Money.format(offer.amountCents, 'aud'),
                        style: theme.textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        offer.createdAt.timeAgo,
                        style: theme.textTheme.labelSmall,
                      ),
                    ],
                  ),
                ),
                StatusBadge(
                  label: offer.status.name.capitalized,
                  variant: _badgeVariant(offer.status),
                ),
              ],
            ),
            if (offer.message != null && offer.message!.isNotEmpty) ...[
              const SizedBox(height: AppTheme.spacingSm),
              Text(
                offer.message!,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontStyle: FontStyle.italic,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (offer.isPending) ...[
              const SizedBox(height: AppTheme.spacingMd),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: _isLoading ? null : _withdrawOffer,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.danger,
                    side: const BorderSide(color: AppTheme.danger),
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppTheme.danger,
                          ),
                        )
                      : const Text('Withdraw'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
