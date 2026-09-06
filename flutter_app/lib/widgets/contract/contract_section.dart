// The card shell and the label/value row every contract region is built from,
// standing in for the web's `ContractDetailList` tabs.
//
// A PHONE STACKS WHERE THE WEB TABS. The web inspector is a single-selection tab
// strip because it shares a fixed-height workspace with the conversation column; a
// phone room is one scroll, so the same regions become titled cards in the same
// order. Each region is still one heading and its rows, with the same rhythm and
// the same detail-label/detail-value pairing.
//
// Requirements 7.1, 13.10, 13.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';

/// One titled region of a contract room.
class ContractSection extends StatelessWidget {
  const ContractSection({
    required this.title,
    required this.children,
    this.explainer,
    this.trailing,
    super.key,
  });

  /// The region's heading, rendered as the web renders a panel heading: `meta`,
  /// uppercase, tracked, muted.
  final String title;

  /// A plain-language line under the heading saying what this region is.
  final String? explainer;

  /// A control or badge on the heading row.
  final Widget? trailing;

  /// The region's content, stacked at the `cozy` step.
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.cozy),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpacing.cozy,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: AppSpacing.snug,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: AppSpacing.tight,
                    children: <Widget>[
                      Text(title.toUpperCase(), style: AppText.sectionLabel),
                      if (explainer != null && explainer!.trim().isNotEmpty)
                        Text(explainer!.trim(), style: AppText.supportText),
                    ],
                  ),
                ),
                ?trailing,
              ],
            ),
            ...children,
          ],
        ),
      ),
    );
  }
}

/// A labelled block of prose inside a region — a binder description, an offer
/// message, a shipping note.
///
/// Separate from [ContractDetailRow] because a sentence is not a value: it wants
/// the full width and as many lines as it needs, and squeezing it into the right
/// half of a row is how a contract term ends up half-read.
class ContractSubRow extends StatelessWidget {
  const ContractSubRow({required this.label, required this.body, super.key});

  final String label;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.snug),
      decoration: BoxDecoration(
        color: AppColors.muted,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: AppSpacing.tight,
        children: <Widget>[
          Text(label, style: AppText.detailLabel),
          Text(body, style: AppText.bodyText),
        ],
      ),
    );
  }
}

/// One `label — value` row of a contract region.
///
/// The value wraps rather than truncating: a meeting place or a tracking number
/// cut off mid-string is a fact the member cannot use (Req 13.10).
class ContractDetailRow extends StatelessWidget {
  const ContractDetailRow({
    required this.label,
    this.value,
    this.child,
    this.icon,
    super.key,
  }) : assert(value != null || child != null, 'a detail row needs a value or a child');

  /// The row's label, in `--muted-foreground`.
  final String label;

  /// The row's value as text.
  final String? value;

  /// The row's value as a widget, where it is a badge or a control.
  final Widget? child;

  /// An optional leading glyph. Decorative — the label carries the meaning.
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: AppSpacing.snug,
      children: <Widget>[
        if (icon != null)
          ExcludeSemantics(
            child: Icon(icon, size: AppIconSize.base, color: AppColors.mutedForeground),
          ),
        Expanded(child: Text(label, style: AppText.detailLabel)),
        Flexible(
          child: Align(
            alignment: Alignment.centerRight,
            child: child ??
                Text(
                  value!,
                  style: AppText.detailValue,
                  textAlign: TextAlign.right,
                ),
          ),
        ),
      ],
    );
  }
}
