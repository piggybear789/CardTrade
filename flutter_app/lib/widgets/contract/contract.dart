// The shared contract-room presentation layer, used by both the sale room and the
// trade room so a region cannot look like one thing in one room and another in the
// other. Presentation only.
//
// `ContractStep` itself is a MODEL (`models/contract_step.dart`), not a widget: it
// is what the server sends, so the service that fetches it and the provider that
// exposes it both need it without reaching into the widget layer. It is re-exported
// here because every consumer of these widgets needs it too.

export 'package:cardtrade/models/contract_step.dart';

export 'contract_action_card.dart';
export 'contract_header.dart';
export 'contract_money_table.dart';
export 'contract_progress_rail.dart';
export 'contract_section.dart';
export 'contract_timeline.dart';
