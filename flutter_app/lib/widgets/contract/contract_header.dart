// The identity strip a contract room opens with: what this contract is, what it
// is worth, and what state the server says it is in. One card, matching the web's
// `components/contract/ContractHeader.tsx`.
//
// The status is a BADGE, not a full-bleed coloured banner. The banner it replaces
// filled the top of the room with a saturated block and printed white ink on it
// at every status, which spent the room's most valuable strip on one word and
// forced four hard-coded colours into a screen (Req 1.7).
//
// The status label is the status the SERVER reported, so a room whose status the
// step list does not recognise still says what it is (Req 7.11).
//
// Requirements 7.1, 7.11, 13.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';

/// The contract's own title, its status badge, and optionally its headline money.
class ContractHeader extends StatelessWidget {
  const ContractHeader({
    required this.title,
    required this.statusLabel,
    required this.statusVariant,
    this.money,
    this.subtitle,
    super.key,
  });

  /// What this contract IS — the item, or the counterparty. Never the contract
  /// type, which the screen's own title bar already says.
  final String title;

  /// The status as the server reported it, in member-facing words.
  final String statusLabel;

  /// The badge tone for that status. Colour is never the only signal: the badge
  /// always renders the label as text beside it (Req 13.11).
  final StatusBadgeVariant statusVariant;

  /// The headline figure, already formatted through `core/money.dart`.
  final String? money;

  /// One supporting line under the title.
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.cozy),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: AppSpacing.cozy,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                spacing: AppSpacing.tight,
                children: <Widget>[
                  Text(title, style: AppText.cardTitle.copyWith(fontWeight: FontWeight.w600)),
                  if (subtitle != null && subtitle!.trim().isNotEmpty)
                    Text(subtitle!.trim(), style: AppText.supportText),
                  StatusBadge(label: statusLabel, variant: statusVariant),
                ],
              ),
            ),
            if (money != null) Text(money!, style: AppText.priceInline),
          ],
        ),
      ),
    );
  }
}
