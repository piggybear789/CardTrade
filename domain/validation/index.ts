/**
 * Pure zod validation schemas for CardTrade domain inputs.
 *
 * This module has no Supabase, React, or service-layer dependencies. Each
 * validator returns a discriminated `{ ok: true, value } | { ok: false, field,
 * message }` result so orchestrators and forms can branch on it predictably
 * (see design "Error Handling"). Schemas and validate helpers are exported
 * individually to keep them easily testable (tasks 4.2–4.4).
 */
export {
  type ValidationResult,
  type ValidationSuccess,
  type ValidationFailure,
  ROOT_FIELD,
  runSchema,
} from './result';

export {
  EMAIL_REGEX,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  registrationCredentialsSchema,
  type RegistrationCredentials,
  validateRegistrationCredentials,
} from './registration';

export {
  PROFILE_TEXT_MAX_LENGTH,
  profileUpdateSchema,
  type ProfileUpdate,
  validateProfileUpdate,
} from './profile';

export {
  TITLE_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  FMV_MIN_CENTS,
  FMV_MAX_CENTS,
  IMAGES_MIN,
  IMAGES_MAX,
  itemSubmissionSchema,
  type ItemSubmission,
  validateItemSubmission,
} from './item';

export {
  LINE_DESCRIPTION_MIN_LENGTH,
  LINE_DESCRIPTION_MAX_LENGTH,
  LINE_CONDITION_MAX_LENGTH,
  LINE_QUANTITY_MIN,
  LINE_QUANTITY_MAX,
  LINE_UNIT_PRICE_MIN_CENTS,
  LINE_UNIT_PRICE_MAX_CENTS,
  LINES_MIN,
  LINES_MAX,
  MIN_CONTRACT_TOTAL_CENTS,
  cashSaleLineItemSchema,
  cashSaleLineItemsSchema,
  lineItemsTotalCents,
  type CashSaleLineItemInput,
  type CashSaleLineItems,
  validateCashSaleLineItems,
} from './cashSaleLineItems';
