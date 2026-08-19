// components/contract/index.ts
//
// The shared contract-room kit. Buy (Cash_Sale) and trade (2-way escrow) are two
// state machines over one UX, so they compose the same primitives. A private deal
// is an invite that opens one of those two rooms — not a third ledger.
//
// The room says each fact ONCE, in one place:
//
//   ContractHeader          what this is · what it is worth · who · what state
//     └ ContractPartyLine   both parties on one line (optional details disclosure)
//   ContractLiveRow         details beside the chat column, which is the contract's
//     │                     spine: rail on top, action dock, then the conversation
//     ├ ContractActionCard  what happens NOW, and the only control for it (dock form)
//     └ ContractProgressRail where we are in the lifecycle — ticks, no prose
//   ContractDetailList      the fine print, as collapsed rows
//     └ ContractDetailRow   item · terms · money · collateral · history
//   ContractExchangePanel   what each side is putting in
//   ContractMoneyTable      the money / terms breakdown
//   ContractHoldList        collateral / pre-auth holds
//   ContractTimeline        the audit trail
//   ContractThumbnails      photo strip + lightbox
//
// Ownership ("your move" vs "waiting on Ada") is stated only by the action card, which
// is why there are no owner badges, consent ticks or status banners anywhere else.
//
// A detail row can be expanded, scrolled to and highlighted by id — wrap a room in
// `ContractFocusProvider` and call `focusSection(id)`.
//
// anything flow-specific — state machine gating, server actions, copy — stays in the
// room component. Change a primitive here and both rooms move together.

export { ContractActionCard, ContractOverflowMenu } from './ContractActionCard';
export { ContractConnectionStatus } from './ContractConnectionStatus';
export { ContractConversationPanel } from './ContractConversationPanel';
export { CollateralExplainerDialog } from './CollateralExplainerDialog';
export { ContractDetailList, ContractDetailRow } from './ContractDetailList';
export { DisputeEvidencePanel } from './DisputeEvidencePanel';
export { DittoBondExplainer, CashSaleProtectionExplainer } from './DittoBondExplainer';
export { ContractExchangePanel } from './ContractExchangePanel';
export { ContractFocusProvider, useContractFocus } from './ContractFocus';
export { ContractHeader } from './ContractHeader';
export { ContractHoldList } from './ContractHoldList';
export { ContractImageLightbox, ContractThumbnails } from './ContractImageLightbox';
export { ContractLiveRow } from './ContractLiveRow';
export { ContractMoneyTable } from './ContractMoneyTable';
export {
  ContractPartyDetails,
  ContractPartyLine,
  ContractPartyStats,
} from './ContractPartyLine';
export { ContractProgressRail } from './ContractProgressRail';
export { ContractStatusBadge } from './ContractStatusBadge';
export { ContractTimeline } from './ContractTimeline';
export { useContractConversation } from './useContractConversation';

export type { ContractActionCardProps, ContractActionTone } from './ContractActionCard';
export type { ContractConversationPanelProps } from './ContractConversationPanel';
export type { ContractDetailListProps, ContractDetailRowProps } from './ContractDetailList';
export type { DisputeEvidencePanelProps } from './DisputeEvidencePanel';
export type {
  ContractExchangeItem,
  ContractExchangePanelProps,
  ContractExchangeSide,
} from './ContractExchangePanel';
export type { ContractHeaderProps } from './ContractHeader';
export type { ContractHoldListProps } from './ContractHoldList';
export type { ContractImageLightboxProps, ContractThumbnailsProps } from './ContractImageLightbox';
export type { ContractLiveRowProps } from './ContractLiveRow';
export type { ContractMoneyTableProps } from './ContractMoneyTable';
export type {
  ContractPartyDetailsProps,
  ContractPartyLineProps,
} from './ContractPartyLine';
export type { ContractProgressRailProps } from './ContractProgressRail';
export type { ContractStatusMap, ContractStatusMeta } from './ContractStatusBadge';
export type { ContractTimelineProps } from './ContractTimeline';
export type { ContractConversation } from './useContractConversation';
export type {
  ContractConnectionStatus as ContractConnectionState,
  ContractConsent,
  ContractEvent,
  ContractHold,
  ContractHoldStatus,
  ContractMoneyRow,
  ContractParty,
  ContractPartyStat,
  ContractStatusTone,
} from './types';
