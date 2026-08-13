// domain/arbitration/arbitrationCase.ts
//
// The arbitration case model: one triageable shape over three different records.
//
// WHY NORMALISE. A support worker's queue contains disputed Cash_Sales, disputed
// Trades, and Chargebacks. Those live in three tables with three different money
// models — collected funds held by the platform, paired collateral authorisations,
// and a bank reversal already in progress. An arbitrator does not care about that
// distinction when deciding what to pick up next; they care how much is at stake, how
// long someone has been waiting, and whether anyone is already on it. So the queue is
// derived, not stored.
//
// WHY NOT AN `arbitration_cases` TABLE. Copying the money into a second table means
// two representations of the same disputed amount, and the stale one is the one staff
// would eventually act on. The source record stays authoritative; only assignment and
// internal notes — which have no home on the source record — are persisted separately.
//
// Pure module: no Supabase, no React, no provider types. Runs in the Node-only
// `domain` Vitest project so the triage ordering and the money-at-risk arithmetic can
// be property-tested.

/** Integer AUD cents. */
export type Cents = number;

/** Which kind of record a case is a view over. */
export type ArbitrationCaseKind = 'CASH_SALE' | 'TRADE' | 'CHARGEBACK';

/**
 * WHY a case needs staff attention. One `kind` can surface multiple situations, and
 * the queue must tell them apart without opening each one:
 *
 *   - A CASH_SALE in status DISPUTED is a condition or fraud dispute.
 *   - A CASH_SALE with `return_disputed_at` set is a Seller contesting a return.
 *   - A CASH_SALE with `return_lapsed_at` set is a Buyer who never posted it back.
 *
 * Situation affects priority, queue labelling and which panel the detail page shows.
 * It does NOT affect the `kind` or `ref`, which still identify the underlying row.
 */
export type ArbitrationCaseSituation =
  | 'CONDITION_DISPUTE'
  | 'FRAUD_DISPUTE'
  | 'CHARGEBACK'
  | 'RETURN_CONTESTED'
  | 'RETURN_LAPSED';

/**
 * How urgent a case is.
 *
 * Deliberately derived rather than stored, so it cannot go stale as a case ages, and
 * so nobody can quietly de-prioritise their own backlog.
 */
export type ArbitrationPriority = 'CRITICAL' | 'HIGH' | 'NORMAL';

/**
 * One line of goods a disputed contract covers (0064).
 *
 * Exists because `title` alone stopped being a sufficient description of the
 * goods once a listing could be a SHOPFRONT. A binder's ten concurrent contracts
 * all carry the same title, so a case reading only that would tell an arbitrator
 * "Josh's Pokémon binder, $340" with no way to decide a claim about which card
 * was owed. These lines come from the CONTRACT, which is frozen at the
 * Commitment_Point, never from the listing, which the seller can still edit.
 */
export interface ArbitrationGoodsLine {
  description: string;
  /** Per-line grade, because a binder is not one condition. */
  condition: string | null;
  quantity: number;
  unitPriceCents: Cents;
}

/** A party to a case, as an arbitrator needs to see them. */
export interface ArbitrationParty {
  id: string;
  name: string;
  /** What this party stands to lose or gain, in cents. */
  stakeCents: Cents;
  /** Their side of the dispute, in the vocabulary of the case kind. */
  role: string;
}

