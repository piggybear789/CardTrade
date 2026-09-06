// The label/value money breakdown both contract rooms disclose, matching the
// web's `components/contract/ContractMoneyTable.tsx`.
//
// EVERY VALUE ARRIVES ALREADY FORMATTED, by `core/money.dart` and nothing else.
// This widget does no arithmetic and holds no divisor: a table that formatted its
// own figures would be a second money path, and a table that recomputed a fee
// would be a second definition of the fee (Req 7.5, 14.5).
//
// Every value is right-aligned and drawn with tabular figures, so the digits line
// up down the column (Req 7.4). That is why the values use the money text roles
// rather than the plain detail value.
//
// Requirements 7.4, 7.5, 14.5.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';

/// One disclosed figure.
class ContractMoneyRow {
  const ContractMoneyRow({
    required this.label,
    required this.value,
    this.hint,
    this.total = false,
  });

  /// What this figure is, including its stated percentage where it is a fee.
  final String label;

  /// The figure, already formatted through `Money.format`.
  final String value;

  /// One line under the label saying what the figure means.
  final String? hint;

  /// Whether this is the viewer's own total, which carries the emphasis.
  final bool total;
}

/// A label/value breakdown of the money on a contract.
class ContractMoneyTable extends StatelessWidget {
  const ContractMoneyTable({required this.rows, this.semanticsLabel, super.key});

  final List<ContractMoneyRow> rows;

  /// An accessible name for the whole table, e.g. "Payment breakdown".
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();

    return Semantics(
      container: true,
      label: semanticsLabel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpacing.snug,
        children: <Widget>[
          for (final ContractMoneyRow row in rows) _MoneyRow(row: row),
        ],
      ),
    );
  }
}

class _MoneyRow extends StatelessWidget {
  const _MoneyRow({required this.row});

  final ContractMoneyRow row;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: AppSpacing.cozy,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: AppSpacing.tight,
            children: <Widget>[
              Text(
                row.label,
                style: row.total
                    ? AppText.detailValue.copyWith(fontWeight: FontWeight.w600)
                    : AppText.detailLabel,
              ),
              if (row.hint != null && row.hint!.trim().isNotEmpty)
                Text(row.hint!.trim(), style: AppText.metaText),
            ],
          ),
        ),
        Text(
          row.value,
          style: row.total ? AppText.priceInline : AppText.priceRow,
          textAlign: TextAlign.right,
        ),
      ],
    );
  }
}
