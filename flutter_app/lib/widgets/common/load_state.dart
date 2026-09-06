// The four states a list of server data can be in, and the gate between them.
//
// Every list screen in the client had its own answer to "what is on screen while
// this loads, when it fails, and when a pull fails" — a bare spinner here, a raw
// `error.toString()` there, and a `RefreshIndicator` whose `onRefresh` returned
// before the request did, so a second pull issued a second request. This module is
// the one answer.
//
// FOUR THINGS LIVE HERE BECAUSE THEY ARE ONE DECISION.
//
//  * [SkeletonGate] owns the timing boundary of Req 11.8: a request that resolves
//    inside 200 ms never shows a skeleton, and a skeleton that HAS been shown stays
//    for 500 ms. Both halves exist to stop a flash — one before it starts, one
//    after — and putting them in a screen would mean nine copies of a clock.
//  * `RequestFailure`, which turns an error value into an explanation naming the
//    operation that failed, lives next to `ErrorView.sanitise` in `error_view.dart`
//    — one module for what a member is told about a failure (Req 11.4, 11.10).
//  * [PullToRefresh] keeps the content on screen while a pull is in flight, ignores
//    a further pull while one is running, and reports a failed refresh as a notice
//    OVER the content rather than replacing it (Req 11.5, 11.6, 11.10).
//  * [AsyncStateView] composes the three so a screen states its skeleton, its
//    settled content and the name of its operation, and nothing else.
//
// WHAT IS NOT HERE. The empty and filtered-to-empty states (Req 11.3, 11.9) stay
// with the screen: only the screen knows its copy and which filters are active.
// [PullableFill] is what makes them pullable anyway, since a centred column is not
// a scrollable and `RefreshIndicator` needs one.
//
// NO NEW REQUEST CAPABILITY. Nothing here reads a table, an RPC or an endpoint. A
// retry and a pull both call the callback the screen already had (Req 14.12).
//
// Requirements 11.1, 11.4–11.6, 11.8, 11.10, 13.6–13.12, 14.12.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import 'controls.dart';
import 'error_view.dart';
import 'skeleton.dart';

/// Decides WHEN a skeleton is on screen, given whether the data is still loading.
///
/// The builder is handed `showSkeleton` rather than a widget, so this works the
/// same in a sliver list as in a box: the caller returns whichever it needs.
///
/// The two boundaries (Req 11.8):
///
///  * a load that settles within [suppressBelow] never shows a placeholder, so a
///    warm cache reads as an instant screen rather than as a flicker;
///  * a placeholder that HAS appeared stays at least [minimumVisible], so a load
///    settling at 210 ms does not strobe.
class SkeletonGate extends StatefulWidget {
  const SkeletonGate({
    required this.isLoading,
    required this.builder,
    super.key,
  });

  /// Whether the data this stands in for is still outstanding.
  final bool isLoading;

  /// Builds the subtree. `showSkeleton` is true exactly while the placeholder is
  /// the thing to draw.
  final Widget Function(BuildContext context, bool showSkeleton) builder;

  /// A load faster than this never presents a placeholder.
  static const Duration suppressBelow = Duration(milliseconds: 200);

  /// Once presented, a placeholder stays at least this long.
  static const Duration minimumVisible = Duration(milliseconds: 500);

  @override
  State<SkeletonGate> createState() => _SkeletonGateState();
}

/// Both boundaries are driven by timers rather than by a clock read.
///
/// A `DateTime.now()` subtraction would have been the obvious way to measure how
/// long the placeholder had been up, and it does not work: a widget test drives
/// `Timer` from a fake clock while `DateTime.now()` keeps reading the wall clock,
/// so the elapsed time the gate computed bore no relation to the time the test had
/// advanced. Two timers say the same thing and say it in the one clock everything
/// else in the frame uses.
class _SkeletonGateState extends State<SkeletonGate> {
  /// Whether the placeholder is the thing to draw.
  bool _showSkeleton = false;

  /// Whether the placeholder has been up for its floor.
  bool _floorElapsed = false;