/** One case in the queue. */
export interface ArbitrationCase {
  kind: ArbitrationCaseKind;
  /** Primary key of the underlying record. */
  ref: string;
  /**
   * WHY this case needs staff attention — a queue label finer than `kind`.
   *
   * The queue renders this so a worker scanning fifteen CASH_SALE rows knows which are
   * condition disputes, which are contested returns and which are lapsed returns,
   * without opening each one.
   */
  situation: ArbitrationCaseSituation;
  /**
   * Short human label, e.g. the item title.
   *
   * For a shopfront contract this names the LISTING, not the goods — several
   * cases will share it. Read {@link goods} to know what the contract covered.
   */
  title: string;
  /**
   * What the contract covered, line by line, when the record itemises it.
   *
   * Empty for a trade, a chargeback, and a single-item cash sale, whose goods are
   * fully described by `title`. Non-empty for a shopfront cash sale, where it is
   * the only thing that distinguishes one case from another against the same
   * listing.
   */
  goods: readonly ArbitrationGoodsLine[];
  /** Total money the outcome decides, in cents. */
  amountAtRiskCents: Cents;
  /** When the dispute was raised, ISO-8601. Null when the source never recorded it. */
  openedAt: string | null;
  /** Who raised it, when known. */
  raisedById: string | null;
  /** The claim, in the claimant's own words. Never treated as established fact. */
  claim: string | null;
  parties: readonly ArbitrationParty[];
  /** Staff member working it, or null when nobody has picked it up. */
  assigneeId: string | null;
  /**
   * Display name of that staff member.
   *
   * Carried alongside the id because "held by someone else" is only useful if it says
   * who — an arbitrator deciding whether to take over needs a person to ask, and a
   * UUID is not one. Null whenever `assigneeId` is.
   */
  assigneeName: string | null;
  /** Count of internal notes, so the queue shows whether anyone has looked. */
  noteCount: number;
  /**
   * True when the case carries an externally-imposed deadline that forfeits by
   * default if missed. Only chargebacks do.
   */
  hasHardDeadline: boolean;
  /** The deadline, when there is one. */
  deadlineAt: string | null;
  /** True when a party has alleged deliberate fraud rather than a condition problem. */
  fraudAlleged: boolean;
}

/** A case with its derived triage fields. */
export interface TriagedCase extends ArbitrationCase {
  priority: ArbitrationPriority;
  /** Whole hours since the dispute was raised. Zero when `openedAt` is unknown. */
  ageHours: number;
  /** Hours until a hard deadline; negative once passed. Null when there is none. */
  hoursToDeadline: number | null;
}

/** Hours after which an unresolved case is treated as overdue. */
export const ARBITRATION_SLA_HOURS = 72;

/** Hours before a hard deadline at which a case becomes critical. */
export const DEADLINE_WARNING_HOURS = 48;

/** Whole hours between two instants, floored at zero. */
function hoursBetween(fromIso: string | null, now: Date): number {
  if (!fromIso) return 0;
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(Math.floor((now.getTime() - from) / 3_600_000), 0);
}

/**
 * Derive a case's priority.
 *
 * Ordered by what actually cannot be recovered if ignored:
 *
 *   1. A hard deadline inside the warning window. A chargeback whose evidence
 *      deadline passes is forfeited automatically — no amount of later attention
 *      brings the money back, so this outranks everything.
 *   2. Alleged fraud. The remedy is capturing someone's full collateral, and the
 *      authorisations behind it expire in about seven days, so a slow decision can
 *      leave nothing to capture.
 *   3. Past SLA. For a regular dispute, the clock is `openedAt`. For a RETURN_LAPSED
 *      case, the clock is `openedAt` too — the caller must set `openedAt` to
 *      `return_lapsed_at`, because that is when the case began waiting.
 *
 * Money is deliberately NOT an input. Weighting by amount would systematically park
 * small disputes forever, and a $40 dispute nobody ever answers is a worse failure
 * than a $4,000 one answered on day three.
 */
export function priorityOf(
  input: Pick<ArbitrationCase, 'hasHardDeadline' | 'deadlineAt' | 'fraudAlleged' | 'openedAt'>,
  now: Date,
): ArbitrationPriority {
  if (input.hasHardDeadline && input.deadlineAt) {
    const hoursLeft = (Date.parse(input.deadlineAt) - now.getTime()) / 3_600_000;
    if (!Number.isNaN(hoursLeft) && hoursLeft < DEADLINE_WARNING_HOURS) return 'CRITICAL';
  }
  if (input.fraudAlleged) return 'HIGH';
  if (hoursBetween(input.openedAt, now) >= ARBITRATION_SLA_HOURS) return 'HIGH';
  return 'NORMAL';
}

const PRIORITY_RANK: Record<ArbitrationPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
};

