// The Account hub's regions and its two row shapes.
//
// SECTION ORDER AND LABELS ARE THE WEB'S. `/profile` presents Profile,
// Verification and Payouts in that order, and the phone screen presents the same
// three under the same words, so a member who learns the sequence on one client
// recognises it on the other (Req 10.1).
//
// A COUNT IS A NUMERAL ONLY WHERE ONE WAS READ. [ProfileCount] takes the
// `AsyncValue` the count came from rather than an `int`, because the screen it
// replaced wrote `provider.value?.length ?? 0` — which drew a confident `0` for a
// list that had not loaded, had failed, or belonged to a member who was not signed
// in. Three different situations, one number, and the one it chose was the one that
// reads as "you have nothing" (Req 10.8).
//
// Requirements 10.1, 10.8, 13.6, 13.7, 13.10, 13.11.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme.dart';
import '../../../widgets/common/skeleton.dart';

/// One titled region of the Account hub, drawn as a card under its label.
class ProfileSection extends StatelessWidget {
  const ProfileSection({
    required this.title,
    required this.child,
    this.padded = true,
    super.key,
  });

  /// The region's heading, in the words the web tab uses.
  final String title;

  /// The region's content.
  final Widget child;

  /// Whether the card insets its content. A card holding only full-width rows
  /// passes false, so the rows' own leading edge is the card's.
  final bool padded;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.snug),
          child: Text(title, style: AppText.sectionLabel),
        ),
        Card(
          child: padded
              ? Padding(
                  padding: const EdgeInsets.all(AppSpacing.cozy),
                  child: child,
                )
              : child,
        ),
      ],
    );
  }
}

/// One of the hub's server-read counts: listings, trades or sales.
class ProfileCount extends StatelessWidget {
  const ProfileCount({required this.label, required this.read, super.key});

  /// What is being counted, in member-facing words.
  final String label;

  /// The read the count comes from. Its length is drawn only where it has one.
  final AsyncValue<List<Object?>> read;

  /// What stands in a count's position while it is loading or unavailable.
  ///
  /// Deliberately not a digit, and deliberately not blank: an em dash occupies the
  /// same slot a numeral will and reads as "not yet" rather than as zero.
  static const String placeholder = '—';

  /// The figure's treatment: the `head` level at the bold weight, so a count and
  /// its placeholder occupy the same line box. Composed from the Type_Scale rather
  /// than written out, so the level is stated once (Req 2.8).
  static final TextStyle _figureStyle = AppType.head.copyWith(
    fontWeight: FontWeight.w700,
    color: AppColors.foreground,
  );

  @override
  Widget build(BuildContext context) {
    final List<Object?>? rows = read.value;
    final String figure = rows == null ? placeholder : '${rows.length}';

    return Expanded(
      child: Semantics(
        container: true,
        excludeSemantics: true,
        // The placeholder is a punctuation mark, which a screen reader either
        // skips or reads as "dash". Neither says what it means, so the state is
        // spelled out instead (Req 13.7, 13.11).
        label: rows == null ? '$label, not loaded yet' : '${rows.length} $label',
        child: Column(
          children: <Widget>[
            Text(figure, style: _figureStyle),
            Text(label, style: AppText.metaText, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

/// A navigation row: leading glyph, label, trailing chevron.
class ProfileMenuRow extends StatelessWidget {
  const ProfileMenuRow({
    required this.icon,
    required this.label,
    required this.onTap,
    this.trailingNote,
    this.leavesApp = false,
    super.key,
  });

  /// Decorative glyph; [label] is what a screen reader reads.
  final IconData icon;

  /// The row's visible label.
  final String label;

  /// Where the row goes.
  final VoidCallback onTap;

  /// Optional value or explanation below the label.
  final String? trailingNote;

  /// Whether activating the row leaves the app for the website. A row that does
  /// says so in words and wears the outbound glyph, never a chevron (Req 10.6).
  final bool leavesApp;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: ExcludeSemantics(
        child: Icon(icon, size: AppIconSize.large, color: AppColors.mutedForeground),
      ),
      title: Text(label, style: AppText.bodyText),
      subtitle: trailingNote == null
          ? null
          : Text(trailingNote!, style: AppText.metaText),
      trailing: ExcludeSemantics(
        child: Icon(
          leavesApp ? Icons.open_in_new_rounded : Icons.chevron_right_rounded,
          size: leavesApp ? AppIconSize.base : AppIconSize.large,
          color: AppColors.mutedForeground,
        ),
      ),
      onTap: onTap,
    );
  }
}

/// A verification step's first load: the heading line and its explanation, at the
/// sizes the resolved copy will occupy.
///
/// Shared by both step screens, so the two do not drift into different waits for
/// the same read.
class ProfileStepSkeleton extends StatelessWidget {
  const ProfileStepSkeleton({required this.announcement, super.key});

  /// What assistive technology hears once, as the load begins.
  final String announcement;

  @override
  Widget build(BuildContext context) {
    return SkeletonRegion(
      announcement: announcement,
      child: const Padding(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.group,
          AppSpacing.snug,
          AppSpacing.group,
          AppSpacing.section,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SkeletonTextLines(level: AppText.rowName, widths: [0.55]),
            SizedBox(height: AppSpacing.snug),
            SkeletonTextLines(
              level: AppText.supportText,
              widths: [1.0, 0.95, 0.7],
            ),
          ],
        ),
      ),
    );
  }
}
