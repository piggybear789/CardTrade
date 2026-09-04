// components/fulfilment/index.ts
//
// Fulfilment UI shared by the Cash_Sale and 2-way Trade contract rooms: the method
// choice, the method-specific fields, shipment capture, postal addresses, the
// inspection clock, and the "this did not happen" escape hatch.
//
// None of these own a server action. Each room injects its own, because the two flows
// freeze and settle differently even where they look identical.

export { FulfilmentMethodChoice } from './FulfilmentMethodChoice';
export type { FulfilmentMethodChoiceProps } from './FulfilmentMethodChoice';

export { FulfilmentMethodSummary } from './FulfilmentMethodSummary';
export type { FulfilmentMethodSummaryProps } from './FulfilmentMethodSummary';

export { FULFILMENT_FIELD_ERRORS, FulfilmentTermsFields } from './FulfilmentTermsFields';
export type { FulfilmentTermsFieldsProps } from './FulfilmentTermsFields';

export { RecordShipmentDialog } from './RecordShipmentDialog';
export type { RecordShipmentDialogProps, ShipmentInput } from './RecordShipmentDialog';

export { HandoverFailedDialog } from './HandoverFailedDialog';
export type {
  HandoverFailedDialogProps,
  HandoverFailedSubmitResult,
} from './HandoverFailedDialog';

export { InspectionCountdown } from './InspectionCountdown';
export type { InspectionCountdownProps } from './InspectionCountdown';

export { DeliveryAddressPanel } from './DeliveryAddressPanel';
export type { DeliveryAddressPanelProps } from './DeliveryAddressPanel';