  /// Whether the data arrived before the floor did.
  bool _settlePending = false;

  Timer? _suppression;
  Timer? _floor;

  @override
  void initState() {
    super.initState();
    if (widget.isLoading) _armSuppression();
  }

  @override
  void didUpdateWidget(SkeletonGate oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isLoading == oldWidget.isLoading) return;
    if (widget.isLoading) {
      _settlePending = false;
      if (!_showSkeleton) _armSuppression();
    } else {
      _settle();
    }
  }

  @override
  void dispose() {
    _suppression?.cancel();
    _floor?.cancel();
    super.dispose();
  }

  /// Waits out the suppression window before showing anything.
  void _armSuppression() {
    _suppression?.cancel();
    _suppression = Timer(SkeletonGate.suppressBelow, () {
      if (!mounted || !widget.isLoading) return;
      setState(() {
        _showSkeleton = true;
        _floorElapsed = false;
      });
      _floor?.cancel();
      _floor = Timer(SkeletonGate.minimumVisible, () {
        if (!mounted) return;
        _floorElapsed = true;
        if (_settlePending) _hide();
      });
    });
  }

  /// The data has arrived. Drop the placeholder, but not before its floor.
  void _settle() {
    _suppression?.cancel();
    _suppression = null;
    if (!_showSkeleton) return;
    if (_floorElapsed) {
      _hide();
    } else {
      _settlePending = true;
    }
  }

  void _hide() {
    _settlePending = false;
    if (widget.isLoading || !_showSkeleton) return;
    setState(() => _showSkeleton = false);
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _showSkeleton);
}

/// A pull-to-refresh gesture that keeps what is on screen.
///
/// Three behaviours the bare `RefreshIndicator` call sites did not have:
///
///  * a second pull while a refresh is in flight joins the one already running
///    instead of issuing another request (Req 11.6);
///  * the content stays visible throughout, placeholder-free (Req 11.5);
///  * a refresh that fails says so in a notice drawn OVER the content, so a
///    failed refresh — offline or otherwise — never costs a member the rows they
///    were already reading (Req 11.5, 11.10).
class PullToRefresh extends StatefulWidget {
  const PullToRefresh({
    required this.onRefresh,
    required this.operation,
    required this.child,
    super.key,
  });

  /// The request to reissue. The screen's own, unchanged.
  final Future<void> Function() onRefresh;

  /// Member-facing name of what is being refreshed, for [RequestFailure].
  final String operation;

  /// The scrollable presenting the content.
  final Widget child;

  @override
  State<PullToRefresh> createState() => _PullToRefreshState();
}

class _PullToRefreshState extends State<PullToRefresh> {
  Future<void>? _inFlight;
  RequestFailure? _failure;

  /// Returns the refresh already running, if there is one.
  Future<void> _run() {
    final Future<void>? existing = _inFlight;
    if (existing != null) return existing;
    final Future<void> started = _refresh();
    _inFlight = started;
    return started;
  }

  Future<void> _refresh() async {
    try {
      await widget.onRefresh();
      if (mounted && _failure != null) setState(() => _failure = null);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _failure = RequestFailure.from(error, operation: widget.operation);
      });
    } finally {
      _inFlight = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final RequestFailure? failure = _failure;
    return Stack(
      children: <Widget>[
        RefreshIndicator(
          onRefresh: _run,
          color: AppColors.iris,
          child: widget.child,
        ),
        if (failure != null)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: RefreshFailureNotice(
              failure: failure,
              // Enabled whether or not the device is on line: a member who has
              // just walked back into signal should not have to find a way to
              // re-enable the control (Req 11.10).
              onRetry: _run,
              onDismiss: () => setState(() => _failure = null),
            ),
          ),
      ],
    );
  }
}

/// Says that a refresh failed, without taking the content away.
class RefreshFailureNotice extends StatelessWidget {
  const RefreshFailureNotice({
    required this.failure,
    required this.onRetry,
    required this.onDismiss,
    super.key,
  });

