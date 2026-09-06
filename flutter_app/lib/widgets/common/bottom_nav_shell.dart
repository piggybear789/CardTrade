// The bottom bar the whole marketplace sits above, ported from
// `components/layout/MobileBottomNav.tsx`.
//
// Five destinations in the web's order, of which `Contracts` and `Sell` open a
// bottom sheet rather than navigate, because the web keeps the full section
// glossary one tap away without spending a row of the bar on each entry.
//
// The bar stands [AppMetrics.navBar] (56) tall and the bottom safe-area inset is
// padding BELOW that 56, not counted inside it (Req 4.8) — a bar that swallowed
// the inset would be 22 logical pixels shorter than the web's on a notched phone.
// The 56 is a MINIMUM rather than a fixed height so that a label reflows instead
// of being clipped at a large text scale (Req 13.10); at a scale of 1.0 it
// measures exactly 56.
//
// The current destination is marked by WEIGHT and COLOUR TOGETHER — `--iris-ink`
// glyph, `--foreground` semibold label — and by no indicator shape behind the
// icon, so the mark survives a greyscale rendering (Req 4.9, 13.11). Material's
// `NavigationBar`, which this replaced, draws exactly that pill and is 80 tall by
// default, which is why the bar is assembled here instead.
//
// Nothing here decides access. A guest is shown all five destinations, enabled,
// and a gated one carries them to sign-in aimed at that destination (Req 4.11,
// 4.12); the router's own redirect still guards every protected path.
//
// Requirements 4.5–4.13, 4.15–4.17, 13.6–13.9.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/messages_provider.dart';
import 'package:cardtrade/router/hub_set.dart';

/// Wraps a routed screen in the marketplace bottom bar.
class BottomNavShell extends ConsumerWidget {
  const BottomNavShell({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String location = GoRouterState.of(context).matchedLocation;
    final bool isAuthenticated = ref.watch(isAuthenticatedProvider);

    // The MESSAGE count, not the notification count: the badge sits on `Inbox`
    // and a member who taps it expecting unread mail must find unread mail
    // (Req 4.13). The notification count is read by the notifications screen,
    // and reading it here — which this file used to do without rendering it —
    // is what the analyzer recorded as an unused value (Req 4.17).
    final AsyncValue<int> unreadMessages =
        ref.watch(unreadMessagesCountProvider);

    return Scaffold(
      body: child,
      bottomNavigationBar: MobileShellBar(
        currentHubId: currentHub(location)?.id,
        isAuthenticated: isAuthenticated,
        // An unresolved count is null, not zero: "we do not know yet" and "you
        // have none" must not look the same, and neither shows a badge.
        unreadMessageCount: unreadMessages.asData?.value,
        onSelected: (MobileHub hub) => _select(
          context,
          hub,
          isAuthenticated: isAuthenticated,
        ),
      ),
    );
  }

  void _select(
    BuildContext context,
    MobileHub hub, {
    required bool isAuthenticated,
  }) {
    // A guest goes straight to sign-in aimed at the hub's own destination.
    // Opening the sheet instead would show a menu whose every row bounces.
    if (hub.requiresAuth && !isAuthenticated) {
      context.push(signInLocationFor(hub));
      return;
    }

    switch (hub.kind) {
      case MobileHubKind.link:
        context.go(hub.destinations.first.path);
      case MobileHubKind.sheet:
        _openHubSheet(context, hub);
    }
  }

  void _openHubSheet(BuildContext context, MobileHub hub) {
    final String location = GoRouterState.of(context).matchedLocation;
    showModalBottomSheet<void>(
      context: context,
      // The theme owns the fill, the top radius and the drag handle, so a sheet
      // opened from here looks like every other sheet in the app.
      builder: (BuildContext sheetContext) => HubSheet(
        hub: hub,
        location: location,
        onDestination: (HubDestination destination) {
          Navigator.of(sheetContext).pop();
          context.go(destination.path);
        },
      ),
    );
  }
}

/// The bar itself, taking everything it renders as a parameter.
///
/// Split out from [BottomNavShell] deliberately: a widget test and a golden can
/// pump it at a chosen destination, a chosen badge count and a chosen session
/// state without a router, a Supabase client or a provider override.
class MobileShellBar extends StatelessWidget {
  const MobileShellBar({
    required this.currentHubId,
    required this.isAuthenticated,
    required this.onSelected,
    this.unreadMessageCount,
    super.key,
  });

