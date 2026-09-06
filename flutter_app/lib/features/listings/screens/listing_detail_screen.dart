// The listing detail screen, ported from `app/(workspace)/listings/[id]/page.tsx`
// and its `ListingDetailStack`.
//
// REGION ORDER IS THE POINT OF THIS FILE. Gallery, then price and title, then
// condition and category, then the seller disclosure, then the description, then
// location — the same facts in the same order the website discloses them, so a
// buyer is never asked to commit on less information than the web gave them
// (Req 6.1). The actions region is DOCKED above the Mobile_Shell for a signed-in
// non-owner looking at an open listing they hold no contract on, and is the last
// region of the scroll for everyone else.
//
// THE ADVISORY IS NOT THE GUARD. The region notice and the seller disclosure are
// disclosure only: `checkRegionCompatibility` is read here so a member who
// arrived from a shared link or their watchlist learns before filling in a
// contract rather than after, and the orchestrator refuses regardless (Req 6.12).
// Nothing on this screen decides eligibility.
//
// REPORTING IS AN ANNOUNCED HANDOFF, not a form that files nothing. See
// [_ReportSheet] (Req 12.2, 12.5).
//
// Requirements 6.1–6.12, 12.2, 12.5, 13.6–13.12, 14.6, 14.12.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import 'package:cardtrade/core/image_url.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/domain/region/regions.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/models/profile.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/offers_provider.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/providers/watchlist_provider.dart';
import 'package:cardtrade/widgets/common/app_scaffold.dart';
import 'package:cardtrade/widgets/common/condition_badge.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/mobile_chrome.dart';
import 'package:cardtrade/widgets/common/price_display.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';

import 'package:cardtrade/features/listings/widgets/listing_actions.dart';
import 'package:cardtrade/features/listings/widgets/listing_description.dart';
import 'package:cardtrade/features/listings/widgets/listing_gallery.dart';
import 'package:cardtrade/features/listings/widgets/listing_notice.dart';
import 'package:cardtrade/features/listings/widgets/listing_seller.dart';

/// One listing, in full.
class ListingDetailScreen extends ConsumerWidget {
  const ListingDetailScreen({required this.itemId, super.key});

  final String itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Item?> itemAsync = ref.watch(itemDetailProvider(itemId));

    return itemAsync.when(
      loading: () => const AppScaffold(body: _DetailSkeleton()),
      error: (Object error, _) => AppScaffold(
        onBack: () => context.pop(),
        body: ErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(itemDetailProvider(itemId)),
        ),
      ),
      data: (Item? item) {
        if (item == null) {
          return AppScaffold(
            onBack: () => context.pop(),
            body: const ErrorView(
              title: 'Listing not found',
              message: 'This listing may have been removed.',
            ),
          );
        }
        return _DetailView(item: item);
      },
    );
  }
}

class _DetailView extends ConsumerWidget {
  const _DetailView({required this.item});

  final Item item;

  /// Shares this listing, through the same web URL the handoff already owns
  /// (Req 14.6).
  void _share() {
    SharePlus.instance.share(
      ShareParams(text: '${item.title} — ${WebHandoff.listing(item.id)}'),
    );
  }