  final RequestFailure failure;
  final VoidCallback onRetry;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTint.alert.fill,
      child: Container(
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: AppTint.alert.edge!,
              width: AppMetrics.hairline,
            ),
          ),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.group,
          vertical: AppSpacing.snug,
        ),
        child: Row(
          children: <Widget>[
            ExcludeSemantics(
              child: Icon(
                failure.icon,
                size: AppIconSize.base,
                color: AppTint.alert.ink,
              ),
            ),
            const SizedBox(width: AppSpacing.snug),
            Expanded(
              child: Semantics(
                liveRegion: true,
                child: Text(
                  ErrorView.sanitise(failure.refreshMessage),
                  style: AppText.supportText,
                  softWrap: true,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.snug),
            AppIconButton(
              icon: Icons.refresh_rounded,
              semanticLabel: 'Try the refresh again',
              onPressed: onRetry,
            ),
            AppIconButton(
              icon: Icons.close_rounded,
              semanticLabel: 'Dismiss this message',
              onPressed: onDismiss,
            ),
          ],
        ),
      ),
    );
  }
}

/// Makes a state that does not scroll pullable anyway.
///
/// An empty state, a filtered-to-empty state and an error state are all centred
/// columns, and `RefreshIndicator` drives a `Scrollable` — so without this the one
/// screen a member most wants to refresh is the one they cannot (Req 11.6).
class PullableFill extends StatelessWidget {
  const PullableFill({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: <Widget>[
        SliverFillRemaining(hasScrollBody: false, child: child),
      ],
    );
  }
}

/// A list of server data in whichever of its four states it is in.
///
/// The screen supplies the placeholder, the settled content and the name of the
/// operation; this decides which is on screen and when.
///
/// The order of the branches is the point. A value that has ever been reported is
/// drawn even while a re-read is outstanding and even when that re-read FAILED —
/// so a refresh never blanks the screen and an offline refresh never costs the
/// member their rows (Req 11.5, 11.10). Only a first load with nothing to show
/// reaches the placeholder or the error state.
class AsyncStateView<T> extends StatelessWidget {
  const AsyncStateView({
    required this.value,
    required this.operation,
    required this.onRetry,
    required this.skeleton,
    required this.builder,
    this.loadingAnnouncement = 'Loading content',
    super.key,
  });

  /// The provider's state, as the screen watches it.
  final AsyncValue<T> value;

  /// Member-facing name of the request, e.g. `'your trades'`.
  final String operation;

  /// Reissues the request. Used by the retry control AND by the pull gesture, so
  /// there is one request path and not two.
  final Future<void> Function() onRetry;

  /// The placeholder standing in for [builder]'s layout.
  final WidgetBuilder skeleton;

  /// The settled content, including this screen's own empty states.
  final Widget Function(BuildContext context, T data) builder;

  /// What assistive technology hears once per load.
  final String loadingAnnouncement;

  @override
  Widget build(BuildContext context) {
    // The gate is OUTSIDE the settled branches, not inside the loading one. Put it
    // inside and the 500 ms floor never applies: the arriving value would flip the
    // branch itself, and a load settling at 210 ms would show a placeholder for ten
    // milliseconds (Req 11.8).
    return SkeletonGate(
      isLoading: !value.hasValue && !value.hasError,
      builder: (BuildContext context, bool showSkeleton) {
        if (showSkeleton) {
          return SkeletonRegion(
            announcement: loadingAnnouncement,
            child: skeleton(context),
          );
        }

        if (value.hasValue) {
          return PullToRefresh(
            onRefresh: onRetry,
            operation: operation,
            child: builder(context, value.requireValue),
          );
        }

        if (value.hasError) {
          return PullToRefresh(
            onRefresh: onRetry,
            operation: operation,
            child: PullableFill(
              child: ErrorView.forFailure(
                RequestFailure.from(value.error!, operation: operation),
                onRetry: () => onRetry(),
              ),
            ),
          );
        }

        // Inside the suppression window. An empty box, not a spinner: presenting
        // one loading treatment for 200 ms and a different one after would be two
        // loading states rather than one.
        return const SizedBox.shrink();
      },
    );
  }
}