  /// The destination the active route belongs to, or null when the route belongs
  /// to none — in which case every destination wears the not-current treatment
  /// (Req 4.16).
  final MobileHubId? currentHubId;

  /// Whether a session exists. Changes where a gated destination LEADS, never
  /// whether it is shown or enabled (Req 4.11).
  final bool isAuthenticated;

  /// Unread messages, or null while the count is unresolved.
  final int? unreadMessageCount;

  final ValueChanged<MobileHub> onSelected;

  @override
  Widget build(BuildContext context) {
    final EdgeInsets viewPadding = MediaQuery.viewPaddingOf(context);

    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.card,
        border: Border(
          top: BorderSide(color: AppColors.border, width: AppMetrics.hairline),
        ),
      ),
      child: Padding(
        // Below the 56, never inside it (Req 4.8). The horizontal insets keep a
        // landscape cutout off the outermost destinations.
        padding: EdgeInsets.only(
          bottom: viewPadding.bottom,
          left: viewPadding.left,
          right: viewPadding.right,
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppMetrics.navBar),
          // The pair is what makes 56 a floor rather than a cage: IntrinsicHeight
          // asks the destinations how tall they need to be — 56 at a text scale
          // of 1.0, more once a label wraps — and the ConstrainedBox stops the
          // answer falling below the web's 56. `stretch` then gives every
          // destination the full height as its touch area, which is the reason
          // the bar is not simply a `SizedBox(height: 56)`.
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                for (final MobileHub hub in kMobileHubs)
                  Expanded(
                    child: _HubButton(
                      hub: hub,
                      isCurrent: hub.id == currentHubId,
                      // The badge is the Inbox destination's, and no other's.
                      badgeCount: hub.id == MobileHubId.inbox
                          ? unreadMessageCount
                          : null,
                      signInRequired: hub.requiresAuth && !isAuthenticated,
                      onPressed: () => onSelected(hub),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HubButton extends StatelessWidget {
  const _HubButton({
    required this.hub,
    required this.isCurrent,
    required this.badgeCount,
    required this.signInRequired,
    required this.onPressed,
  });

  final MobileHub hub;
  final bool isCurrent;
  final int? badgeCount;
  final bool signInRequired;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final Color glyph =
        isCurrent ? AppColors.irisInk : AppColors.mutedForeground;
    final Color ink = isCurrent ? AppColors.foreground : AppColors.mutedForeground;
    final FontWeight weight = isCurrent ? FontWeight.w600 : FontWeight.w500;

    return Semantics(
      button: true,
      selected: isCurrent,
      // A gated destination says so out loud, because the visible treatment
      // gives a guest no clue that the tap lands on sign-in (Req 4.11).
      label: signInRequired ? '${hub.label}, sign-in required' : hub.label,
      child: InkWell(
        onTap: onPressed,
        child: ExcludeSemantics(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            spacing: AppSpacing.tight,
            children: <Widget>[
              _HubGlyph(
                icon: hub.icon,
                color: glyph,
                badgeCount: badgeCount,
              ),
              Text(
                hub.label,
                // The `meta` level with its own line height and NO size of this
                // widget's own, matching the `text-meta` the web bottom nav
                // applies (Req 4.7).
                style: AppType.meta.copyWith(color: ink, fontWeight: weight),
                textAlign: TextAlign.center,
                // No line cap and no ellipsis: at a 2.0 text scale on a narrow
                // viewport a fifth of the width holds two or three characters,
                // so a cap of any size would cut a label rather than wrap it.
                // The bar grows instead, which is what Req 13.10 asks for and
                // the one thing the web's own `truncate` does not do.
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HubGlyph extends StatelessWidget {
  const _HubGlyph({
    required this.icon,
    required this.color,
    required this.badgeCount,
  });

  final IconData icon;
  final Color color;
  final int? badgeCount;

  /// Above this the count reads as `99+`: three glyphs is as wide as a badge on
  /// a fifth of a phone can be without covering the icon it belongs to
  /// (Req 4.13).
  static const int _badgeCap = 99;

  @override
  Widget build(BuildContext context) {
    final int? count = badgeCount;
    final Widget glyph = Icon(icon, size: AppIconSize.large, color: color);

    // No badge at zero, and none while the count is unresolved.
    if (count == null || count <= 0) return glyph;

    // The box is sized EXPLICITLY rather than left to the stack's children. The
    // bar measures its own intrinsic height, which lays a child out unbounded,
    // and a `Stack` handed unbounded constraints resolves to an infinite size
    // and places its positioned children at NaN.
    return SizedBox(
      width: AppIconSize.large,
      height: AppIconSize.large,
      child: Stack(
        clipBehavior: Clip.none,
        children: <Widget>[
          glyph,
          Positioned(
            // Rising off the glyph's top-trailing corner, the way the web's own
            // count badges sit, and clear of the glyph so it covers none of it.
            top: -AppSpacing.tight,
            left: AppIconSize.large,
            // A child positioned on one edge pair only is laid out unconstrained,
            // so the pill is as wide as its glyphs need and `99+` stays on one
            // line even though the box behind it is 20 pixels wide.
            child: _CountBadge(
              label: count > _badgeCap ? '$_badgeCap+' : '$count',
            ),
          ),
        ],
      ),
    );
  }
}

class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(AppRadius.full),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.tight),
        child: Text(
          label,
          style: AppText.badgeText.copyWith(color: AppColors.primaryForeground),
          maxLines: 1,
        ),
      ),
    );
  }
}

/// The list a `sheet` destination opens: its own rows and nothing else.
///
/// Public for the same reason [MobileShellBar] is — a test pumps it with a fixed
/// location rather than driving a router to reach it.
class HubSheet extends StatelessWidget {
  const HubSheet({
    required this.hub,
    required this.location,
    required this.onDestination,
    super.key,
  });

  final MobileHub hub;

  /// The active route, so a row that is already current can say so.
  final String location;

  final ValueChanged<HubDestination> onDestination;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.group,
              0,
              AppSpacing.group,
              AppSpacing.cozy,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: AppSpacing.tight,
              children: <Widget>[
                Text(hub.sheetTitle ?? hub.label, style: AppText.rowName),
                if (hub.sheetDescription != null)
                  Text(hub.sheetDescription!, style: AppText.supportText),
              ],
            ),
          ),
          const Divider(),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.snug),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                for (final HubDestination destination in hub.destinations)
                  _HubSheetRow(
                    destination: destination,
                    isCurrent: isHubSectionActive(location, destination.path),
                    onPressed: () => onDestination(destination),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HubSheetRow extends StatelessWidget {
  const _HubSheetRow({
    required this.destination,
    required this.isCurrent,
    required this.onPressed,
  });

  final HubDestination destination;
  final bool isCurrent;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final Color glyph =
        isCurrent ? AppColors.irisInk : AppColors.mutedForeground;

    return Semantics(
      button: true,
      selected: isCurrent,
      label: destination.label,
      child: InkWell(
        onTap: onPressed,
        child: ExcludeSemantics(
          child: ColoredBox(
            color: isCurrent ? AppColors.accent : AppColors.card,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.group,
                vertical: AppSpacing.cozy,
              ),
              child: ConstrainedBox(
                // A row is at least a full touch target tall, and the rows are
                // stacked, so no two targets can intersect (Req 13.6).
                constraints: const BoxConstraints(
                  minHeight: AppMetrics.minHitArea,
                ),
                child: Row(
                  spacing: AppSpacing.cozy,
                  children: <Widget>[
                    Icon(
                      destination.icon,
                      size: AppIconSize.large,
                      color: glyph,
                    ),
                    Expanded(
                      child: Text(
                        destination.label,
                        style: isCurrent
                            ? AppText.rowName
                                .copyWith(color: AppColors.accentForeground)
                            : AppText.bodyText
                                .copyWith(fontWeight: FontWeight.w500),
                        // Uncapped, so a row label wraps at a large text scale
                        // rather than losing its end (Req 13.10).
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