  Future<void> _report(BuildContext context) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _ReportSheet(itemId: item.id),
      );

  Future<void> _makeOffer(BuildContext context) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _MakeOfferSheet(item: item),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? viewerId = ref.watch(currentUserProvider)?.id;
    final bool isOwner = viewerId != null && viewerId == item.ownerId;
    final bool isAuthenticated = viewerId != null;

    final AsyncValue<PublicProfile?> sellerAsync =
        ref.watch(publicProfileProvider(item.ownerId));
    final PublicProfile? seller = sellerAsync.value;

    // A binder or bulk listing is never RESERVED and never SOLD — it holds
    // nothing — so being unclosed is the whole test of whether it is open for
    // business (0064). A single listing is open only while AVAILABLE.
    final bool isOpen = item.isShopfront
        ? item.closedAt == null && !item.hidden
        : item.isAvailable;

    final List<CashSaleSummary> contracts = _liveContractsOnThisItem(ref);
    final List<CashSaleSummary> mine = isOwner
        ? const <CashSaleSummary>[]
        : contracts
            .where((CashSaleSummary sale) => sale.buyerId == viewerId)
            .toList();
    final String? myContractId = mine.isEmpty ? null : mine.first.id;
    final List<CashSaleSummary> openContracts = isOwner
        ? contracts
            .where((CashSaleSummary sale) => sale.sellerId == viewerId)
            .toList()
        : const <CashSaleSummary>[];

    final bool docked = !isOwner && isOpen && myContractId == null;

    final ListingActions actions = ListingActions(
      item: item,
      placement: docked
          ? ListingActionsPlacement.docked
          : ListingActionsPlacement.inline,
      isOwner: isOwner,
      isAuthenticated: isAuthenticated,
      isOpen: isOpen,
      hasSellerDisclosure: _disclosedName(seller) != null,
      regionNotice: _regionNotice(ref, seller, isOwner: isOwner),
      myContractId: myContractId,
      openContracts: openContracts,
      onMakeOffer: () => _makeOffer(context),
    );

    return AppScaffold(
      onBack: () => context.pop(),
      backSemanticLabel: 'Back to the catalog',
      actions: <ChromeAction>[
        ChromeAction(
          icon: Icons.share_outlined,
          semanticLabel: 'Share this listing',
          onPressed: _share,
        ),
        // Reporting is offered to a signed-in non-owner only, as the web strip
        // does: an owner reports their own listing to nobody.
        if (isAuthenticated && !isOwner)
          ChromeAction(
            icon: Icons.flag_outlined,
            semanticLabel: 'Report this listing',
            onPressed: () => _report(context),
          ),
      ],
      bottomBar: docked ? actions : null,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(itemDetailProvider(item.id));
          ref.invalidate(publicProfileProvider(item.ownerId));
        },
        child: ListView(
          padding: EdgeInsets.zero,
          children: <Widget>[
            // ── 1. Gallery ──────────────────────────────────────────────────
            ListingGallery(title: item.title, imagePaths: item.imagePaths),

            Padding(
              padding: const EdgeInsets.all(AppSpacing.group),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                spacing: AppSpacing.group,
                children: <Widget>[
                  // ── 2. Price and title ────────────────────────────────────
                  _PriceAndTitle(item: item),

                  // ── 3. Condition and category ─────────────────────────────
                  _ConditionAndCategory(item: item),

                  // A binder's copy states that NOTHING IS HELD, because on
                  // every other listing opening a contract reserves the goods
                  // and leaving that implicit is the difference between a
                  // disappointed buyer and a misled one (Req 6.7).
                  if (item.isShopfront)
                    const ListingNotice(
                      icon: Icons.collections_bookmark_outlined,
                      message:
                          'This is a binder or bulk listing. Browse it and ask '
                          'the seller for the cards you want — nothing is held '
                          'until you and the seller agree terms.',
                    ),

                  // ── 4. Seller disclosure ──────────────────────────────────
                  ListingSeller(
                    displayName: seller?.displayName,
                    avatarUrl: seller?.avatarPath == null
                        ? null
                        : ImageUrl.avatar(seller!.avatarPath),
                    identityVerified: item.sellerIdentityVerified,
                    disclosedName: _disclosedName(seller),
                    rating: seller?.rating ?? item.sellerRating,
                    ratingCount: seller?.ratingCount ?? 0,
                    isOwner: isOwner,
                    onOpenProfile: () => context
                        .push(isOwner ? '/profile' : '/sellers/${item.ownerId}'),
                  ),

                  // ── 5. Description ────────────────────────────────────────
                  ListingDescription(description: item.description),

                  // ── 6. Location ───────────────────────────────────────────
                  if (item.locationLabel != null)
                    _Location(label: item.locationLabel!),

                  // The actions region, inline as the last region wherever the
                  // docked bar is not drawn (Req 6.1).
                  if (!docked) actions,
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The provider-verified legal name the server discloses for this seller, or
  /// null.
  ///
  /// Read from `public_profiles`, which is the only place the client sees it. A
  /// blank string is an absence, not a name.
  static String? _disclosedName(PublicProfile? seller) {
    final String name = seller?.identityCheckName?.trim() ?? '';
    return name.isEmpty ? null : name;
  }

  /// Every live contract the SERVER already returns to this member, narrowed to
  /// this listing.
  ///
  /// No new query and no new rule: `mySalesProvider` is the member's own
  /// RLS-scoped sales list, and `isTerminalCashSaleStatus` is the existing
  /// predicate for whether one has finished.
  List<CashSaleSummary> _liveContractsOnThisItem(WidgetRef ref) {
    final List<CashSaleSummary> sales = ref.watch(mySalesProvider).value ??
        const <CashSaleSummary>[];
    return sales
        .where((CashSaleSummary sale) =>
            sale.itemId == item.id && !isTerminalCashSaleStatus(sale.status))
        .toList();
  }

  /// Why this viewer and this seller cannot contract across their regions, or
  /// null.
  ///
  /// Evaluated ONLY through `checkRegionCompatibility`, the same rule the
  /// orchestrator follows. A viewer who has simply not set their own region is
  /// not warned here: that is their own incomplete onboarding rather than
  /// anything about this listing, and it is surfaced where it can be fixed.
  String? _regionNotice(
    WidgetRef ref,
    PublicProfile? seller, {
    required bool isOwner,
  }) {
    if (isOwner) return null;
    final Profile? viewer = ref.watch(myProfileProvider).value;
    if (viewer == null || seller == null) return null;
    final RegionMismatch? mismatch =
        checkRegionCompatibility(viewer.regionCode, seller.regionCode);
    if (mismatch == null) return null;
    if (mismatch.reason == RegionMismatchReason.unknownRegion) return null;
    return mismatch.message;
  }
}

/// The hero price and the listing's title.
///
/// The price is the `display` level of the Type_Scale and nothing else on this
/// screen is drawn larger (Req 6.2). A binder's figure is an indicative "from",
/// which the role marks in words rather than by shrinking a fraction of it.
class _PriceAndTitle extends StatelessWidget {
  const _PriceAndTitle({required this.item});

  final Item item;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: AppSpacing.snug,
      children: <Widget>[
        PriceDisplay(
          minorUnits: item.fmvCents,
          currency: item.currency,
          size: PriceSize.large,
          showFromPrefix: item.isShopfront,
        ),
        Text(
          item.title,
          // No line cap: a title cut at a 2.0 text scale is a listing a member
          // cannot name (Req 13.10).
          style: AppType.subhead.copyWith(
            fontWeight: FontWeight.w600,
            color: AppColors.foreground,
          ),
        ),
      ],
    );
  }
}

/// The condition, the card game, and how many members are watching.
class _ConditionAndCategory extends ConsumerWidget {
  const _ConditionAndCategory({required this.item});

  final Item item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int watchCount = ref.watch(watchCountProvider(item.id)).value ?? 0;
    final List<String> meta = <String>[
      item.category,
      item.isShopfront ? 'Binder or bulk listing' : 'Single item',
      if (watchCount > 0) watchCount == 1 ? '1 save' : '$watchCount saves',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: AppSpacing.snug,
      children: <Widget>[
        // A binder holds mixed stock, so it states no single condition.
        if (!item.isShopfront && item.condition.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: ConditionBadge(condition: item.condition),
          ),
        Text(meta.join(' · '), style: AppText.metaText),
      ],
    );
  }
}

