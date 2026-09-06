// Feature: mobile-visual-parity — Property 15, the relative-time instance.
//
// Property 15: For any scalar input, the rendered result matches the band the
// requirement assigns it, INCLUDING AT THE BOUNDARY VALUE ITSELF. Req 9.8 states
// four bands: a just-now label below 45 seconds, whole minutes below one hour,
// whole hours below one day, whole days below one week, and an absolute day and
// month beyond that.
//
// The boundary is the whole point of the test. `timeago`, which this replaced,
// says "a moment ago" under 45 seconds and "about an hour ago" at 50 minutes, so
// the two clients reported different ages for the same message — a disagreement
// no example at 5 minutes and 3 hours would have caught.
//
// The subject is a pure function over an injected instant, so this file pumps no
// frame and reads no clock.
//
// Validates: Requirements 9.8

import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/relative_time.dart';

/// The instant every case is measured against. Mid-month and mid-day on purpose:
/// a reference at midnight or on the first of a month hides an off-by-one in the
/// calendar-day arithmetic.
final DateTime kNow = DateTime(2026, 1, 15, 14, 30);

String labelAt(Duration age) =>
    relativeTimeLabel(kNow.subtract(age), now: kNow);

void main() {
  group('Property 15: the relative-time ladder respects its boundaries', () {
    // Each band is asserted at its lower edge, inside, and at the exact value
    // where it hands over. A band tested only in the middle is a band whose
    // comparison operator is untested.
    const List<(Duration, String, String)> cases = <(Duration, String, String)>[
      // ─── below 45 seconds: just now ────────────────────────────────
      (Duration.zero, 'just now', 'the instant itself'),
      (Duration(seconds: 1), 'just now', 'one second'),
      (Duration(seconds: 44), 'just now', 'the last second of the band'),
      (
        Duration(seconds: 44, milliseconds: 499),
        'just now',
        'rounds down to 44 seconds'
      ),

      // ─── 45 seconds to an hour: whole minutes ──────────────────────
      (Duration(seconds: 45), '1m ago', 'the boundary value itself'),
      (Duration(seconds: 89), '1m ago', 'rounds to one minute'),
      (Duration(seconds: 90), '2m ago', 'rounds to two minutes'),
      (Duration(minutes: 5), '5m ago', 'inside the band'),
      (Duration(minutes: 59), '59m ago', 'the last whole minute'),

      // ─── an hour to a day: whole hours ─────────────────────────────
      (Duration(minutes: 60), '1h ago', 'the boundary value itself'),
      (Duration(hours: 3), '3h ago', 'inside the band'),
      (Duration(hours: 23), '23h ago', 'the last whole hour'),

      // ─── a day to a week: whole days ───────────────────────────────
      (Duration(hours: 24), '1d ago', 'the boundary value itself'),
      (Duration(days: 3), '3d ago', 'inside the band'),
      (Duration(days: 6), '6d ago', 'the last whole day'),

      // ─── beyond a week: an absolute day and month ──────────────────
      (Duration(days: 7), '8 Jan', 'the boundary value itself'),
      (Duration(days: 30), '16 Dec 2025', 'a previous year carries the year'),
    ];

    for (final (Duration age, String expected, String why) in cases) {
      test('$age reads "$expected" — $why', () {
        expect(labelAt(age), expected);
      });
    }

    test('a future instant reads as clock skew, not as a negative age', () {
      // A device clock a few seconds ahead of the server's is ordinary. "-3m ago"
      // is not a thing a member should ever be shown.
      expect(labelAt(const Duration(seconds: -30)), 'just now');
      expect(labelAt(const Duration(minutes: -5)), 'just now');
    });

    test('the ladder is monotonic across the whole domain', () {
      // The bands hand over in one direction only: a label may repeat as the
      // rounding absorbs a second, but the BAND must never go backwards. This is
      // the assertion that catches a comparison written the wrong way round in
      // one band while every hand-picked example still passes.
      const List<Duration> ascending = <Duration>[
        Duration(seconds: 0),
        Duration(seconds: 44),
        Duration(seconds: 45),
        Duration(minutes: 59),
        Duration(minutes: 60),
        Duration(hours: 23),
        Duration(hours: 24),
        Duration(days: 6),
        Duration(days: 7),
      ];
      final List<int> bands = <int>[
        for (final Duration age in ascending) _bandOf(labelAt(age)),
      ];
      for (int i = 1; i < bands.length; i++) {
        expect(
          bands[i],
          greaterThanOrEqualTo(bands[i - 1]),
          reason: '${ascending[i]} fell into an earlier band than '
              '${ascending[i - 1]}',
        );
      }
    });
  });

  group('Req 9.4: a calendar day is not a 24-hour window', () {
    test('two messages either side of midnight are two days', () {
      // The rule Req 9.4 states is a change of calendar DAY, and eleven minutes
      // of conversation across midnight is two days by that rule. A run broken
      // on elapsed hours instead would merge them.
      final DateTime before = DateTime(2026, 1, 15, 23, 55);
      final DateTime after = DateTime(2026, 1, 16, 0, 6);
      expect(calendarDay(before), isNot(calendarDay(after)));
      expect(after.difference(before), lessThan(const Duration(hours: 1)));
    });

    test('two messages 23 hours apart on one long day are one day', () {
      final DateTime early = DateTime(2026, 1, 15, 0, 30);
      final DateTime late = DateTime(2026, 1, 15, 23, 30);
      expect(calendarDay(early), calendarDay(late));
    });

    test('a day marker names today, yesterday, then the weekday', () {
      expect(dayMarkerLabel(kNow, now: kNow), 'Today');
      expect(
        dayMarkerLabel(kNow.subtract(const Duration(days: 1)), now: kNow),
        'Yesterday',
      );
      // 2026-01-12 is a Monday.
      expect(
        dayMarkerLabel(DateTime(2026, 1, 12, 9), now: kNow),
        'Mon, 12 Jan',
      );
    });

    test('yesterday is the previous calendar day, not 24 hours ago', () {
      // A message at 23:00 is 15 hours before a 14:00 reference and belongs to
      // yesterday; one at 09:00 the same morning is 5 hours before it and belongs
      // to today. An hours-based test would call both of them today.
      final DateTime lastNight = DateTime(2026, 1, 14, 23, 0);
      expect(dayMarkerLabel(lastNight, now: kNow), 'Yesterday');
      expect(dayMarkerLabel(DateTime(2026, 1, 15, 9, 0), now: kNow), 'Today');
    });
  });
}

/// Which of the five bands a label belongs to, ordered youngest to oldest.
int _bandOf(String label) {
  if (label == 'just now') return 0;
  if (label.endsWith('m ago')) return 1;
  if (label.endsWith('h ago')) return 2;
  if (label.endsWith('d ago')) return 3;
  return 4;
}
