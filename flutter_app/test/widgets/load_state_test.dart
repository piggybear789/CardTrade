// Feature: mobile-visual-parity — Property 15, the skeleton instance.
//
// Property 15: for any scalar input, the rendered result matches the band the
// requirement assigns it, INCLUDING at the boundary value itself. The scalar here
// is elapsed time and the bands are Req 11.8's two: a read that settles inside
// `SkeletonGate.suppressBelow` never presents a placeholder, and a placeholder that
// HAS been presented stays for `SkeletonGate.minimumVisible`.
//
// THE BOUNDARY IS THE WHOLE TEST. A gate asserted only at 100 ms and 900 ms passes
// with either comparison written the wrong way round; the cases below settle at the
// boundary itself, one tick below it and one tick above it, which is the pair that
// separates `>` from `>=`.
//
// TIME IS THE FAKE CLOCK'S, NOT THE WALL CLOCK'S. `SkeletonGate` measures with two
// `Timer`s for exactly this reason: `tester.pump(duration)` advances the fake clock
// that drives `Timer`, while `DateTime.now()` keeps reading the real one. A gate that
// subtracted wall-clock instants would report zero elapsed time here no matter how
// far the test advanced, and every assertion below would be vacuously true.
//
// The rest of the file covers the behaviours `PullToRefresh` and `AsyncStateView`
// own: content is kept through a refresh and through a FAILED refresh, a second pull
// joins the one in flight rather than issuing a second request, and a lost connection
// is explained as a lost connection with its retry still live (Req 11.5, 11.6, 11.10).
//
// Validates: Requirements 11.5, 11.6, 11.8, 11.10.

import 'dart:async';
import 'dart:io' show SocketException;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';

import '../support/harness.dart';

/// A single tick, used to sit either side of a boundary.
const Duration _tick = Duration(milliseconds: 1);

/// Drives [SkeletonGate] from a test, so the "request" settles when the test says.
class _GateHost extends StatefulWidget {
  const _GateHost({required this.controller});

  final StreamController<bool> controller;

  @override
  State<_GateHost> createState() => _GateHostState();
}

