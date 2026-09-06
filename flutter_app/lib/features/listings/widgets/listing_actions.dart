// The actions region of the listing detail, and the ONE place the action SET for
// each viewer role is decided.
//
// ROLE, NOT ELIGIBILITY. Every branch below reads a fact the server already
// reported — who owns the listing, whether it is open, whether the seller has a
// disclosure, whether the viewer already holds a contract — and decides only what
// to DRAW. Nothing here decides whether a contract may be opened: the
// orchestrator re-evaluates the Identity_Gate, the region check and the seller
// disclosure snapshot on every attempt, and it is the only authority for them
// (Req 14.12).
//
// The region advisory is DISCLOSURE and never a disable (Req 6.12): the facts on
// both sides can change, a greyed control with no reason is the thing the notice
// exists to avoid, and the member who proceeds anyway meets the server's refusal.
//
// Exactly ONE primary action is presented to a non-owner (Req 6.8): buy on a
// single listing, browse on a binder or bulk listing, sign-in for a guest. It
// carries the `--action` fill, the `--action-foreground` label and the
// `--action-border` edge, because a pastel fill needs a defined edge to read as a
// control — all three come from `AppButtonVariant.action`.
//
// Requirements 6.1, 6.4, 6.8, 6.10, 6.12, 13.6, 13.7, 14.5, 14.12.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/router/router.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/controls.dart';

import 'listing_notice.dart';
import 'watch_control.dart';

/// Where the actions region is drawn.
enum ListingActionsPlacement {
  /// A bar docked immediately above the Mobile_Shell, whose height the scroll
  /// reserves at its foot so it covers no content (Req 6.1).
  docked,

  /// The last region of the scroll, for an owner, a closed listing, or a viewer
  /// who already holds a contract.
  inline,
}

/// The controls a listing offers this viewer.
class ListingActions extends ConsumerWidget {
  const ListingActions({
    required this.item,
    required this.placement,
    required this.isOwner,
    required this.isAuthenticated,
    required this.isOpen,
    required this.hasSellerDisclosure,
    required this.regionNotice,
    required this.myContractId,
    required this.openContracts,
    required this.onMakeOffer,
    super.key,
  });

  final Item item;
  final ListingActionsPlacement placement;

  /// Whether the viewing member owns this listing.
  final bool isOwner;
  final bool isAuthenticated;

  /// Whether the listing is open for business: unclosed for a binder or bulk
  /// listing, AVAILABLE for a single one.
  final bool isOpen;

  /// Whether the seller has a provider-verified name to disclose. Without one the
  /// buy, offer and trade controls are withheld and the reason is stated as text
  /// in their place (Req 6.4).
  final bool hasSellerDisclosure;

  /// Advisory copy about a region incompatibility, or null. Never disables
  /// anything (Req 6.12).
  final String? regionNotice;

  /// The viewer's own live contract on this listing, if the server reported one.
  final String? myContractId;

  /// Every live contract against this listing, for its owner (Req 6.10). A binder
  /// has many by design.
  final List<CashSaleSummary> openContracts;

  /// Opens the offer sheet the screen owns.
  final VoidCallback onMakeOffer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Widget content = Column(
      // MainAxisSize.min, because the DOCKED placement is laid out in the
      // scaffold's bottom slot under LOOSE constraints: a Column that keeps the
      // default `max` there grows to the full height of the screen, the body's
      // Expanded is left with zero, and the listing renders as an action bar and
      // nothing else. Found by the golden staging test for task 5.3.
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpacing.snug,
      children: <Widget>[
        if (regionNotice != null) ListingNotice(message: regionNotice!),
        ..._actions(context, ref),
      ],
    );

    if (placement == ListingActionsPlacement.inline) return content;