/**
 * Add triage fields to a case.
 */
export function triage(input: ArbitrationCase, now: Date = new Date()): TriagedCase {
  const hoursToDeadline =
    input.deadlineAt && !Number.isNaN(Date.parse(input.deadlineAt))
      ? Math.floor((Date.parse(input.deadlineAt) - now.getTime()) / 3_600_000)
      : null;

  return {
    ...input,
    priority: priorityOf(input, now),
    ageHours: hoursBetween(input.openedAt, now),
    hoursToDeadline,
  };
}

/**
 * Order a queue for triage: priority first, then oldest.
 *
 * Ties break on `ref` so the ordering is total. Without that, two cases raised in the
 * same second could swap places between renders, and a queue that reshuffles under a
 * worker is one they stop trusting.
 */
export function compareForTriage(a: TriagedCase, b: TriagedCase): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  if (a.ageHours !== b.ageHours) return b.ageHours - a.ageHours;
  return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
}

/** Every case kind, for exhaustive narrowing of untrusted route segments. */
export const ARBITRATION_CASE_KINDS = ['CASH_SALE', 'TRADE', 'CHARGEBACK'] as const;

/** Human queue label per situation. Shared with the UI so the queue and the detail page cannot disagree. */
export const SITUATION_LABEL: Record<ArbitrationCaseSituation, string> = {
  CONDITION_DISPUTE: 'Condition dispute',
  FRAUD_DISPUTE: 'Fraud dispute',
  CHARGEBACK: 'Chargeback',
  RETURN_CONTESTED: 'Return contested',
  RETURN_LAPSED: 'Return lapsed',
};

/**
 * Narrow a route segment to a case kind.
 *
 * Returns null rather than defaulting, because a case kind selects which table gets
 * read and which resolution controls get rendered. Falling back to a default here
 * would show the wrong money and offer the wrong outcome for a mistyped URL.
 */
export function parseCaseKind(value: string | undefined): ArbitrationCaseKind | null {
  const found = ARBITRATION_CASE_KINDS.find((kind) => kind === value);
  return found ?? null;
}

/** Which slice of the queue a worker is looking at. */
export type QueueScope = 'open' | 'mine' | 'unassigned';

/** Narrow an arbitrary `?queue=` value. */
export function resolveQueueScope(value: string | string[] | undefined): QueueScope {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'mine' || raw === 'unassigned' ? raw : 'open';
}

/** Apply a queue scope for a given viewer. */
export function filterQueue(
  cases: readonly TriagedCase[],
  scope: QueueScope,
  viewerId: string,
): TriagedCase[] {
  switch (scope) {
    case 'mine':
      return cases.filter((c) => c.assigneeId === viewerId);
    case 'unassigned':
      return cases.filter((c) => c.assigneeId === null);
    default:
      return [...cases];
  }
}

/** Build a triaged, ordered queue. */
export function buildQueue(
  cases: readonly ArbitrationCase[],
  now: Date = new Date(),
): TriagedCase[] {
  return cases.map((c) => triage(c, now)).sort(compareForTriage);
}

/** Totals a queue view reports at a glance. */
export interface QueueSummary {
  total: number;
  critical: number;
  unassigned: number;
  overdue: number;
  amountAtRiskCents: Cents;
}

/**
 * Summarise a queue.
 *
 * `amountAtRiskCents` sums integer cents so the headline agrees exactly with the sum
 * of the rows beneath it.
 */
export function summariseQueue(cases: readonly TriagedCase[]): QueueSummary {
  let critical = 0;
  let unassigned = 0;
  let overdue = 0;
  let amountAtRiskCents = 0;

  for (const c of cases) {
    if (c.priority === 'CRITICAL') critical += 1;
    if (c.assigneeId === null) unassigned += 1;
    if (c.ageHours >= ARBITRATION_SLA_HOURS) overdue += 1;
    amountAtRiskCents += Math.max(Math.trunc(c.amountAtRiskCents), 0);
  }

  return { total: cases.length, critical, unassigned, overdue, amountAtRiskCents };
}
