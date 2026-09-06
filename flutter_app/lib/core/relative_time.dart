// The relative-time ladder the messaging surfaces read, ported from the web's
// `formatRelativeTime` in `lib/format.ts`.
//
// Req 9.8 fixes the ladder: a just-now label below 45 seconds, whole minutes
// below an hour, whole hours below a day, whole days below a week, and an
// absolute day and month beyond that. The `timeago` package this replaced on the
// conversation row agrees with none of those boundaries — it says "a moment ago"
// under 45 seconds, "about an hour ago" at 50 minutes, and "a month ago" at 30
// days — so the two clients disagreed about the age of the same message.
//
// [now] is a parameter rather than a call to `DateTime.now()` so a golden can
// pump this at a fixed instant. A relative label read from the wall clock is a
// time bomb in every reference image, and the boundary cases in Property 15 are
// only assertable when the instant is injected.
//
// This is presentation formatting, not a rule: nothing here decides eligibility,
// money or contract state, and it lives in `core/` rather than `domain/` because
// Req 14.1 fixes the set of Advisory_Domain_Ports at eight.
//
// Requirements 9.8.

const List<String> _monthNames = <String>[
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// A short relative age for [instant], measured against [now].
///
/// Returns `just now` for anything under 45 seconds — including a future
/// instant, which reads as a clock skew rather than a negative age — then `5m
/// ago`, `3h ago`, `2d ago`, and `12 Aug` (with the year when it differs from
/// [now]'s) beyond a week.
String relativeTimeLabel(DateTime instant, {DateTime? now}) {
  final DateTime reference = now ?? DateTime.now();
  final int seconds =
      (reference.difference(instant).inMilliseconds / 1000).round();

  if (seconds < 45) return 'just now';

  final int minutes = (seconds / 60).round();
  if (minutes < 60) return '${minutes}m ago';

  final int hours = (minutes / 60).round();
  if (hours < 24) return '${hours}h ago';

  final int days = (hours / 24).round();
  if (days < 7) return '${days}d ago';

  final DateTime local = instant.toLocal();
  final String date = '${local.day} ${_monthNames[local.month - 1]}';
  return local.year == reference.toLocal().year ? date : '$date ${local.year}';
}

/// The calendar day [instant] falls on, in local time.
///
/// Req 9.4 ends a run at a change of calendar DAY, which is not the same test as
/// "more than 24 hours apart": two messages eleven minutes either side of
/// midnight are one minute of conversation on two days.
DateTime calendarDay(DateTime instant) {
  final DateTime local = instant.toLocal();
  return DateTime(local.year, local.month, local.day);
}

/// A day separator label: `Today`, `Yesterday`, or `Tue, 12 Aug`.
String dayMarkerLabel(DateTime instant, {DateTime? now}) {
  final DateTime reference = now ?? DateTime.now();
  final DateTime day = calendarDay(instant);
  final DateTime today = calendarDay(reference);
  if (day == today) return 'Today';
  if (day == today.subtract(const Duration(days: 1))) return 'Yesterday';
  const List<String> weekdays = <String>[
    'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  ];
  return '${weekdays[day.weekday - 1]}, ${day.day} ${_monthNames[day.month - 1]}';
}