class _GateHostState extends State<_GateHost> {
  bool _loading = true;
  StreamSubscription<bool>? _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = widget.controller.stream.listen((bool loading) {
      setState(() => _loading = loading);
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SkeletonGate(
      isLoading: _loading,
      builder: (BuildContext context, bool showSkeleton) => showSkeleton
          ? const SkeletonListTile()
          : const Text('the settled content'),
    );
  }
}

/// Whether a placeholder is currently on screen.
bool _showingSkeleton() => find.byType(SkeletonListTile).evaluate().isNotEmpty;

/// Whether the settled content is currently on screen.
bool _showingContent() =>
    find.text('the settled content').evaluate().isNotEmpty;

void main() {
  group('Property 15: the skeleton gate respects both of its boundaries', () {
    late StreamController<bool> loading;

    setUp(() => loading = StreamController<bool>.broadcast());
    tearDown(() => loading.close());

    Future<void> pumpGate(WidgetTester tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(
        pumpFixture(_GateHost(controller: loading), reduceMotion: true),
      );
    }

    /// Reports the read as settled and lets the gate rebuild on it.
    ///
    /// TWO pumps, and neither advances the clock: the first delivers the stream
    /// event, whose `setState` lands after that frame has been built, and the
    /// second draws the result. A single pump measures the frame BEFORE the gate
    /// saw the value, which reads as the floor holding when it is not.
    Future<void> settle(WidgetTester tester) async {
      loading.add(false);
      await tester.pump();
      await tester.pump();
    }

    /// Unmounts the gate so its timers are cancelled, as leaving the screen would.
    Future<void> teardownGate(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    }

    testWidgets('nothing is drawn inside the suppression window',
        (tester) async {
      await pumpGate(tester);

      // Req 11.8's first half is about what is NOT on screen. A spinner here
      // would be a second loading treatment for 200 milliseconds.
      expect(_showingSkeleton(), isFalse);
      await tester.pump(SkeletonGate.suppressBelow - _tick);
      expect(
        _showingSkeleton(),
        isFalse,
        reason: 'one tick before the boundary is still inside the window',
      );

      await teardownGate(tester);
    });

    testWidgets('a read settling one tick before the boundary shows no skeleton',
        (tester) async {
      await pumpGate(tester);
      await tester.pump(SkeletonGate.suppressBelow - _tick);

      await settle(tester);

      expect(_showingContent(), isTrue);
      expect(_showingSkeleton(), isFalse);

      // And it never appears afterwards: the suppression timer must have been
      // cancelled rather than merely ignored.
      await tester.pump(SkeletonGate.minimumVisible * 2);
      expect(_showingSkeleton(), isFalse);

      await teardownGate(tester);
    });

    testWidgets('a read settling AT the boundary has already shown the skeleton',
        (tester) async {
      await pumpGate(tester);
      await tester.pump(SkeletonGate.suppressBelow);

      expect(
        _showingSkeleton(),
        isTrue,
        reason: 'the boundary itself belongs to the visible band',
      );

      await teardownGate(tester);
    });

    testWidgets('a skeleton that appeared stays for its whole floor',
        (tester) async {
      await pumpGate(tester);
      await tester.pump(SkeletonGate.suppressBelow);
      expect(_showingSkeleton(), isTrue);

      // The read settles 10 ms after the placeholder appeared — the case that
      // strobes without the floor.
      await tester.pump(const Duration(milliseconds: 10));
      await settle(tester);

      expect(
        _showingSkeleton(),
        isTrue,
        reason: 'the value arrived, but the floor has not elapsed',
      );

      await tester.pump(SkeletonGate.minimumVisible - const Duration(milliseconds: 10) - _tick);
      expect(
        _showingSkeleton(),
        isTrue,
        reason: 'one tick before the floor is still inside it',
      );

      await tester.pump(_tick);
      expect(_showingSkeleton(), isFalse);
      expect(_showingContent(), isTrue);

      await teardownGate(tester);
    });

    testWidgets('a read outlasting the floor settles the moment it arrives',
        (tester) async {
      await pumpGate(tester);
      await tester.pump(SkeletonGate.suppressBelow);
      await tester.pump(SkeletonGate.minimumVisible);
      expect(_showingSkeleton(), isTrue, reason: 'still loading');

      await settle(tester);

      expect(
        _showingSkeleton(),
        isFalse,
        reason: 'the floor is spent, so there is nothing left to wait for',
      );
      expect(_showingContent(), isTrue);

      await teardownGate(tester);
    });

    test('the boundaries are the values Req 11.8 fixes', () {
      // Stated as an assertion rather than left implicit in the cases above: the
      // criterion names 200 and 500 milliseconds, and every case here is written
      // against the constants.
      expect(SkeletonGate.suppressBelow, const Duration(milliseconds: 200));
      expect(SkeletonGate.minimumVisible, const Duration(milliseconds: 500));
    });
  });

  group('a pull keeps what is on screen', () {
    /// A list of rows over a refresh the test controls.
    Widget listOf(
      Future<void> Function() onRefresh, {
      String operation = 'your trades',
    }) {
      return PullToRefresh(
        onRefresh: onRefresh,
        operation: operation,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: <Widget>[
            for (int i = 0; i < 6; i++)
              SizedBox(height: 80, child: Text('row $i')),
          ],
        ),
      );
    }

    /// Performs the pull gesture the indicator listens for.
    ///
    /// The second pump is not decoration: `RefreshIndicator` calls `onRefresh`
    /// only once the overscroll has animated to the armed position, so a single
    /// pump measures a gesture that has not yet asked for anything.
    Future<void> pull(WidgetTester tester) async {
      await tester.fling(find.text('row 0'), const Offset(0, 320), 1000);
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
    }

    testWidgets('a second pull joins the refresh already in flight',
        (tester) async {
      int requests = 0;
      final Completer<void> inFlight = Completer<void>();

      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(
        pumpFixture(
          listOf(() {
            requests++;
            return inFlight.future;
          }),
          reduceMotion: true,
        ),
      );

      await pull(tester);
      expect(requests, 1);

      // A second gesture while the first is outstanding. Req 11.6: it joins,
      // rather than issuing a second read of the same list.
      await pull(tester);
      expect(requests, 1, reason: 'the second pull issued its own request');

      inFlight.complete();
      await tester.pumpAndSettle();

      // And a pull AFTER it settled is a new request, so single-flight has not
      // become no-flight.
      await pull(tester);
      expect(requests, 2);
      await tester.pumpAndSettle();
    });

    testWidgets('a failed refresh keeps the rows and explains itself over them',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(
        pumpFixture(
          listOf(() async => throw Exception('the refresh did not complete')),
          reduceMotion: true,
        ),
      );

      await pull(tester);
      await tester.pumpAndSettle();

      // Req 11.5: the rows a member was reading are still theirs.
      expect(find.text('row 0'), findsOneWidget);
      expect(find.byType(RefreshFailureNotice), findsOneWidget);
      expect(find.text('We couldn\'t refresh your trades. This is what we last heard.'),
          findsOneWidget);
    });

    testWidgets('an offline refresh names the connection and stays retryable',
        (tester) async {
      int requests = 0;
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(
        pumpFixture(
          listOf(() async {
            requests++;
            throw const SocketException('Failed host lookup: api.example.test');
          }),
          reduceMotion: true,
        ),
      );

      await pull(tester);
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Your device isn\'t connected'),
        findsOneWidget,
      );
      expect(find.text('row 0'), findsOneWidget);

      // Req 11.10: the retry stays enabled while offline, because a member who has
      // walked back into signal must not have to find a way to re-enable it.
      await tester.tap(find.bySemanticsLabel('Try the refresh again'));
      await tester.pumpAndSettle();
      expect(requests, 2);

      // And it can be dismissed, leaving the rows behind.
      await tester.tap(find.bySemanticsLabel('Dismiss this message'));
      await tester.pumpAndSettle();
      expect(find.byType(RefreshFailureNotice), findsNothing);
      expect(find.text('row 0'), findsOneWidget);
    });
  });

  group('AsyncStateView draws the branch its value is in', () {
    Widget viewOf(AsyncValue<List<String>> value) => AsyncStateView<List<String>>(
          value: value,
          operation: 'your messages',
          onRetry: () async {},
          skeleton: (_) => const SkeletonListTile(),
          builder: (BuildContext context, List<String> rows) => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            children: <Widget>[for (final String row in rows) Text(row)],
          ),
        );

    testWidgets('a value that has been reported survives a failing re-read',
        (tester) async {
      // Driven through a REAL provider rather than by composing an `AsyncValue`
      // by hand: the retained-value-with-an-error state is Riverpod's own, and
      // the only public way to reach it is to let a provider that has reported a
      // value be re-read and throw — which is exactly the sequence a member's
      // failed refresh performs.
      bool failing = false;
      final FutureProvider<List<String>> rows =
          FutureProvider<List<String>>((Ref ref) async {
        if (failing) {
          throw const SocketException('Failed host lookup: api.example.test');
        }
        return <String>['a conversation'];
      });

      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(
        ProviderScope(
          child: pumpFixture(
            Consumer(
              builder: (BuildContext context, WidgetRef ref, Widget? _) =>
                  viewOf(ref.watch(rows)),
            ),
            reduceMotion: true,
          ),
        ),
      );
      await tester.pump();
      await tester.pump(SkeletonGate.suppressBelow);
      expect(find.text('a conversation'), findsOneWidget);

      final ProviderContainer container = ProviderScope.containerOf(
        tester.element(find.byType(Consumer)),
      );
      failing = true;
      container.invalidate(rows);
      await tester.pump();
      await tester.pump();

      // Req 11.5 and 11.10: the rows a member was reading are still theirs, and
      // the failure does not replace them with an apology.
      expect(find.text('a conversation'), findsOneWidget);
      expect(find.byType(ErrorView), findsNothing);
    });

    testWidgets('a first load that fails offline says so, not that we broke',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(
        pumpFixture(
          viewOf(
            const AsyncError<List<String>>(
              SocketException('Failed host lookup: api.example.test'),
              StackTrace.empty,
            ),
          ),
          reduceMotion: true,
        ),
      );
      await tester.pump();

      expect(find.text('You\'re offline'), findsOneWidget);
      expect(
        find.textContaining('we couldn\'t load your messages'),
        findsOneWidget,
      );
      expect(find.text('Try again'), findsOneWidget);
    });
  });
}