    return _DockedBar(child: content);
  }

  List<Widget> _actions(BuildContext context, WidgetRef ref) {
    if (isOwner) return _ownerActions(context, ref);
    if (!isAuthenticated) return _guestActions(context);
    if (!isOpen) {
      return <Widget>[
        Text(
          item.isShopfront
              ? 'The seller has closed this binder or bulk listing.'
              : 'This listing is no longer available.',
          style: AppText.supportText,
        ),
      ];
    }
    if (myContractId != null) {
      return <Widget>[
        const Text(
          'You already have a contract on this listing.',
          style: AppText.supportText,
        ),
        AppButton(
          label: 'Open your contract',
          icon: Icons.receipt_long_outlined,
          variant: AppButtonVariant.action,
          fillWidth: true,
          onPressed: () => context.push('${AppRoutes.sales}/$myContractId'),
        ),
      ];
    }
    return _buyerActions(context);
  }

  /// Edit, close-or-remove, and a link to each live contract (Req 6.10).
  ///
  /// No buy, offer, trade or watchlist control: a member cannot contract with
  /// themselves, and a watch control on your own listing watches nothing.
  List<Widget> _ownerActions(BuildContext context, WidgetRef ref) {
    return <Widget>[
      if (openContracts.isNotEmpty) ...<Widget>[
        Text(
          openContracts.length == 1
              ? '1 open contract'
              : '${openContracts.length} open contracts',
          style: AppText.sectionLabel,
        ),
        for (final CashSaleSummary contract in openContracts)
          _ContractLink(contract: contract),
      ],
      AppButton(
        label: 'Edit listing',
        icon: Icons.edit_outlined,
        variant: AppButtonVariant.outline,
        fillWidth: true,
        onPressed: () =>
            context.push('${AppRoutes.editListing}/${item.id}'),
      ),
      AppButton(
        label: item.isShopfront ? 'Close this listing' : 'Remove from catalog',
        icon: Icons.remove_circle_outline,
        variant: AppButtonVariant.outline,
        fillWidth: true,
        onPressed: () => _retire(context, ref),
      ),
    ];
  }

  /// Retires the listing through the capability the edit screen already uses: a
  /// binder or bulk listing is CLOSED, a single listing is hidden from the
  /// catalog. Neither is a new capability and neither touches a contract.
  Future<void> _retire(BuildContext context, WidgetRef ref) async {
    final bool confirmed = await ConfirmationDialog.danger(
      context: context,
      title: item.isShopfront ? 'Close this listing?' : 'Remove this listing?',
      message: item.isShopfront
          ? 'Buyers will no longer find it. Contracts already open on it keep running.'
          : 'It will no longer appear in the catalog.',
      confirmLabel: item.isShopfront ? 'Close' : 'Remove',
    );
    if (!confirmed || !context.mounted) return;

    final service = ref.read(listingsServiceProvider);
    if (item.isShopfront) {
      await service.closeShopfront(item.id);
    } else {
      await service.updateItem(item.id, <String, dynamic>{'hidden': true});
    }
    ref.invalidate(itemDetailProvider(item.id));
    ref.invalidate(myListingsProvider);
  }

  /// One primary action, carrying this listing as the post-sign-in target
  /// (Req 6.8).
  List<Widget> _guestActions(BuildContext context) {
    final String target =
        Uri.encodeQueryComponent('$_listingsRoot/${item.id}');
    return <Widget>[
      AppButton(
        label: 'Sign in to buy',
        icon: Icons.login_rounded,
        variant: AppButtonVariant.action,
        fillWidth: true,
        onPressed: () =>
            context.push('${AppRoutes.signIn}?redirectTo=$target'),
      ),
    ];
  }

  /// Watch, message and buy; offer and trade on a single listing only (Req 6.10).
  List<Widget> _buyerActions(BuildContext context) {
    if (!hasSellerDisclosure) {
      return <Widget>[
        // Withheld, with the reason IN TEXT beside where the control would be.
        // A disabled button with no explanation is what Req 6.8 forbids.
        const Text(
          'This seller cannot accept a purchase or a trade yet. You can message '
          'them in the meantime.',
          style: AppText.supportText,
        ),
        AppButton(
          label: 'Message seller',
          icon: Icons.chat_bubble_outline_rounded,
          variant: AppButtonVariant.outline,
          fillWidth: true,
          onPressed: () => context.push(AppRoutes.messages),
        ),
      ];
    }

    return <Widget>[
      // An Offer names one amount, and a trade needs one object to bond against.
      // Neither says anything about a whole binder, so neither is offered on one
      // (0081, Req 6.10).
      if (!item.isShopfront)
        Row(
          spacing: AppSpacing.snug,
          children: <Widget>[
            Expanded(
              child: AppButton(
                label: 'Offer',
                variant: AppButtonVariant.outline,
                fillWidth: true,
                onPressed: onMakeOffer,
              ),
            ),
            Expanded(
              child: AppButton(
                label: 'Trade',
                variant: AppButtonVariant.outline,
                fillWidth: true,
                onPressed: () =>
                    context.push('${AppRoutes.trades}/new?itemId=${item.id}'),
              ),
            ),
          ],
        ),
      Row(
        spacing: AppSpacing.snug,
        children: <Widget>[
          AppIconButton(
            icon: Icons.chat_bubble_outline_rounded,
            semanticLabel: 'Message the seller',
            onPressed: () => context.push(AppRoutes.messages),
          ),
          WatchControl(itemId: item.id),
          Expanded(
            child: AppButton(
              // "Browse" on a binder, because the buyer is asking for specific
              // cards out of an inventory rather than buying the inventory.
              label: item.isShopfront ? 'Browse and buy' : 'Buy',
              variant: AppButtonVariant.action,
              fillWidth: true,
              onPressed: () => context.push('/sales/buy/${item.id}'),
            ),
          ),
        ],
      ),
    ];
  }

  /// The listings section root, as the route table states it once.
  static const String _listingsRoot = '/listings';
}

/// One live contract against this listing, as a row the owner can open.
class _ContractLink extends StatelessWidget {
  const _ContractLink({required this.contract});

  final CashSaleSummary contract;

  @override
  Widget build(BuildContext context) {
    final String buyer = contract.counterpartDisplayName ?? 'A buyer';
    final String amount =
        Money.format(contract.agreedPriceCents, contract.currency);

    return AppButton(
      label: '$buyer · $amount',
      icon: Icons.receipt_long_outlined,
      variant: AppButtonVariant.outline,
      fillWidth: true,
      onPressed: () => context.push('${AppRoutes.sales}/${contract.id}'),
    );
  }
}

/// The docked bar: a `--card` surface with a `--border` top edge and the lift
/// elevation, inset for the device's own bottom padding.
///
/// It is placed in the scaffold's bottom slot, which RESERVES its height, so the
/// foot of the scroll is reachable rather than covered (Req 6.1).
class _DockedBar extends StatelessWidget {
  const _DockedBar({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.card,
        border: const Border(
          top: BorderSide(color: AppColors.border, width: AppMetrics.hairline),
        ),
        boxShadow: AppElevation.lift,
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.cozy),
          child: child,
        ),
      ),
    );
  }
}
