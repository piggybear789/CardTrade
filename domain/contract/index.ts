// domain/contract/index.ts
//
// The contract action plan: one shared step vocabulary plus a pure derivation per
// flow. Everything here is framework-free so it runs in the Node-only `domain`
// Vitest project.

export {
  activeStep,
  currentStep,
  nextMoveLabel,
  sequenceSteps,
  stepProgress,
} from './steps';
export type {
  ContractStep,
  ContractStepAction,
  ContractStepDraft,
  ContractStepOwner,
  ContractStepStatus,
} from './steps';

export { CASH_SALE_SECTIONS, deriveCashSaleSteps } from './cashSaleSteps';
export type { CashSaleStepFacts } from './cashSaleSteps';

export { TRADE_SECTIONS, deriveTradeSteps } from './tradeSteps';
export type { TradeStepFacts } from './tradeSteps';

export { DEAL_SECTIONS, deriveDealSteps } from './dealSteps';
export type { DealStepFacts, DealStepState } from './dealSteps';
