// domain/orchestrator/orphanHolds.ts
//
// Release card authorisations nothing accounts for (ESC-34). Pure.
//
// A hold placed by a request that died before writing its row, or a row marked VOIDED
// when the provider actually still held it, leaves a member's card limit encumbered
// with no trade to release it. The provider will release it itself after about a week,
// which is a week of a member's available credit gone for nothing. The sweep compares
// what the provider holds with the LIVE rows on file and voids the difference.

export interface OrphanHoldDeps {
  /** Provider holds older than the cut-off. Throws on a provider error. */
  listUncaptured(olderThan: string): Promise<Array<{ holdId: string }>>;
  /** Which of these provider hold ids have a live (ACTIVE) row. */
  liveHoldIds(holdIds: string[]): Promise<Set<string>>;
  voidHold(holdId: string): Promise<{ status: string }>;
  onVoided?(holdId: string): Promise<void>;
  onVoidFailed?(holdId: string, status: string): Promise<void>;
}

export interface OrphanSweepResult {
  considered: number;
  voided: number;
  failed: number;
}

/** Only holds older than this are looked at: a placement may be mid-flight. */
export const ORPHAN_MIN_AGE_MINUTES = 60;

export async function sweepOrphanHolds(deps: OrphanHoldDeps, now: Date): Promise<OrphanSweepResult> {
  const olderThan = new Date(now.getTime() - ORPHAN_MIN_AGE_MINUTES * 60_000).toISOString();
  const provider = await deps.listUncaptured(olderThan);
  const result: OrphanSweepResult = { considered: provider.length, voided: 0, failed: 0 };
  if (provider.length === 0) return result;
  const live = await deps.liveHoldIds(provider.map((hold) => hold.holdId));
  for (const hold of provider) {
    if (live.has(hold.holdId)) continue;
    const voided = await deps.voidHold(hold.holdId);
    if (voided.status === 'VOIDED') {
      result.voided += 1;
      await deps.onVoided?.(hold.holdId);
    } else {
      result.failed += 1;
      await deps.onVoidFailed?.(hold.holdId, voided.status);
    }
  }
  return result;
}
