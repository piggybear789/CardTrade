// The watchlist control, drawn at its caller's size and touched at 48 (Req 5.5).
//
// Lifted out of `listing_card.dart` because the listing DETAIL action bar carries
// the same control (Req 6.10). Two copies of an optimistic toggle is two copies
// of the rule about what a member is shown while the server has not answered,
// and those are exactly the two that drift.
//
// The new state is presented on the frame the member's touch lands, before the
// network call is issued. The previous state is restored, with an error saying the
// change did not save, if the call fails OR has not resolved inside
// [WatchControl.settleTimeout] (Req 5.6).
//
// Requirements 5.5, 5.6, 6.10, 13.6, 13.7.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/watchlist_provider.dart';
import 'package:cardtrade/widgets/common/controls.dart';

/// A watchlist toggle for one listing.
class WatchControl extends ConsumerStatefulWidget {
  const WatchControl({
    required this.itemId,
    this.visibleSize = AppMetrics.watchControl,
    this.background = AppColors.card,
    super.key,
  });

  final String itemId;

  /// Drawn diameter. The card's cover overlay uses 32; the detail action bar uses
  /// the standard 40 control height. Both get a 48 target.
  final double visibleSize;

  /// The disc behind the glyph.
  final Color background;

  /// How long a member is asked to believe an unconfirmed change.
  static const Duration settleTimeout = Duration(seconds: 10);

  @override
  ConsumerState<WatchControl> createState() => _WatchControlState();
}

class _WatchControlState extends ConsumerState<WatchControl> {
  /// The state the member has asked for and the server has not yet confirmed.
  bool? _pending;

  Future<void> _toggle(bool watching) async {
    final bool wanted = !watching;
    setState(() => _pending = wanted);

    try {
      final service = ref.read(watchlistServiceProvider);
      final Future<void> call = wanted
          ? service.addToWatchlist(widget.itemId)
          : service.removeFromWatchlist(widget.itemId);
      await call.timeout(WatchControl.settleTimeout);
      ref.invalidate(isWatchingProvider(widget.itemId));
      ref.invalidate(watchCountProvider(widget.itemId));
      ref.invalidate(savedItemsProvider);
      // The optimistic value is HELD until the provider reports the same thing,
      // rather than cleared here: clearing it immediately snaps the heart back
      // to the stale provider value for as long as the refetch takes.
    } catch (_) {
      if (!mounted) return;
      setState(() => _pending = null);
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(content: Text('Could not save that change')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<bool> known = ref.watch(isWatchingProvider(widget.itemId));
    final bool confirmed = known.value ?? false;
    // A pending value the provider has caught up with is no longer pending, so
    // it stops being consulted. Derived here rather than written back during a
    // build, which would be a state mutation inside a paint.
    final bool watching = (_pending == confirmed ? null : _pending) ?? confirmed;

    return AppIconButton(
      icon: watching ? Icons.favorite_rounded : Icons.favorite_border_rounded,
      iconSize: AppIconSize.base,
      visibleSize: widget.visibleSize,
      background: widget.background,
      foreground: watching ? AppColors.destructive : AppColors.foreground,
      semanticLabel: watching ? 'Remove from watchlist' : 'Add to watchlist',
      onPressed: () => _toggle(confirmed),
    );
  }
}