/// Where the goods are, to suburb precision and no finer.
class _Location extends StatelessWidget {
  const _Location({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      spacing: AppSpacing.snug,
      children: <Widget>[
        const ExcludeSemantics(
          child: Icon(
            Icons.location_on_outlined,
            size: AppIconSize.base,
            color: AppColors.mutedForeground,
          ),
        ),
        Expanded(
          child: Text('Based near $label', style: AppText.supportText),
        ),
      ],
    );
  }
}

/// The detail screen while it loads: the same regions, at the same sizes.
///
/// The gallery box is reserved to the shape the gallery will draw, so the copy
/// below it does not walk down the screen when the photo arrives (Req 11.1).
class _DetailSkeleton extends StatelessWidget {
  const _DetailSkeleton();

  @override
  Widget build(BuildContext context) {
    return const SkeletonRegion(
      announcement: 'Loading this listing',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          AspectRatio(
            aspectRatio: 1,
            child: SkeletonBox(height: double.infinity, borderRadius: 0),
          ),
          Padding(
            padding: EdgeInsets.all(AppSpacing.group),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: AppSpacing.group,
              children: <Widget>[
                SkeletonTextLines(level: AppText.priceHero, widths: <double>[0.4]),
                SkeletonTextLines(
                    level: AppType.subhead, widths: <double>[1, 0.7]),
                SkeletonTextLines(level: AppText.metaText, widths: <double>[0.5]),
                SkeletonTextLines(
                    level: AppText.bodyText, widths: <double>[1, 1, 0.8]),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Report Sheet ─────────────────────────────────────────────────────────────

/// Reporting a listing — an announced handoff to the website (Req 12.2, 12.5).
///
/// THIS SHEET USED TO BE A FORM THAT FILED NOTHING. It collected a reason and a
/// description, enabled a "Submit report" button, closed itself and then said in a
/// snack bar that reporting was not available — after the member had written their
/// evidence out and watched it be discarded. `lib/actions/reports.ts` is a Server
/// Action with no mobile endpoint in front of it, so the app cannot file the
/// report; that is a reason to hand off, not a reason to mime the form.
///
/// The control is NOT removed. Removing it would leave a member looking at a
/// counterfeit or a scam with no way to raise it, which is worse than a browser
/// trip.
class _ReportSheet extends StatelessWidget {
  const _ReportSheet({required this.itemId});

  final String itemId;

  @override
  Widget build(BuildContext context) {
    final Uri page = WebHandoff.reportListing(itemId);

    return _SheetFrame(
      title: 'Report this listing',
      children: <Widget>[
        const Text(
          'Reports go to our moderation queue with the listing attached. The '
          'seller is not told who reported them.',
          style: AppText.supportText,
          softWrap: true,
        ),
        Text(
          'Opens ${WebHandoff.pageLabel(page)} in your browser. You will leave '
          'the app.',
          style: AppText.metaText,
          softWrap: true,
        ),
        AppButton(
          label: 'Report this listing on the website',
          icon: Icons.open_in_new_rounded,
          variant: AppButtonVariant.action,
          fillWidth: true,
          // The browser is opened while this context is still mounted, so a
          // failure to launch can still be reported on it. The sheet closes
          // afterwards rather than before.
          onPressed: () async {
            await WebHandoff.openOrWarn(context, page);
            if (context.mounted) Navigator.of(context).pop();
          },
        ),
      ],
    );
  }
}

// ─── Make Offer Sheet ─────────────────────────────────────────────────────────

/// An offer on a SINGLE listing: one amount against one object.
///
/// A binder is never offered on — one amount against a whole inventory says
/// nothing about which cards — which is why the control that opens this sheet is
/// absent there (0081, Req 6.10).
class _MakeOfferSheet extends ConsumerStatefulWidget {
  const _MakeOfferSheet({required this.item});

  final Item item;

  @override
  ConsumerState<_MakeOfferSheet> createState() => _MakeOfferSheetState();
}

class _MakeOfferSheetState extends ConsumerState<_MakeOfferSheet> {
  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _messageController = TextEditingController();
  bool _isSubmitting = false;
  String? _amountError;

  @override
  void dispose() {
    _amountController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  /// Parses a major-unit string to integer minor units using INTEGER math only.
  /// Returns null where the input is not an amount.
  int? _parseToMinorUnits(String input) {
    final String trimmed = input.trim();
    if (trimmed.isEmpty) return null;

    final List<String> parts = trimmed.split('.');
    if (parts.length > 2) return null;

    final int? whole = int.tryParse(parts[0]);
    if (whole == null || whole < 0) return null;

    int fraction = 0;
    if (parts.length == 2) {
      String digits = parts[1];
      if (digits.length > 2) return null;
      digits = digits.padRight(2, '0');
      fraction = int.tryParse(digits) ?? 0;
    }

    return whole * 100 + fraction;
  }

  Future<void> _submit() async {
    final int? minorUnits = _parseToMinorUnits(_amountController.text);
    if (minorUnits == null || minorUnits <= 0) {
      setState(() => _amountError = 'Enter an amount greater than zero.');
      return;
    }

    setState(() {
      _amountError = null;
      _isSubmitting = true;
    });
    try {
      final String message = _messageController.text.trim();
      await ref.read(offersServiceProvider).makeOffer(
            itemId: widget.item.id,
            amountCents: minorUnits,
            message: message.isEmpty ? null : message,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Your offer has been sent')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _amountError = ErrorView.sanitise(error.toString()));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _SheetFrame(
      title: 'Make an offer',
      children: <Widget>[
        Text(
          'Asking ${Money.format(widget.item.fmvCents, widget.item.currency)}',
          style: AppText.supportText,
        ),
        AppTextField(
          controller: _amountController,
          label: 'Your offer',
          hint: '0.00',
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          errorText: _amountError,
          enabled: !_isSubmitting,
        ),
        AppTextField(
          controller: _messageController,
          label: 'Message (optional)',
          maxLines: 2,
          enabled: !_isSubmitting,
        ),
        AppButton(
          label: _isSubmitting ? 'Sending…' : 'Send offer',
          variant: AppButtonVariant.action,
          fillWidth: true,
          onPressed: _isSubmitting ? null : _submit,
        ),
      ],
    );
  }
}

/// The shared frame both sheets sit in: drag handle, title, then content spaced
/// far enough apart that adjacent 48-pixel touch targets do not intersect
/// (Req 13.6).
class _SheetFrame extends StatelessWidget {
  const _SheetFrame({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  /// The drag handle's drawn size — a decorative bar, not a control.
  static const double _handleWidth = AppSpacing.section + AppSpacing.snug;
  static const double _handleHeight = AppSpacing.tight;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.group,
        right: AppSpacing.group,
        top: AppSpacing.cozy,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.group,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpacing.group,
        children: <Widget>[
          Center(
            child: ExcludeSemantics(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
                child: const SizedBox(
                  width: _handleWidth,
                  height: _handleHeight,
                ),
              ),
            ),
          ),
          Text(
            title,
            style: AppType.subhead.copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.foreground,
            ),
          ),
          ...children,
        ],
      ),
    );
  }
}
